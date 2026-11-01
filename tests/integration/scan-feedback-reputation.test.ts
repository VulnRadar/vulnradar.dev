import { it, expect, afterAll } from "vitest";
import pool from "@/lib/database/db";
import { recomputeScanScore } from "@/lib/scanner/recompute-scan-score";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * A user's false-positive verdicts never rewrite a host's public reputation
 * unless that user has proven they control the host.
 *
 * host_reputation is one public row per host with no user_id: the browser
 * extension and /host/<hostname> read it for every visitor. Before this, any
 * account could scan a host publicly, mark every finding false positive, and
 * the recompute trimmed that row's findings, danger score and severity counts,
 * so a phishing operator with a free account could make the site read as safe.
 *
 * The unit tier fakes pool.query, so it can only say which statements were
 * sent. Whether the UPDATE really leaves the public row alone, and whether the
 * verified-domain lookup really matches the owner's zone, is a question for
 * Postgres.
 */
const seededScans: number[] = [];
const seededHosts: string[] = [];
// Removed in afterAll: the domain re-verification suite takes every verified
// row in the shared database as its due set, and a leftover row sorts ahead of
// its own because it has never been checked.
const seededDomains: string[] = [];

const FINDINGS = [
  {
    id: "sqli-1",
    severity: "critical",
    title: "SQL Injection",
    category: "injection",
    cwe: "CWE-89",
  },
  {
    id: "xss-1",
    severity: "high",
    title: "Reflected Cross-Site Scripting",
    category: "xss",
    cwe: "CWE-79",
  },
  {
    id: "hdr-1",
    severity: "low",
    title: "Missing X-Content-Type-Options",
    category: "headers",
  },
];
const ORIGINAL_COUNTS = { critical: 1, high: 1, medium: 0, low: 1, info: 0 };
const ORIGINAL_DANGER = 88;
const ORIGINAL_TAGS = ["Critical Exposure"];

async function seedPublicScanAndReputation(
  userId: number,
  host: string,
): Promise<number> {
  const url = `https://${host}/`;
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history
       (user_id, url, status, started_at, scanned_at, scan_type, is_public,
        findings, findings_count, summary)
     VALUES ($1, $2, 'completed', NOW(), NOW(), 'web', true, $3, $4, $5)
     RETURNING id`,
    [
      userId,
      url,
      JSON.stringify(FINDINGS),
      FINDINGS.length,
      JSON.stringify({ ...ORIGINAL_COUNTS, total: FINDINGS.length }),
    ],
  );
  const scanId = rows[0].id;
  seededScans.push(scanId);
  seededHosts.push(host);

  await pool.query(
    `INSERT INTO host_reputation
       (host, danger_score, severity_counts, source_scan_id, findings,
        scanned_url, auto_tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      host,
      ORIGINAL_DANGER,
      JSON.stringify(ORIGINAL_COUNTS),
      scanId,
      JSON.stringify(FINDINGS),
      url,
      JSON.stringify(ORIGINAL_TAGS),
    ],
  );
  return scanId;
}

async function markEveryFindingFalsePositive(
  userId: number,
  scanId: number,
  host: string,
): Promise<void> {
  for (const f of FINDINGS) {
    await pool.query(
      `INSERT INTO scan_finding_feedback
         (user_id, scan_history_id, finding_id, finding_url, verdict)
       VALUES ($1, $2, $3, $4, 'false_positive')`,
      [userId, scanId, f.id, `https://${host}/`],
    );
  }
}

async function reputationOf(host: string) {
  const { rows } = await pool.query<{
    danger_score: number;
    severity_counts: Record<string, number>;
    findings: Array<{ id: string }>;
    auto_tags: string[];
  }>(
    `SELECT danger_score, severity_counts, findings, auto_tags
       FROM host_reputation WHERE host = $1`,
    [host],
  );
  return rows[0];
}

async function scanSummaryOf(scanId: number) {
  const { rows } = await pool.query<{
    summary: Record<string, number>;
    findings_count: number;
  }>("SELECT summary, findings_count FROM scan_history WHERE id = $1", [
    scanId,
  ]);
  return rows[0];
}

