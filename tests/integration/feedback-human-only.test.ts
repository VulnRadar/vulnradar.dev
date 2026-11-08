import { it, expect, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { AI_FEEDBACK_NOTE } from "@/lib/scanner/feedback-source";
import {
  attachOwnerFindingState,
  getFalsePositiveIds,
} from "@/lib/scanner/remediation-store";
import { checkForNewCriticalOrHighFindings } from "@/lib/scanner/regression-alert";
import { recomputeScanScore } from "@/lib/scanner/recompute-scan-score";
import { buildDigestForUser } from "@/lib/notifications/posture-digest";
import { POST } from "@/app/api/v3/scan/feedback/route";
import type { Vulnerability } from "@/lib/scanner/types";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * Only a verdict a person gave can silence a finding (owner decision T2).
 *
 * The AI verifier files its possible_fp as `verdict = 'false_positive'` under
 * the user's id. Before this, every reader below took that as the user's own
 * call: the regression alert stayed quiet, the digest left the finding out, and
 * the owner's view flagged it suppressed, which is what the CI gate
 * (history/[id]/report without includeSuppressed) filters on. The gate's own
 * text says "findings you marked", and the user had marked nothing.
 *
 * The rule is one WHERE fragment with a COALESCE in it, and whether a NULL note
 * survives that comparison is a question for Postgres: a faked pool answers the
 * filter and its absence identically.
 */
let sessionUserId: number | null = null;
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: async () =>
      sessionUserId === null ? null : { userId: sessionUserId },
  };
});

const seededUsers: number[] = [];

async function seedUser(): Promise<number> {
  const user = await createUser();
  seededUsers.push(user.id);
  return user.id;
}

function urlFor(prefix: string): string {
  return `https://${unique(prefix).replace(/[^a-z0-9]/g, "")}.example.test/`;
}

function finding(id: string, severity: "critical" | "high"): Vulnerability {
  return {
    id,
    title: `Finding ${id}`,
    severity,
    category: "headers",
    description: "d",
    evidence: "e",
    riskImpact: "r",
    explanation: "x",
    fixSteps: [],
    codeExamples: [],
  };
}

async function markFeedback(
  userId: number,
  findingId: string,
  url: string,
  verdict: "false_positive" | "confirmed",
  notes: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO scan_finding_feedback
       (user_id, finding_id, finding_url, verdict, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, findingId, url, verdict, notes],
  );
}

