import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import {
  finalizeScanSuccess,
  markScanRunning,
  recordScanFailure,
  sweepStaleScans,
} from "@/lib/scanner/scan-jobs";
import { describeIntegration, createUser } from "./_db";

/**
 * The scan job row's lifecycle against real PostgreSQL, for the parts whose
 * correctness is what the database does rather than what a string says:
 * which value `status` has inside an UPDATE's SET list, whether a failed
 * statement really aborts the transaction the completion is in, and what a
 * COMMIT on that transaction answers.
 */

async function insertScan(
  userId: number,
  status: "pending" | "running",
  startedMinutesAgo: number,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history (user_id, url, source, status, started_at, categories_total)
     VALUES ($1, 'https://example.test/', 'web', $2,
             NOW() - ($3 || ' minutes')::interval, 12)
     RETURNING id`,
    [userId, status, String(startedMinutesAgo)],
  );
  return rows[0].id;
}

async function rowOf(scanId: number) {
  const { rows } = await pool.query<{
    status: string;
    duration: number;
    failure_kind: string | null;
  }>("SELECT status, duration, failure_kind FROM scan_history WHERE id = $1", [
    scanId,
  ]);
  return rows[0];
}

describeIntegration("scan job durations", () => {
  // A bulk batch reserves every row 'pending' up front. One the batch never
  // reached used to record its whole queue wait as the scan's duration.
  it("records zero for a pending row started 20 minutes ago and closed as not_run", async () => {
    const user = await createUser();
    const scanId = await insertScan(user.id, "pending", 20);

    expect(
      await recordScanFailure(
        scanId,
        "The bulk scan batch this URL belonged to stopped before it ran.",
        "not_run",
      ),
    ).not.toBeNull();

    const row = await rowOf(scanId);
    expect(row.status).toBe("failed");
    expect(row.failure_kind).toBe("not_run");
    expect(row.duration).toBe(0);
  });

  it("still counts a running row's time from started_at", async () => {
    const user = await createUser();
    const scanId = await insertScan(user.id, "running", 20);

    await recordScanFailure(scanId, "Scan exceeded its limit.", "timeout");

    const row = await rowOf(scanId);
    // Twenty minutes, give or take the test's own runtime.
    expect(row.duration).toBeGreaterThanOrEqual(20 * 60 * 1000);
    expect(row.duration).toBeLessThan(25 * 60 * 1000);
  });

  it("the stale sweep records zero for a pending row and real time for a running one", async () => {
    const user = await createUser();
    // A day old: past any grace window the configured budgets can produce.
    const pending = await insertScan(user.id, "pending", 24 * 60);
    const running = await insertScan(user.id, "running", 24 * 60);

    const swept = await sweepStaleScans("periodic");
    const sweptIds = swept.map((s) => s.id);
    expect(sweptIds).toContain(pending);
    expect(sweptIds).toContain(running);

    expect((await rowOf(pending)).duration).toBe(0);
    expect((await rowOf(running)).duration).toBeGreaterThanOrEqual(
      24 * 60 * 60 * 1000,
    );
  });
});

describeIntegration("markScanRunning", () => {
  it("flips a pending row and reports true", async () => {
    const user = await createUser();
    const scanId = await insertScan(user.id, "pending", 0);
    expect(await markScanRunning(scanId)).toBe(true);
    expect((await rowOf(scanId)).status).toBe("running");
  });

  // The in-memory cancel flag lapses after 20 minutes, which a queued bulk
  // row can outwait. The row itself is the record that it was cancelled.
  it("reports false for a row cancelled while it waited, and leaves it cancelled", async () => {
    const user = await createUser();
    const scanId = await insertScan(user.id, "pending", 30);
    await recordScanFailure(scanId, "Cancelled", "cancelled");

    expect(await markScanRunning(scanId)).toBe(false);
    const row = await rowOf(scanId);
    expect(row.status).toBe("failed");
    expect(row.failure_kind).toBe("cancelled");
  });
});

describeIntegration("finalizeScanSuccess when the tag write fails", () => {
  /**
   * The tags INSERT shares the completion's transaction. A failed statement
   * aborts a Postgres transaction, and the COMMIT that follows answers
   * ROLLBACK without raising, so a swallowed tag error used to discard the
   * completion while finalizeScanSuccess returned true over a row still
   * 'running'. A scan with no findings is tagged exactly 'Clean', so a CHECK
   * refusing that tag makes the INSERT fail for real.
   */
  it("leaves the row completed, never reports true over a row still running", async () => {
    const constraint = "scan_jobs_test_no_clean_tag";
    // NOT VALID: rows other suites already wrote are not re-checked.
    await pool.query(
      `ALTER TABLE scan_tags ADD CONSTRAINT ${constraint} CHECK (tag <> 'Clean') NOT VALID`,
    );
    try {
      const user = await createUser();
      const scanId = await insertScan(user.id, "running", 1);
      const errors: unknown[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => errors.push(args);
      let applied: boolean;
      try {
        applied = await finalizeScanSuccess(scanId, {
          summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          findings: [],
          duration: 1500,
          scannedAt: new Date().toISOString(),
          responseHeaders: { "set-cookie": "session=abc", server: "nginx" },
          resultMeta: { checksRun: 310 },
        });
      } finally {
        console.error = original;
      }

      const row = await rowOf(scanId);
      expect(applied).toBe(true);
      expect(row.status).toBe("completed");
      expect(row.duration).toBe(1500);
      // The tag write was what failed, and only it was undone.
      const tags = await pool.query(
        "SELECT tag FROM scan_tags WHERE scan_id = $1",
        [scanId],
      );
      expect(tags.rows).toEqual([]);
      expect(errors.length).toBeGreaterThan(0);

      // The column itself never holds the target's cookie.
      const headers = await pool.query<{
        response_headers: Record<string, string>;
      }>("SELECT response_headers FROM scan_history WHERE id = $1", [scanId]);
      expect(headers.rows[0].response_headers).toEqual({
        "set-cookie": "[redacted]",
        server: "nginx",
      });
    } finally {
      await pool.query(
        `ALTER TABLE scan_tags DROP CONSTRAINT IF EXISTS ${constraint}`,
      );
    }
  });
});
