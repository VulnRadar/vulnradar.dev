import { it, expect } from "vitest";
import type { PoolClient } from "pg";
import pool from "@/lib/database/db";
import {
  finalizeScanSuccess,
  finalizeScanFailure,
  markScanRunning,
} from "@/lib/scanner/scan-jobs";
import { reserveConcurrentScanSlot } from "@/lib/rate-limiting/concurrent-scans";
import { describeIntegration, createUser, createTeam } from "./_db";

/**
 * The scan lifecycle end to end: the pending INSERT the scan route writes,
 * the running flip, and the finalize UPDATE, read back from the table.
 *
 * This is a wide row (four JSONB columns) written by one statement and
 * rewritten by another several minutes later, and the two are in different
 * files. The unit suites assert each SQL string separately against a fake
 * pool, so nothing checks that the column the INSERT writes is the column the
 * UPDATE preserves. team_id is the specific one worth naming: it is set only
 * at INSERT, the finalize UPDATE never mentions it, and losing it silently
 * detaches a scan from the team that ran it.
 */
const FINDINGS = [
  {
    id: "missing-hsts",
    title: "Missing Strict-Transport-Security header",
    severity: "medium",
    category: "headers",
    description: "No HSTS header.",
    evidence: "response headers",
    riskImpact: "Downgrade attacks remain possible.",
    explanation: "HSTS pins the browser to HTTPS.",
    fixSteps: ["Send Strict-Transport-Security."],
    codeExamples: [],
  },
];

function successData(overrides: Record<string, unknown> = {}) {
  return {
    summary: { critical: 0, high: 0, medium: 1, low: 0, info: 0 },
    findings: FINDINGS,
    duration: 2431,
    scannedAt: new Date().toISOString(),
    responseHeaders: { server: "nginx" },
    resultMeta: { checksRun: 310, dangerScore: 17 },
    ...overrides,
  } as Parameters<typeof finalizeScanSuccess>[1];
}

async function insertPendingScan(
  userId: number,
  teamId: number | null,
): Promise<number> {
  const reservation = await reserveConcurrentScanSlot(
    userId,
    async (client: PoolClient) => {
      // Byte for byte the INSERT in app/api/v3/scan/route.ts.
      const res = await client.query<{ id: number }>(
        `INSERT INTO scan_history
           (user_id, url, source, notes, status, started_at, categories_total, is_public, team_id)
         VALUES ($1, $2, $3, $4, 'pending', NOW(), $5, $6, $7)
         RETURNING id`,
        [
          userId,
          "https://example.test/app",
          "web",
          "Full scan",
          12,
          false,
          teamId,
        ],
      );
      return res.rows[0].id;
    },
  );
  if (!reservation.ok) throw new Error("reservation refused");
  return reservation.scanId;
}

