import { it, expect, beforeEach } from "vitest";
import pool from "@/lib/database/db";
import { claimDueSchedules } from "@/lib/scanner/scheduled-scans-worker";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The scheduled-scan claim, against a real PostgreSQL.
 *
 * Every property here is one a faked pool answers identically whether the
 * query is right or wrong: whether `next_run_at <= NOW()` still selects the
 * row, whether the soft lock the claim writes actually takes it out of the
 * due set, whether `FOR UPDATE SKIP LOCKED` stops two callers taking the same
 * row. They are the whole reason a claim is safe to run more than once, so
 * they are asserted where the database evaluates them.
 *
 * The lease length matters as much as the lock. A lock shorter than the work
 * it covers is not a lock: the row becomes due again while the first caller
 * still has it, which is a duplicate scan and a second charge against the
 * owner's daily quota. The expiry case below is that failure, made explicit.
 */
describeIntegration("scheduled-scan claim", () => {
  let userId: number;

  beforeEach(async () => {
    // The claim is global: it takes whatever is due across every account, so
    // "these four rows and nothing else" is only assertable from an empty
    // table. Safe here because the tier runs one file at a time and no other
    // suite reads scheduled_scans rows it did not just insert.
    await pool.query("DELETE FROM scheduled_scans");
    const user = await createUser();
    userId = user.id;
  });

  async function insertDueSchedule(dueMinutesAgo = 1): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO scheduled_scans (user_id, url, frequency, active, next_run_at)
       VALUES ($1, $2, 'daily', true, NOW() - make_interval(mins => $3))
       RETURNING id`,
      [userId, `https://${unique("sched")}.example.test/`, dueMinutesAgo],
    );
    return rows[0].id;
  }

  async function nextRunAt(id: number): Promise<Date> {
    const { rows } = await pool.query<{ next_run_at: Date }>(
      `SELECT next_run_at FROM scheduled_scans WHERE id = $1`,
      [id],
    );
    return rows[0].next_run_at;
  }

  it("takes a due row and immediately puts it out of reach of the next claim", async () => {
    const id = await insertDueSchedule();

    const first = await claimDueSchedules(10, 15);
    expect(first.map((r) => r.id)).toContain(id);

    // The soft lock is the whole anti-double-run mechanism: the second claim
    // runs the same query against the same row and must come back empty.
    const second = await claimDueSchedules(10, 15);
    expect(second.map((r) => r.id)).not.toContain(id);
  });

  it("writes a lease of the length it was given, not a hardcoded one", async () => {
    const id = await insertDueSchedule();

    await claimDueSchedules(10, 120);

    const lockedUntil = await nextRunAt(id);
    const minutesOut = (lockedUntil.getTime() - Date.now()) / 60_000;
    // Generous bounds: the assertion is that 120 reached the interval, not
    // that the clock is exact.
    expect(minutesOut).toBeGreaterThan(115);
    expect(minutesOut).toBeLessThan(125);
  });

  it("makes the row claimable again once its lease has expired", async () => {
    const id = await insertDueSchedule();
    await claimDueSchedules(10, 15);

    // What a worker that outlives its lease looks like from the database's
    // side: the scan is still running, but the row is due again, so the next
    // polling tick claims it and runs it a second time. Renewing the lease
    // while a batch drains (renewClaims) is what keeps this from happening;
    // that the row is genuinely re-claimable once the lease lapses is what
    // makes the renewal load-bearing rather than decorative.
    await pool.query(
      `UPDATE scheduled_scans SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [id],
    );

    const reclaimed = await claimDueSchedules(10, 15);
    expect(reclaimed.map((r) => r.id)).toContain(id);
  });

  it("never hands the same row to two concurrent claims", async () => {
    const ids = [
      await insertDueSchedule(),
      await insertDueSchedule(),
      await insertDueSchedule(),
      await insertDueSchedule(),
    ];

    const claims = await Promise.all([
      claimDueSchedules(10, 15),
      claimDueSchedules(10, 15),
      claimDueSchedules(10, 15),
    ]);

    const claimedIds = claims.flat().map((r) => r.id);
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    expect(claimedIds.sort()).toEqual([...ids].sort());
  });

  it("leaves an inactive schedule alone however overdue it is", async () => {
    const id = await insertDueSchedule(60 * 24);
    await pool.query(
      `UPDATE scheduled_scans SET active = false WHERE id = $1`,
      [id],
    );

    const claimed = await claimDueSchedules(10, 15);

    expect(claimed.map((r) => r.id)).not.toContain(id);
    // And the claim did not quietly move its next_run_at either, so
    // reactivating it later does not skip an occurrence.
    const stillDue = await nextRunAt(id);
    expect(stillDue.getTime()).toBeLessThan(Date.now());
  });
});
