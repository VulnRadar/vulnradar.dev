import { it, expect, afterAll, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { AI_FEEDBACK_NOTE } from "@/lib/scanner/feedback-source";
import type { Vulnerability } from "@/lib/scanner/types";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * Scoring and identity against a real PostgreSQL: the owner's verdicts applied
 * when a scan is finalised, the public reputation row left alone by them, the
 * per-check accuracy counted in people rather than rows, the feedback route
 * refusing a finding the scan never reported, the recompute merging its
 * grading keys into result_meta, and the remap of triage onto the new ids.
 *
 * Each of these is decided by SQL the unit tier fakes: a JSONB containment, a
 * DISTINCT inside array_agg, a COALESCE(...) || merge, an ON CONFLICT DO
 * NOTHING. A faked pool answers all of them the same way whether they are
 * right or not.
 *
 * Only the network and the check engine are mocked: the scan is driven with
 * the findings below rather than with a real page.
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

let pageFindings: Vulnerability[] = [];
vi.mock("@/lib/scanner/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scanner/engine")>()),
  runSyncChecksYielding: async () => ({
    findings: pageFindings,
    checksRun: pageFindings.length,
    checksSkipped: 0,
    checksErrored: 0,
    erroredChecks: [],
    deduped: 0,
  }),
}));
vi.mock("@/lib/scanner/safe-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scanner/safe-fetch")>()),
  safeFetch: async () =>
    new Response("<html><body>ok</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
}));
vi.mock("@/lib/scanner/async-checks", () => ({
  runAsyncChecksDetailed: async () => ({ findings: [], incomplete: [] }),
  getPlannedAsyncBranches: () => [],
}));
vi.mock("@/lib/scanner/subdomain-auto", () => ({
  autoDiscoverSubdomains: async () => {},
  readSubdomains: () => undefined,
}));
vi.mock("@/lib/scanner/cve-enrichment", () => ({
  enrichFindingsWithExploitIntel: async (f: unknown) => f,
}));
vi.mock("@/lib/scanner/software-inventory", () => ({
  analyzeSoftwareInventory: async () => null,
}));
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: async () => {},
}));
vi.mock("@/lib/webhooks/delivery", () => ({
  deliverWebhook: async () => {},
}));

const { executeScan } = await import("@/lib/scanner/execute-scan");
const { recomputeScanScore } =
  await import("@/lib/scanner/recompute-scan-score");
const { aggregateCheckAccuracy, assessCheckAccuracy } =
  await import("@/lib/scanner/check-accuracy");
const { scoreFindings } = await import("@/lib/scanner/score-findings");
const { POST: postFeedback } = await import("@/app/api/v3/scan/feedback/route");
const { remapLegacyFindingIds } =
  await import("@/lib/scanner/finding-id-remap");
const { generateId, legacyFindingId } = await import("@/lib/scanner/_helpers");

const seededUsers: number[] = [];
const seededHosts: string[] = [];

async function seedUser(): Promise<number> {
  const user = await createUser();
  seededUsers.push(user.id);
  return user.id;
}

function hostFor(prefix: string): string {
  return `${unique(prefix).replace(/[^a-z0-9]/g, "")}.example.test`;
}

function vuln(id: string, severity: Vulnerability["severity"]): Vulnerability {
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
    confidence: 90,
  };
}