describeIntegration("scan_history insert then finalize", () => {
  it("round-trips a scan from pending to completed without losing team_id", async () => {
    const user = await createUser();
    const teamId = await createTeam(user.id);
    const scanId = await insertPendingScan(user.id, teamId);

    await markScanRunning(scanId);
    const running = await pool.query<{ status: string; started_at: Date }>(
      "SELECT status, started_at FROM scan_history WHERE id = $1",
      [scanId],
    );
    expect(running.rows[0].status).toBe("running");
    expect(running.rows[0].started_at).toBeInstanceOf(Date);

    const applied = await finalizeScanSuccess(scanId, successData());
    expect(applied).toBe(true);

    const { rows } = await pool.query<{
      status: string;
      team_id: number | null;
      findings_count: number;
      duration: number;
      is_public: boolean;
      url: string;
      current_category: string | null;
      categories_total: number;
      categories_completed: number;
      error_message: string | null;
      findings: unknown[];
      summary: Record<string, number>;
      result_meta: Record<string, unknown>;
    }>("SELECT * FROM scan_history WHERE id = $1", [scanId]);
    const row = rows[0];

    expect(row.status).toBe("completed");
    // The point of the test: set once at INSERT, never mentioned again.
    expect(row.team_id).toBe(teamId);
    // Also set only at INSERT.
    expect(row.is_public).toBe(false);
    expect(row.url).toBe("https://example.test/app");
    expect(row.categories_total).toBe(12);

    expect(row.findings_count).toBe(1);
    expect(row.duration).toBe(2431);
    expect(row.findings).toHaveLength(1);
    expect(row.summary.medium).toBe(1);
    expect(row.result_meta).toMatchObject({ checksRun: 310 });
    // The finalize UPDATE clears the in-progress fields.
    expect(row.current_category).toBeNull();
    expect(row.error_message).toBeNull();
    expect(row.categories_completed).toBe(row.categories_total);
  });

  it("writes the scan's tags in the same transaction as the status flip", async () => {
    // The status flip and the auto-tag INSERT share one client and one
    // transaction so a client polling the status endpoint can never see
    // 'completed' before the tags exist. Both halves committing is what
    // proves the tag INSERT is really running on that client.
    const user = await createUser();
    const scanId = await insertPendingScan(user.id, null);
    await finalizeScanSuccess(scanId, successData());

    const { rows } = await pool.query<{ tag: string; source: string }>(
      "SELECT tag, source FROM scan_tags WHERE scan_id = $1",
      [scanId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.source === "auto")).toBe(true);
  });

  it("refuses to overwrite a scan that already reached a terminal state", async () => {
    const user = await createUser();
    const scanId = await insertPendingScan(user.id, null);

    expect(await finalizeScanFailure(scanId, "watchdog timeout")).toBe(true);
    // The work finished after the watchdog gave up. The WHERE status IN
    // ('pending','running') guard has to make this a no-op rather than
    // resurrecting a scan the user was already told had failed.
    expect(await finalizeScanSuccess(scanId, successData())).toBe(false);

    const { rows } = await pool.query<{
      status: string;
      error_message: string;
      duration: number;
    }>(
      "SELECT status, error_message, duration FROM scan_history WHERE id = $1",
      [scanId],
    );
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error_message).toBe("watchdog timeout");
    // Derived in SQL from started_at, so it only works if started_at was
    // actually written by the INSERT above.
    expect(rows[0].duration).toBeGreaterThanOrEqual(0);
  });

  it("truncates an over-long failure reason instead of erroring on the column", async () => {
    const user = await createUser();
    const scanId = await insertPendingScan(user.id, null);
    // error_message is a bounded column: a stack trace longer than it would
    // throw 22001 on the write path and lose the failure entirely.
    await finalizeScanFailure(scanId, "x".repeat(9000));
    const { rows } = await pool.query<{ error_message: string }>(
      "SELECT error_message FROM scan_history WHERE id = $1",
      [scanId],
    );
    expect(rows[0].error_message.length).toBe(2000);
  });

  it("caches host reputation for a public scan and never for a private one", async () => {
    // upsertHostReputation is fire-and-forget from finalizeScanSuccess, so
    // poll rather than assert immediately.
    const user = await createUser();
    const publicScan = await pool.query<{ id: number }>(
      `INSERT INTO scan_history (user_id, url, status, is_public, started_at)
       VALUES ($1, 'https://public.example.test/', 'running', true, NOW()) RETURNING id`,
      [user.id],
    );
    await finalizeScanSuccess(publicScan.rows[0].id, successData());

    let cached = 0;
    for (let i = 0; i < 40 && cached === 0; i++) {
      const { rows } = await pool.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM host_reputation WHERE host = $1",
        ["public.example.test"],
      );
      cached = rows[0].n;
      if (cached === 0) await new Promise((r) => setTimeout(r, 50));
    }
    expect(cached).toBe(1);

    const privateScan = await pool.query<{ id: number }>(
      `INSERT INTO scan_history (user_id, url, status, is_public, started_at)
       VALUES ($1, 'https://private.example.test/', 'running', false, NOW()) RETURNING id`,
      [user.id],
    );
    await finalizeScanSuccess(privateScan.rows[0].id, successData());
    await new Promise((r) => setTimeout(r, 500));
    const { rows } = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM host_reputation WHERE host = $1",
      ["private.example.test"],
    );
    expect(rows[0].n).toBe(0);
  });
});
