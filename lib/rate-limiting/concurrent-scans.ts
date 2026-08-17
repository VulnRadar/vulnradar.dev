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

import pool from "@/lib/database/db";
import { getUserPlanLimits } from "@/lib/billing/plan-limits";

export interface ConcurrentScanCheck {
  allowed: boolean;
  current: number;
  /** -1 means unlimited (billing disabled, or the plan's own limit is -1). */
  limit: number;
  message?: string;
}

export async function checkConcurrentScanLimit(
  userId: number,
): Promise<ConcurrentScanCheck> {
  const limits = await getUserPlanLimits(userId);
  const limit = limits?.concurrentScans ?? -1;

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
      message: `You already have ${current} scan(s) running. Wait for one to finish, or upgrade for more concurrent scans.`,
    };
  }
  return { allowed: true, current, limit };
}
