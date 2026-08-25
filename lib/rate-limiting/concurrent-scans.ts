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
