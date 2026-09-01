/**
 * Concurrent-scan capacity limit (PlanLimits.concurrentScans, see
 * lib/billing/catalog.ts's own doc comment on that field for the full
 * reasoning). VulnRadar runs as one persistent Node process with no job
 * queue (see lib/scanner/execute-scan.ts), so every scan currently in
 * status 'pending'/'running' is sharing that one process's resources with
 * every other user's in-flight scan -- this is a real capacity limit, not
 * a demand-shaping one.
 *
 * Deliberately counts scan_history rows, not an in-memory counter: a
 * single URL scan (POST /scan) and a crawl's own tracker row both hold a
 * 'pending'/'running' row for their real duration. A crawl's individual
 * page rows do NOT count -- they're written directly with status
 * 'completed' (the table's own default) after that page has already been
 * scanned, so they never occupy a slot of their own (see
 * lib/scanner/execute-crawl-scan.ts).
 */

import type { PoolClient } from "pg";
import pool from "@/lib/database/db";
import { getUserPlanLimits } from "@/lib/billing/plan-limits";

export interface ConcurrentScanCheck {
  allowed: boolean;
  current: number;
  /** -1 means unlimited (billing disabled, or the plan's own limit is -1). */
  limit: number;
  message?: string;
}

/**
 * Resolve the user's concurrent-scan cap. -1 means unlimited (no plan
 * resolved, e.g. billing disabled, or the plan's own value is -1). A
 * non-finite (corrupt) configured value fails CLOSED to a restrictive cap:
 * NaN used to fall straight through to `current >= NaN` (always false),
 * silently granting unlimited concurrency; the daily-quota path already fails
 * closed on the same corruption.
 */
async function resolveConcurrentLimit(userId: number): Promise<number> {
  const limits = await getUserPlanLimits(userId);
  if (!limits) return -1;
  const rawLimit = limits.concurrentScans;
  return Number.isFinite(rawLimit) ? rawLimit : 1;
}

function overLimitMessage(current: number): string {
  return `You already have ${current} scan(s) running. Wait for one to finish, or upgrade for more concurrent scans.`;
}

export async function checkConcurrentScanLimit(
  userId: number,
): Promise<ConcurrentScanCheck> {
  const limit = await resolveConcurrentLimit(userId);
  if (limit === -1) {
    return { allowed: true, current: 0, limit: -1 };
  }

  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM scan_history
     WHERE user_id = $1 AND status IN ('pending', 'running')`,
    [userId],
  );
  const current = result.rows[0]?.count ?? 0;

  if (current >= limit) {
    return {
      allowed: false,
      current,
      limit,
      message: overLimitMessage(current),
    };
  }
  return { allowed: true, current, limit };
}

/**
 * Authoritatively reserve a concurrent-scan slot AND insert the scan_history
 * 'pending' row in one transaction, serialized per-user with an advisory
 * lock. `checkConcurrentScanLimit` above is check-then-act: it counts, then
 * the caller inserts the row much later (after DNS validation, access rules,
 * etc.), so N parallel requests could all pass the count and all insert,
 * overshooting the cap. This closes that race -- the count and the insert
 * that consumes the slot happen inside the same locked transaction, so a
 * concurrent request either waits for the lock or sees the just-inserted row.
 * The early check stays as a best-effort fast-fail before the expensive work.
 *
 * `insertRow` must INSERT the scan row on the client it is handed and return
 * the new id. Returns the id on success, or the limit result if the user is
 * already at capacity (nothing is inserted in that case).
 */
/**
 * Slots held by scans that run INLINE inside a request and never pass through
 * a 'pending'/'running' scan_history row: POST /api/v3/scan/authenticated
 * inserts only after the scan has finished, so it is invisible to the row
 * count above and would otherwise take no slot and never be capped. (POST
 * /api/v3/scan/bulk used to be the other such path; it now reserves real
 * 'pending' rows through reserveConcurrentScanBatch below and runs detached,
 * so it is counted by the row query like every other scan.)
 *
 * An in-memory map is the right store specifically here, and only because
 * VulnRadar runs as ONE persistent Node process (this file's own header says
 * so, and the cap it enforces is that process's capacity). A restart drops
 * the counts, which is correct: the inline work died with the process.
 */
const inlineSlots = new Map<number, number>();

/**
 * Run `work` holding one concurrency slot, counted against the same per-plan
 * cap as the row-backed scans. Returns the limit result instead of running
 * when the user is already at capacity.
 *
 * The check and the increment are deliberately not separated by an `await`:
 * Node runs one request's synchronous block to completion, so two concurrent
 * requests cannot both read the same count and both claim the last slot.
 */
export async function withInlineScanSlot<T>(
  userId: number,
  work: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; check: ConcurrentScanCheck }> {
  const limit = await resolveConcurrentLimit(userId);
  if (limit === -1) {
    return { ok: true, value: await work() };
  }

  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM scan_history
     WHERE user_id = $1 AND status IN ('pending', 'running')`,
    [userId],
  );
  const rowsRunning = result.rows[0]?.count ?? 0;
  const held = inlineSlots.get(userId) ?? 0;
  const current = rowsRunning + held;
  if (current >= limit) {
    return {
      ok: false,
      check: {
        allowed: false,
        current,
        limit,
        message: overLimitMessage(current),
      },
    };
  }
  inlineSlots.set(userId, held + 1);

  try {
    return { ok: true, value: await work() };
  } finally {
    const remaining = (inlineSlots.get(userId) ?? 1) - 1;
    if (remaining > 0) inlineSlots.set(userId, remaining);
    else inlineSlots.delete(userId);
  }
}

