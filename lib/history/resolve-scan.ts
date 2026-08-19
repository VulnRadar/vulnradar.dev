import pool from "@/lib/database/db";

// scan_history.id is a SERIAL (int4). A numeric param larger than this can't
// be a real primary key, and passing it to Postgres as an int would error on
// overflow, so the legacy numeric fallback is skipped for it.
const MAX_SCAN_ID = 2147483647;

/**
 * The scan_history columns any resolve-by-id caller reads off the row. Typed
 * loosely where the column is JSONB (each route narrows what it needs) so a
 * single shared shape works for every history subroute.
 */
export interface ScanHistoryRow {
  id: number;
  user_id: number;
  team_id: number | null;
  url: string;
  summary: unknown;
  findings: unknown;
  findings_count: number;
  duration: number;
  scanned_at: string | Date;
  response_headers: unknown;
  notes: string | null;
  result_meta: Record<string, unknown> | null;
  authenticated: boolean | null;
  is_public: boolean | null;
  share_token: string | null;
  share_expires_at: string | Date | null;
  share_publicly_listed: boolean | null;
}

/**
 * Classify a history route's :id param. Returns the numeric primary key it
 * refers to when it is an all-digits, in-range legacy id, or null when it is
 * an opaque public_id (or a number too large to be a real id). Shared by
 * every route that has to accept both id shapes so the "is this the legacy
 * numeric form" rule lives in exactly one place.
 */
export function scanNumericId(idParam: string): number | null {
  if (!/^\d+$/.test(idParam)) return null;
  const n = Number(idParam);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_SCAN_ID ? n : null;
}

/**
 * Resolve a history route's :id param to its scan_history row. The param is
 * matched against the opaque public_id first; an all-digits, in-range param
 * also matches the legacy numeric primary key, so old /history/456 bookmarks
 * and ?scan=456 links keep opening. Returns null when nothing matches.
 *
 * Callers keep their own ownership / team-access checks on the returned row
 * (row.user_id, row.team_id) exactly as before -- this only replaces the
 * "look the row up by id" step, never the authorization that follows it.
 */
export async function resolveScanRow(
  idParam: string,
): Promise<ScanHistoryRow | null> {
  const numericId = scanNumericId(idParam);
  const result = await pool.query<ScanHistoryRow>(
    `SELECT * FROM scan_history
     WHERE public_id = $1 OR ($2::bigint IS NOT NULL AND id = $2)
     LIMIT 1`,
    [idParam, numericId],
  );
  return result.rows[0] ?? null;
}
