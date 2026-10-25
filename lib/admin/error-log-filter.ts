/**
 * The WHERE clause behind Admin > System > Error Logs.
 *
 * Three filters that combine with AND: free-text search over the message and
 * detail, and exact matches on request_id and scan_id. It is a function of its
 * own, not inline in the route, so tests/integration can run the SQL it builds
 * against a real PostgreSQL: parameter numbering, the LIKE escape and the
 * AND/OR grouping are exactly the things a faked pool answers however the test
 * told it to.
 */
import { normalizeRequestId } from "@/lib/database/request-context";

export interface ErrorLogFilter {
  search?: string;
  requestId?: string | null;
  scanId?: number | null;
}

/**
 * `clause` is empty or starts with WHERE; `params` are its values, in order,
 * so a caller can append its own LIMIT/OFFSET parameters after them.
 */
export function buildErrorLogWhere(filter: ErrorLogFilter): {
  clause: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const search = (filter.search ?? "").trim();
  if (search) {
    // Escape LIKE metacharacters so the search is exact-substring, not a
    // pattern. Without this a literal "_" matches any character and a bare
    // "%" degrades to a full scan of system_error_logs, one of the
    // highest-volume tables in the schema. Same one-liner the user and team
    // searches use (app/api/v3/admin/route.ts, admin/teams/route.ts).
    params.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
    const n = params.length;
    conditions.push(
      `(message ILIKE $${n} ESCAPE '\\' OR detail ILIKE $${n} ESCAPE '\\')`,
    );
  }
  // Equality, not LIKE: both columns have a partial index for exactly this.
  if (filter.requestId) {
    params.push(filter.requestId);
    conditions.push(`request_id = $${params.length}`);
  }
  if (filter.scanId !== null && filter.scanId !== undefined) {
    params.push(filter.scanId);
    conditions.push(`scan_id = $${params.length}`);
  }

  return {
    clause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

/**
 * Reads ?search=, ?requestId= and ?scanId=. A malformed id is refused rather
 * than searched for: it cannot match a row, and an empty list would read as
 * "this request logged nothing".
 */
export function parseErrorLogFilter(
  params: URLSearchParams,
): { ok: true; filter: ErrorLogFilter } | { ok: false; error: string } {
  const search = (params.get("search") || "").trim();

  const rawRequestId = (params.get("requestId") || "").trim();
  const requestId = rawRequestId ? normalizeRequestId(rawRequestId) : null;
  if (rawRequestId && !requestId) {
    return { ok: false, error: "That is not a request id." };
  }

  const rawScanId = (params.get("scanId") || "").trim();
  const scanId = /^\d{1,9}$/.test(rawScanId) ? Number(rawScanId) : null;
  if (rawScanId && (scanId === null || scanId <= 0)) {
    return { ok: false, error: "That is not a scan id." };
  }

  return { ok: true, filter: { search, requestId, scanId } };
}
