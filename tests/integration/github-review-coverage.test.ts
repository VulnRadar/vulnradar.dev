import { it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { POST as scanGithubPOST } from "@/app/api/v3/scan/github/route";
import { GET as historyItemGET } from "@/app/api/v3/history/[id]/route";
import {
  aiReviewNotice,
  historyAiReviewNotice,
  parseGithubScanResponse,
} from "@/components/repos/scan-outcome";
import {
  describeIntegration,
  createUser,
  setSettings,
  clearSettings,
} from "./_db";

/**
 * A repo scan reopened from history shows the same AI review coverage notice
 * as the live result (owner decision D20, 2026-11-07). It showed none: the
 * coverage was only ever in the POST response, and scan_history kept nothing
 * of it, so a partly AI-reviewed scan reopened later read as a complete one.
 *
 * The scan route writes the coverage into scan_history.result_meta and
 * GET /api/v3/history/[id] spreads that column back over the row. Whether the
 * JSONB written there comes back with the same keys and values is the
 * database's to answer, so both real route handlers run against a real
 * PostgreSQL here. What is replaced is what has no database in it: the
 * session cookie, GitHub (the token, the repo, the tree, the file contents),
 * the AI provider's answer, and the webhook tail.
 */
const auth = vi.hoisted(() => ({ userId: 0 }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: async () => ({ userId: auth.userId }) };
});

vi.mock("@/lib/github/github-connections", () => ({
  getDecryptedGithubToken: async () => "gho_integration",
}));

const FILES = [
  { path: "src/a.ts", content: "export const a = 1;\n" },
  { path: "data/huge.json", content: "{}\n" },
  { path: "src/b.ts", content: "export const b = 2;\n" },
  { path: "src/c.ts", content: "export const c = 3;\n" },
];

vi.mock("@/lib/github/github-api", () => ({
  getRepoInfo: async () => ({ defaultBranch: "main", private: true }),
  listRepoTree: async () => ({
    entries: FILES.map((f) => ({
      path: f.path,
      type: "blob",
      sha: `sha-${f.path}`,
      size: f.content.length,
    })),
    truncated: false,
  }),
}));

vi.mock("@/lib/scanner/github-repo-scan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scanner/github-repo-scan")>()),
  fetchSelectedFiles: async () => FILES,
}));

// One file skipped for the per-run cap, one batch whose call failed, and the
// allowance running out before the last: every part of the notice at once.
vi.mock("@/lib/ai/review-source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/review-source")>()),
  runGithubAiReview: async () => ({
    findings: [],
    totalTokensUsed: 0,
    noEndpoint: false,
    rejectedOverCap: false,
    stoppedAtBudget: true,
    stoppedAtRunCap: false,
    filesReviewed: 1,
    filesTotal: 4,
    batchesReviewed: 1,
    batchesFailed: 1,
    batchesTotal: 4,
    filesSkippedOverRunCap: ["data/huge.json"],
  }),
}));

vi.mock("@/lib/webhooks/scan-notifications", () => ({
  notifyScanComplete: async () => {},
}));

describeIntegration("GitHub repo review coverage kept with the scan", () => {
  beforeEach(async () => {
    // Billing off: the gate lets the review in uncapped, so nothing here
    // depends on the credit ledger, which github-review-partial covers.
    await setSettings({ BILLING_ENABLED: false });
  });

  afterAll(async () => {
    await clearSettings();
  });

  it("the stored row reopens with the same coverage notice the live result showed", async () => {
    const user = await createUser();
    auth.userId = user.id;

    const res = await scanGithubPOST(
      new Request("http://localhost/api/v3/scan/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoFullName: "octocat/hello-world" }),
      }),
    );
    expect(res.status).toBe(200);
    const live = (await res.json()) as Record<string, unknown>;
    const scanId = live.scanHistoryId as number;
    expect(typeof scanId).toBe("number");

    const { rows } = await pool.query<{
      result_meta: Record<string, unknown> | null;
    }>(`SELECT result_meta FROM scan_history WHERE id = $1`, [scanId]);
    expect(rows[0].result_meta).toMatchObject({
      aiReviewStoppedAtBudget: true,
      aiReviewCoverage: {
        filesReviewed: 1,
        filesTotal: 4,
        batchesFailed: 1,
        filesSkippedOverRunCap: ["data/huge.json"],
      },
    });
    expect(rows[0].result_meta).not.toHaveProperty("aiReviewAllowanceMessage");

    const reopened = await historyItemGET(
      new NextRequest(`http://localhost/api/v3/history/${scanId}`),
      { params: Promise.resolve({ id: String(scanId) }) },
    );
    expect(reopened.status).toBe(200);
    const stored = (await reopened.json()) as Record<string, unknown>;

    const liveNotice = aiReviewNotice(parseGithubScanResponse(live));
    expect(liveNotice?.title).toBe("AI review covered 1 of 4 files");
    expect(historyAiReviewNotice(stored)).toEqual(liveNotice);
  });

  it("a repo scan stored before coverage was kept reopens with no notice", async () => {
    const user = await createUser();
    auth.userId = user.id;
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO scan_history (user_id, url, scan_type, summary, findings, findings_count, duration, source, is_public)
       VALUES ($1, 'octocat/old-scan', 'github', '{}'::jsonb, '[]'::jsonb, 0, 10, 'web', FALSE)
       RETURNING id`,
      [user.id],
    );

    const reopened = await historyItemGET(
      new NextRequest(`http://localhost/api/v3/history/${rows[0].id}`),
      { params: Promise.resolve({ id: String(rows[0].id) }) },
    );
    expect(reopened.status).toBe(200);

    expect(historyAiReviewNotice(await reopened.json())).toBeNull();
  });
});
