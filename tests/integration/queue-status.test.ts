import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import {
  readFailureSample,
  readInflight,
  readQueueSnapshot,
  FAILED_SAMPLE_LIMIT,
} from "@/lib/scanner/queue-status";
import { isEngineFailure } from "@/lib/scanner/failure-kinds";
import { describeIntegration, createUser } from "./_db";

/**
 * The admin scanner queue's reads against a real database.
 *
 * "Failed" used to be every row with status = 'failed': a user pressing
 * Cancel, a limit turning a bulk URL away, a URL its batch never reached, a
 * target that was down and the scanner breaking all counted as one number.
 * Which row lands in which count is a GROUP BY over a nullable column and a
 * sample ordered by a boolean expression, and a faked pool answers either
 * however the test told it to (tests/README.md, "Two tiers, two rules").
 *
 * Asserted as deltas against a snapshot taken first, because the database is
 * shared with every other suite in this tier (they run one file at a time, so
 * nothing changes underneath a test, but the rows they left are still there).
 */
async function insertFailed(
  userId: number,
  kind: string | null,
  scannedAtSql = "NOW()",
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history
       (user_id, url, source, status, error_message, failure_kind, started_at, scanned_at)
     VALUES ($1, 'https://queue.example.test/', 'web', 'failed', $2, $3,
             NOW() - INTERVAL '1 minute', ${scannedAtSql})
     RETURNING id`,
    [userId, `reason for ${kind ?? "unrecorded"}`, kind],
  );
  return rows[0].id;
}

describeIntegration("scanner queue reads", () => {
  it("counts only the engine's own kinds as failed, and every other ending on its own", async () => {
    const user = await createUser();
    const before = (await readQueueSnapshot()).counts;

    // Engine: internal, timeout, interrupted, stale, and a row with no kind.
    for (const kind of ["internal", "timeout", "interrupted", "stale", null]) {
      await insertFailed(user.id, kind);
    }
    // The rest, each in its own count.
    await insertFailed(user.id, "cancelled");
    await insertFailed(user.id, "admin_cancelled");
    await insertFailed(user.id, "quota_refused");
    await insertFailed(user.id, "not_run");
    await insertFailed(user.id, "not_run");
    await insertFailed(user.id, "target_unreachable");
    await insertFailed(user.id, "target_tls");
    await insertFailed(user.id, "target_blocked");
    // Outside the 24 hour window: not counted anywhere.
    await insertFailed(user.id, "internal", "NOW() - INTERVAL '3 days'");
    await insertFailed(user.id, "cancelled", "NOW() - INTERVAL '3 days'");

    const after = (await readQueueSnapshot()).counts;

    expect(after.failedLast24h - before.failedLast24h).toBe(5);
    expect(after.cancelledLast24h - before.cancelledLast24h).toBe(2);
    expect(after.refusedLast24h - before.refusedLast24h).toBe(1);
    expect(after.notRunLast24h - before.notRunLast24h).toBe(2);
    expect(after.targetFailedLast24h - before.targetFailedLast24h).toBe(3);
    expect(after.completedLast24h).toBe(before.completedLast24h);
  });

  it("dates a failed scan from when it failed, not from when it was queued", async () => {
    const user = await createUser();
    // Queued three days ago, failed a minute ago: inside the window.
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO scan_history
         (user_id, url, status, failure_kind, started_at, scanned_at)
       VALUES ($1, 'https://old-queue.example.test/', 'failed', 'internal',
               NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 minute')
       RETURNING id`,
      [user.id],
    );

    const sample = await readFailureSample();

    expect(sample.some((r) => r.id === rows[0].id)).toBe(true);
  });

  // A bulk batch cut off by a limit writes dozens of rows at once. In a flat
  // newest-first sample they pushed the one real fault out of the 25.
  it("puts the engine's failures ahead of a flood of cancels in the sample", async () => {
    const user = await createUser();
    const engineId = await insertFailed(
      user.id,
      "internal",
      "NOW() - INTERVAL '2 hours'",
    );
    for (let i = 0; i < FAILED_SAMPLE_LIMIT + 5; i++) {
      await insertFailed(user.id, "cancelled");
    }

    const sample = await readFailureSample();

    expect(sample).toHaveLength(FAILED_SAMPLE_LIMIT);
    const firstOther = sample.findIndex(
      (r) => !isEngineFailure(r.failure_kind),
    );
    expect(firstOther).toBeGreaterThan(0);
    // Every engine row comes before every other row.
    expect(
      sample.slice(firstOther).every((r) => !isEngineFailure(r.failure_kind)),
    ).toBe(true);
    // The two hour old engine row beat thirty fresh cancels into the sample,
    // unless more than 25 engine rows exist, in which case it is still ahead
    // of every cancel.
    expect(
      sample.some((r) => r.id === engineId) ||
        sample.slice(0, firstOther).length === FAILED_SAMPLE_LIMIT,
    ).toBe(true);
  });

  it("lists what is in flight, oldest first", async () => {
    const user = await createUser();
    const { rows } = await pool.query<{ id: number; started: string }>(
      `INSERT INTO scan_history (user_id, url, source, status, started_at, current_category)
       VALUES
         ($1, 'https://newer.example.test/', 'api', 'running', NOW() - INTERVAL '4 hours', 'dns'),
         ($1, 'https://older.example.test/', 'web', 'pending', NOW() - INTERVAL '5 hours', NULL)
       RETURNING id, url AS started`,
      [user.id],
    );
    const newer = rows.find((r) => r.started.includes("newer"))!.id;
    const older = rows.find((r) => r.started.includes("older"))!.id;

    const inflight = await readInflight();

    const ids = inflight.map((r) => r.id);
    expect(ids).toContain(newer);
    expect(ids).toContain(older);
    expect(ids.indexOf(older)).toBeLessThan(ids.indexOf(newer));
    expect(inflight.find((r) => r.id === newer)).toMatchObject({
      user_id: user.id,
      source: "api",
      status: "running",
      current_category: "dns",
    });
    expect(
      inflight.every((r) => r.status === "pending" || r.status === "running"),
    ).toBe(true);
  });
});