/** Test-only: drop every held inline slot. Never called by product code. */
export function __resetInlineScanSlots(): void {
  inlineSlots.clear();
}

export async function reserveConcurrentScanSlot(
  userId: number,
  insertRow: (client: PoolClient) => Promise<number>,
): Promise<
  { ok: true; scanId: number } | { ok: false; check: ConcurrentScanCheck }
> {
  const limit = await resolveConcurrentLimit(userId);
  const client = await pool.connect();
  try {
    // Unlimited: no slot accounting needed, just insert.
    if (limit === -1) {
      const scanId = await insertRow(client);
      return { ok: true, scanId };
    }

    await client.query("BEGIN");
    // Serialize this user's slot reservations. A transaction-scoped advisory
    // lock auto-releases on COMMIT/ROLLBACK; keyed per-user so different
    // users never contend.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `concurrent-scan:${userId}`,
    ]);
    const countRes = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM scan_history
       WHERE user_id = $1 AND status IN ('pending', 'running')`,
      [userId],
    );
    const current = countRes.rows[0]?.count ?? 0;
    if (current >= limit) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        check: {
          allowed: false,
          current,
          limit,
          message: overLimitMessage(current),
        },
      };
    }
    const scanId = await insertRow(client);
    await client.query("COMMIT");
    return { ok: true, scanId };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Admit a whole bulk batch and insert every one of its 'pending' rows in one
 * locked transaction, the same way `reserveConcurrentScanSlot` admits a single
 * scan.
 *
 * The cap is deliberately applied to the batch as a unit rather than per URL.
 * `concurrentScans` limits how many scans RUN at once, and a batch runs its
 * URLs one at a time (lib/scanner/execute-bulk-scan.ts), so a submission of N
 * URLs never exceeds it however large N is. Reserving per URL instead would
 * mean a Core Supporter (cap 2) could only ever queue 2 of the 10 URLs their
 * plan sells them, which is the cap answering a question it was not asked.
 *
 * What the batch's rows DO occupy while they wait is the account's own slot
 * count, since the query above counts every 'pending' row. That is the
 * intended reading: the account really does have N scans outstanding, so a
 * second batch (or a single scan) started before the first drains is refused
 * until it does. This function therefore refuses only when the account is
 * already at capacity before the batch is admitted at all.
 */
export async function reserveConcurrentScanBatch(
  userId: number,
  insertRows: (client: PoolClient) => Promise<number[]>,
): Promise<
  { ok: true; scanIds: number[] } | { ok: false; check: ConcurrentScanCheck }
> {
  const limit = await resolveConcurrentLimit(userId);
  const client = await pool.connect();
  try {
    if (limit === -1) {
      const scanIds = await insertRows(client);
      return { ok: true, scanIds };
    }

    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `concurrent-scan:${userId}`,
    ]);
    const countRes = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM scan_history
       WHERE user_id = $1 AND status IN ('pending', 'running')`,
      [userId],
    );
    const current = countRes.rows[0]?.count ?? 0;
    if (current >= limit) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        check: {
          allowed: false,
          current,
          limit,
          message: overLimitMessage(current),
        },
      };
    }
    const scanIds = await insertRows(client);
    await client.query("COMMIT");
    return { ok: true, scanIds };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