async function seedCompletedScan(
  userId: number,
  url: string,
  findings: Vulnerability[],
  scannedAt: Date,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history
       (user_id, url, status, started_at, scanned_at, scan_type, findings,
        findings_count, summary)
     VALUES ($1, $2, 'completed', $3, $3, 'web', $4, $5, '{}')
     RETURNING id`,
    [userId, url, scannedAt, JSON.stringify(findings), findings.length],
  );
  return rows[0].id;
}

describeIntegration("AI-written feedback never suppresses a finding", () => {
  afterAll(async () => {
    if (seededUsers.length === 0) return;
    await pool.query(
      "DELETE FROM scan_finding_feedback WHERE user_id = ANY($1::int[])",
      [seededUsers],
    );
    await pool.query(
      "DELETE FROM scan_history WHERE user_id = ANY($1::int[])",
      [seededUsers],
    );
  });

  it("getFalsePositiveIds leaves out an AI-only row and keeps a human one, with or without a note", async () => {
    const userId = await seedUser();
    const url = urlFor("gate");
    await markFeedback(
      userId,
      "ai-only",
      url,
      "false_positive",
      AI_FEEDBACK_NOTE,
    );
    await markFeedback(userId, "human-note", url, "false_positive", "Our WAF.");
    await markFeedback(userId, "human-bare", url, "false_positive", null);
    await markFeedback(userId, "human-confirmed", url, "confirmed", null);

    const ids = await getFalsePositiveIds(userId);

    expect([...ids].sort()).toEqual(["human-bare", "human-note"]);
  });

  it("recomputeScanScore only takes out the finding a person marked", async () => {
    const userId = await seedUser();
    const url = urlFor("score");
    const scanId = await seedCompletedScan(
      userId,
      url,
      [finding("ai-only", "high"), finding("human-bare", "high")],
      new Date(),
    );
    await markFeedback(
      userId,
      "ai-only",
      url,
      "false_positive",
      AI_FEEDBACK_NOTE,
    );
    await markFeedback(userId, "human-bare", url, "false_positive", null);

    await recomputeScanScore(scanId, userId);

    const { rows } = await pool.query<{ findings_count: number }>(
      "SELECT findings_count FROM scan_history WHERE id = $1",
      [scanId],
    );
    expect(rows[0].findings_count).toBe(1);
  });

  it("only flags the human-marked finding suppressed, which is the flag the CI gate filters on", async () => {
    const userId = await seedUser();
    const url = urlFor("owner");
    await markFeedback(
      userId,
      "ai-only",
      url,
      "false_positive",
      AI_FEEDBACK_NOTE,
    );
    await markFeedback(userId, "human", url, "false_positive", null);

    const out = await attachOwnerFindingState(userId, url, [
      finding("ai-only", "critical"),
      finding("human", "critical"),
    ]);

    expect(out.find((f) => f.id === "ai-only")?.suppressed).toBeUndefined();
    expect(out.find((f) => f.id === "human")?.suppressed).toBe(true);
  });

  it("makes the row human when the person clicks the verdict the AI filled in", async () => {
    const userId = await seedUser();
    const url = urlFor("click");
    await markFeedback(
      userId,
      "ai-then-human",
      url,
      "false_positive",
      AI_FEEDBACK_NOTE,
    );
    expect(await getFalsePositiveIds(userId)).toEqual(new Set());

    sessionUserId = userId;
    const res = await POST(
      new NextRequest("http://localhost/scan/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          findingId: "ai-then-human",
          findingUrl: url,
          verdict: "false_positive",
        }),
      }),
    );
    sessionUserId = null;

    expect(res.status).toBe(200);
    expect(await getFalsePositiveIds(userId)).toEqual(
      new Set(["ai-then-human"]),
    );
  });

  it("alerts on a regression the AI called a false positive and stays quiet for one a person did", async () => {
    const userId = await seedUser();
    const url = urlFor("alert");
    const before = new Date(Date.now() - 86_400_000);
    await seedCompletedScan(
      userId,
      url,
      [finding("still-ai", "high"), finding("still-human", "high")],
      before,
    );
    for (const id of ["new-ai", "still-ai"]) {
      await markFeedback(userId, id, url, "false_positive", AI_FEEDBACK_NOTE);
    }
    for (const id of ["new-human", "still-human"]) {
      await markFeedback(userId, id, url, "false_positive", null);
    }
    const current = await seedCompletedScan(userId, url, [], new Date());

    const result = await checkForNewCriticalOrHighFindings({
      userId,
      url,
      scanId: current,
      currentFindings: [
        finding("new-ai", "critical"),
        finding("new-human", "critical"),
        finding("still-ai", "high"),
        finding("still-human", "high"),
      ],
    });

    expect(result.hasNewCriticalOrHigh).toBe(true);
    expect(result.newFindings.map((f) => f.id)).toEqual(["new-ai"]);
    expect(result.outstandingFindings.map((f) => f.id)).toEqual(["still-ai"]);
  });

  it("keeps an AI-marked finding in the digest and leaves a human-marked one out", async () => {
    const userId = await seedUser();
    const url = urlFor("digest");
    await seedCompletedScan(
      userId,
      url,
      [finding("ai-only", "critical"), finding("human", "high")],
      new Date(),
    );
    await markFeedback(
      userId,
      "ai-only",
      url,
      "false_positive",
      AI_FEEDBACK_NOTE,
    );
    await markFeedback(userId, "human", url, "false_positive", null);

    const digest = await buildDigestForUser(
      userId,
      new Date(Date.now() - 7 * 86_400_000),
    );

    expect(digest?.newFindings).toEqual([
      { title: "Finding ai-only", severity: "critical", url },
    ]);
    expect(digest?.newFindingsTotal).toBe(1);
    expect(digest?.currentOpenCount).toBe(1);
  });
});
