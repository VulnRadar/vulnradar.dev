import pool from "@/lib/database/db";

/**
 * Deleting scans and the public host reports built from them.
 *
 * host_reputation.source_scan_id is ON DELETE SET NULL, so deleting a scan
 * does not remove the findings copy that /host/<hostname> and the extension
 * reputation endpoint serve from it. It orphans the row: source_scan_id goes
 * NULL, every purge path keys on that column, and nothing can ever reach the
 * findings again. The user's own delete routes and account deletion purge the
 * reputation rows first for exactly this reason. The admin "Delete All Scans"
 * action and the blocked-domain purge were the two paths that did not, and
 * they are the two an operator reaches for in an abuse or takedown case, where
 * "the findings are gone" is the whole point.
 *
 * One statement rather than two, so the set of scans, the reports they sourced
 * and the delete itself all come from one snapshot. A scan that finishes
 * halfway through is simply not in the set; it can never be deleted without
 * its report. Data-modifying CTEs run to completion and the ON DELETE SET NULL
 * action fires at the end of the statement, by which time the reports are
 * already gone, so there is nothing left for it to orphan.
 *
 * Lives here, not inline in app/api/v3/admin/route.ts, so
 * tests/integration/purge-user-scans.test.ts can run it against real rows
 * without a staff session: whether anything is left behind is decided by
 * Postgres.
 */
export interface ScanPurgeResult {
  /** scan_history rows deleted. */
  scans: number;
  /** host_reputation rows deleted because one of those scans sourced them. */
  hostReports: number;
}

/**
 * Delete every scan matching `condition` and the reports they sourced.
 *
 * `condition` is SQL text spliced into a `WHERE`, written against
 * scan_history's own columns, and may use `$1..$n` placeholders bound to
 * `params`. It is for callers inside this module's neighbourhood that build
 * it from constants (a user id, the blocked-domain regex); it must never
 * contain request input.
 */
export async function purgeScansWhere(
  condition: string,
  params: unknown[],
): Promise<ScanPurgeResult> {
  const result = await pool.query<{ scans: number; host_reports: number }>(
    `WITH doomed AS (
       SELECT id FROM scan_history WHERE (${condition})
     ),
     deleted_reports AS (
       DELETE FROM host_reputation
        WHERE source_scan_id IN (SELECT id FROM doomed)
       RETURNING 1
     ),
     deleted_scans AS (
       DELETE FROM scan_history
        WHERE id IN (SELECT id FROM doomed)
       RETURNING 1
     )
     SELECT (SELECT COUNT(*) FROM deleted_scans)::int AS scans,
            (SELECT COUNT(*) FROM deleted_reports)::int AS host_reports`,
    params,
  );
  const row = result.rows[0];
  return {
    scans: Number(row?.scans ?? 0),
    hostReports: Number(row?.host_reports ?? 0),
  };
}

/** Every scan one user owns, repo scans included, and their host reports. */
export function purgeUserScans(userId: number): Promise<ScanPurgeResult> {
  return purgeScansWhere("user_id = $1", [userId]);
}