describeIntegration("false-positive feedback and host reputation", () => {
  afterAll(async () => {
    if (seededDomains.length > 0) {
      await pool.query("DELETE FROM domains WHERE domain = ANY($1)", [
        seededDomains,
      ]);
    }
    if (seededHosts.length > 0) {
      await pool.query("DELETE FROM host_reputation WHERE host = ANY($1)", [
        seededHosts,
      ]);
    }
    if (seededScans.length > 0) {
      await pool.query(
        "DELETE FROM scan_finding_feedback WHERE scan_history_id = ANY($1::int[])",
        [seededScans],
      );
      await pool.query("DELETE FROM scan_history WHERE id = ANY($1::int[])", [
        seededScans,
      ]);
    }
  });

  it("leaves the public row untouched for a caller with no verified domain, and still updates their own scan", async () => {
    const host = `${unique("fp").replace(/[^a-z0-9]/g, "")}.example.test`;
    const userA = await createUser();
    const scanId = await seedPublicScanAndReputation(userA.id, host);
    await markEveryFindingFalsePositive(userA.id, scanId, host);

    await recomputeScanScore(scanId, userA.id);

    const rep = await reputationOf(host);
    expect(rep.danger_score).toBe(ORIGINAL_DANGER);
    expect(rep.severity_counts).toEqual(ORIGINAL_COUNTS);
    expect(rep.findings.map((f) => f.id)).toEqual(FINDINGS.map((f) => f.id));
    expect(rep.auto_tags).toEqual(ORIGINAL_TAGS);

    // Their own view still reflects their verdicts.
    const own = await scanSummaryOf(scanId);
    expect(own.findings_count).toBe(0);
    expect(own.summary.total).toBe(0);
  });

  it("does not count a domain verified by someone else, a pending one, or a lookalike", async () => {
    const label = unique("near").replace(/[^a-z0-9]/g, "");
    const host = `${label}.example.test`;
    const userA = await createUser();
    const realOwner = await createUser();
    const scanId = await seedPublicScanAndReputation(userA.id, host);
    // The last row is a string suffix of the host with no dot boundary
    // ("ear<id>.example.test" for "near<id>.example.test"), which a
    // `host LIKE '%' || domain` test would accept.
    seededDomains.push(host, `not${host}`, `${label.slice(1)}.example.test`);
    await pool.query(
      `INSERT INTO domains (user_id, domain, status, verification_token)
       VALUES ($1, $2, 'verified', $3),
              ($4, $2, 'pending', $5),
              ($4, $6, 'verified', $7),
              ($4, $8, 'verified', $9)`,
      [
        realOwner.id,
        host,
        unique("tok"),
        userA.id,
        unique("tok"),
        `not${host}`,
        unique("tok"),
        `${label.slice(1)}.example.test`,
        unique("tok"),
      ],
    );
    await markEveryFindingFalsePositive(userA.id, scanId, host);

    await recomputeScanScore(scanId, userA.id);

    const rep = await reputationOf(host);
    expect(rep.danger_score).toBe(ORIGINAL_DANGER);
    expect(rep.severity_counts).toEqual(ORIGINAL_COUNTS);
    expect(rep.findings).toHaveLength(FINDINGS.length);
  });

  it("cascades into the public row, auto_tags included, for the verified owner of the zone", async () => {
    const label = unique("own").replace(/[^a-z0-9]/g, "");
    const apex = `${label}.example.test`;
    const host = `app.${apex}`;
    const owner = await createUser();
    seededDomains.push(apex);
    await pool.query(
      `INSERT INTO domains (user_id, domain, status, verification_token, verified_at)
       VALUES ($1, $2, 'verified', $3, NOW())`,
      [owner.id, apex, unique("tok")],
    );
    const scanId = await seedPublicScanAndReputation(owner.id, host);
    await markEveryFindingFalsePositive(owner.id, scanId, host);

    await recomputeScanScore(scanId, owner.id);

    const rep = await reputationOf(host);
    expect(rep.findings).toEqual([]);
    expect(rep.severity_counts).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
    expect(rep.danger_score).toBe(0);
    expect(rep.auto_tags).toEqual(["Clean"]);
  });

  it("does not let a caller recompute a scan they do not own", async () => {
    const host = `${unique("idor").replace(/[^a-z0-9]/g, "")}.example.test`;
    const victim = await createUser();
    const attacker = await createUser();
    const scanId = await seedPublicScanAndReputation(victim.id, host);
    await markEveryFindingFalsePositive(attacker.id, scanId, host);

    await recomputeScanScore(scanId, attacker.id);

    const own = await scanSummaryOf(scanId);
    expect(own.findings_count).toBe(FINDINGS.length);
    expect((await reputationOf(host)).danger_score).toBe(ORIGINAL_DANGER);
  });
});