async function seedScan(
  userId: number,
  url: string,
  status: "pending" | "completed",
  findings: Vulnerability[] = [],
  resultMeta: Record<string, unknown> = {},
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history
       (user_id, url, status, started_at, scanned_at, scan_type, findings,
        findings_count, summary, result_meta)
     VALUES ($1, $2, $3, NOW(), NOW(), 'web', $4, $5, '{}', $6)
     RETURNING id`,
    [
      userId,
      url,
      status,
      JSON.stringify(findings),
      findings.length,
      JSON.stringify(resultMeta),
    ],
  );
  return rows[0].id;
}

async function verdict(
  userId: number,
  findingId: string,
  url: string,
  value: "false_positive" | "confirmed",
  notes: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO scan_finding_feedback
       (user_id, finding_id, finding_url, verdict, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, findingId, url, value, notes],
  );
}

describeIntegration("scan scoring and identity", () => {
  beforeEach(() => {
    sessionUserId = null;
    pageFindings = [];
  });

  afterAll(async () => {
    if (seededHosts.length > 0) {
      await pool.query("DELETE FROM host_reputation WHERE host = ANY($1)", [
        seededHosts,
      ]);
    }
    if (seededUsers.length === 0) return;
    for (const table of [
      "scan_finding_feedback",
      "finding_remediation",
      "scan_tags",
      "scan_history",
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE user_id = ANY($1::int[])`, [
        seededUsers,
      ]);
    }
  });

  it("finalises a scan without the owner's false positive, and leaves the public row describing it", async () => {
    const userId = await seedUser();
    const host = hostFor("finalise");
    seededHosts.push(host);
    const url = `https://${host}/`;
    const X = vuln("xss-reflected--finalise", "critical");
    const Y = vuln("hsts-missing--finalise", "low");
    await verdict(userId, X.id, url, "false_positive");
    const scanId = await seedScan(userId, url, "pending");
    pageFindings = [X, Y];

    await executeScan({
      scanId,
      url,
      normalizedUrl: url,
      protocolType: "http",
      isRawIpTarget: false,
      selectedScanners: null,
      authedUserId: userId,
      categoriesTotal: 1,
    });

    const { rows } = await pool.query<{
      status: string;
      summary: Record<string, number>;
      findings_count: number;
      findings: Vulnerability[];
      result_meta: Record<string, unknown>;
    }>(
      `SELECT status, summary, findings_count, findings, result_meta
         FROM scan_history WHERE id = $1`,
      [scanId],
    );
    const row = rows[0];
    expect(row.status).toBe("completed");
    expect(row.summary.critical).toBe(0);
    expect(row.summary.total).toBe(1);
    expect(row.findings_count).toBe(1);
    expect(row.findings.map((f) => f.id).sort()).toEqual([X.id, Y.id].sort());
    const withoutX = scoreFindings([Y], new Set());
    expect(row.result_meta.siteGrade).toBe(withoutX.siteGrade);
    expect(row.result_meta.safetyRating).toBe(withoutX.safetyRating);

    // The verdict is the scanning account's own; the public row is not.
    // upsertHostReputation is fire-and-forget, so give it a moment.
    let rep: { severity_counts: Record<string, number> } | undefined;
    for (let i = 0; i < 50 && !rep; i++) {
      const res = await pool.query<{
        severity_counts: Record<string, number>;
      }>("SELECT severity_counts FROM host_reputation WHERE host = $1", [host]);
      rep = res.rows[0];
      if (!rep) await new Promise((r) => setTimeout(r, 20));
    }
    expect(rep?.severity_counts.critical).toBe(1);
  });

  it("stores what changed since the owner's previous completed scan", async () => {
    const userId = await seedUser();
    const host = hostFor("diff");
    seededHosts.push(host);
    const url = `https://${host}/`;
    const X = vuln("xss-reflected--diff", "critical");
    const Y = vuln("hsts-missing--diff", "low");
    const Z = vuln("csp-missing--diff", "medium");
    const previous = await seedScan(userId, url, "completed", [X, Z]);
    const scanId = await seedScan(userId, url, "pending");
    pageFindings = [X, Y];

    await executeScan({
      scanId,
      url,
      normalizedUrl: url,
      protocolType: "http",
      isRawIpTarget: false,
      selectedScanners: null,
      authedUserId: userId,
      categoriesTotal: 1,
    });

    const { rows } = await pool.query<{
      result_meta: { diffAgainst?: unknown };
    }>("SELECT result_meta FROM scan_history WHERE id = $1", [scanId]);
    expect(rows[0].result_meta.diffAgainst).toEqual({
      previousScanId: previous,
      newIds: [Y.id],
      fixedIds: [Z.id],
    });
  });

  it("counts 26 false positives from one account as one report, and ignores the AI's", async () => {
    const one = await seedUser();
    const checkId = unique("noisy-check").replace(/[^a-z0-9-]/g, "");
    for (let i = 0; i < 26; i++) {
      await verdict(
        one,
        `${checkId}--p${i}`,
        `https://p${i}.example.test/`,
        "false_positive",
      );
    }
    for (let i = 0; i < 3; i++) {
      const other = await seedUser();
      await verdict(
        other,
        `${checkId}--ai${i}`,
        `https://ai${i}.example.test/`,
        "false_positive",
        AI_FEEDBACK_NOTE,
      );
    }

    const counts = (await aggregateCheckAccuracy()).get(checkId);

    expect(counts).toMatchObject({ falsePositive: 1, total: 1, users: 1 });
    expect(
      assessCheckAccuracy(counts!, "critical", {
        thresholdPercent: 20,
        minSampleSize: 5,
      }).flagged,
    ).toBe(false);
  });

  it("takes a verdict only on a finding the named scan reported", async () => {
    const userId = await seedUser();
    const url = `https://${hostFor("route")}/`;
    const X = vuln("xss-reflected--route", "critical");
    const scanId = await seedScan(userId, url, "completed", [X]);
    sessionUserId = userId;

    const post = (findingId: string) =>
      postFeedback(
        new NextRequest("http://localhost/scan/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            findingId,
            findingUrl: url,
            scanHistoryId: scanId,
            verdict: "false_positive",
          }),
        }),
      );

    expect((await post("xss-reflected--not-in-this-scan")).status).toBe(400);
    expect((await post(X.id)).status).toBe(200);

    const { rows } = await pool.query<{ finding_id: string }>(
      "SELECT finding_id FROM scan_finding_feedback WHERE user_id = $1",
      [userId],
    );
    expect(rows.map((r) => r.finding_id)).toEqual([X.id]);
  });

  it("merges the recomputed grade into result_meta and keeps the rest", async () => {
    const userId = await seedUser();
    const url = `https://${hostFor("recompute")}/`;
    const X = vuln("xss-reflected--recompute", "critical");
    const Y = vuln("hsts-missing--recompute", "low");
    const scanId = await seedScan(userId, url, "completed", [X, Y], {
      checksRun: 300,
      siteGrade: "F",
    });
    await verdict(userId, X.id, url, "false_positive");

    await recomputeScanScore(scanId, userId);

    const { rows } = await pool.query<{
      result_meta: Record<string, unknown>;
      findings_count: number;
    }>("SELECT result_meta, findings_count FROM scan_history WHERE id = $1", [
      scanId,
    ]);
    expect(rows[0].findings_count).toBe(1);
    expect(rows[0].result_meta.checksRun).toBe(300);
    expect(rows[0].result_meta.siteGrade).toBe(
      scoreFindings([Y], new Set()).siteGrade,
    );
  });

  it("carries a verdict stored under the old id over to the new one, once", async () => {
    const userId = await seedUser();
    const bare = `https://${hostFor("remap")}`;
    const oldId = legacyFindingId("csp-missing", bare);
    const newId = generateId("csp-missing", bare);
    expect(newId).not.toBe(oldId);
    await verdict(userId, oldId, bare, "false_positive", "Our CDN sets it.");

    await remapLegacyFindingIds(pool);
    await remapLegacyFindingIds(pool);

    const { rows } = await pool.query<{
      finding_id: string;
      finding_url: string;
      notes: string | null;
    }>(
      `SELECT finding_id, finding_url, notes FROM scan_finding_feedback
        WHERE user_id = $1 ORDER BY id`,
      [userId],
    );
    expect(rows).toEqual([
      { finding_id: oldId, finding_url: bare, notes: "Our CDN sets it." },
      {
        finding_id: newId,
        finding_url: `${bare}/`,
        notes: "Our CDN sets it.",
      },
    ]);
  });
});
