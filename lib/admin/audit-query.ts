import pool from "@/lib/database/db";
import {
  AUDIT_CATEGORIES,
  KNOWN_AUDIT_ACTIONS,
  auditActionsIn,
  type AuditCategoryId,
} from "@/lib/admin/audit-actions";
import { escapeLikePattern } from "@/lib/history/list-filter";

/**
 * The audit log's server-side filters.
 *
 * Every filter in the panel used to be a useMemo over the ten rows on the
 * current page, so "what has staff done to this account" and "who cleared the
 * email logs" could not be answered from the panel at all, and the stat tiles
 * counted those same ten rows while being labelled as totals. Filtering in
 * SQL is the only version where the answer is about the whole log.
 *
 * Built from a whitelist: an action must be one the registry knows, a category
 * one of AUDIT_CATEGORIES, ids must be positive integers, and free text only
 * ever reaches SQL as a bound, LIKE-escaped parameter. Nothing from the query
 * string is interpolated.
 */

export type AuditFilterResult =
  | { ok: true; where: string; params: unknown[]; joinsUsers: boolean }
  | { ok: false; error: string };

function positiveInt(raw: string | null): number | null | "invalid" {
  if (raw === null || raw === "") return null;
  // Digits only: Number() also accepts "1e3" and " 7 ", and an id that was
  // typed that way is a mistake worth a 400 rather than a quiet reinterpretation.
  if (!/^\d{1,10}$/.test(raw)) return "invalid";
  const n = Number(raw);
  return n > 0 && n <= 2147483647 ? n : "invalid";
}

function isoDate(raw: string | null): string | null | "invalid" {
  if (raw === null || raw === "") return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "invalid";
}

/** Longest search the box accepts; a pasted log line is not a search term. */
const MAX_SEARCH_CHARS = 200;

/**
 * `al` is admin_audit_log, `au` the acting admin and `tu` the target user: the
 * aliases the audit route's SELECT already uses. `joinsUsers` says whether the
 * WHERE reads au/tu, so a COUNT that has no search can skip both joins.
 */
export function parseAuditFilters(
  searchParams: URLSearchParams,
): AuditFilterResult {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  let joinsUsers = false;

  const action = searchParams.get("action");
  const category = searchParams.get("category");
  if (action) {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_AUDIT_ACTIONS, action)) {
      return { ok: false, error: "Unknown audit action." };
    }
    clauses.push(`al.action = ${bind(action)}`);
  } else if (category && category !== "all") {
    const known = AUDIT_CATEGORIES.some((c) => c.id === category);
    if (!known) return { ok: false, error: "Unknown audit category." };
    clauses.push(
      `al.action = ANY(${bind(auditActionsIn(category as AuditCategoryId))}::text[])`,
    );
  }

  const adminId = positiveInt(searchParams.get("adminId"));
  if (adminId === "invalid") return { ok: false, error: "Invalid adminId." };
  if (adminId !== null) clauses.push(`al.admin_id = ${bind(adminId)}`);

  const targetUserId = positiveInt(searchParams.get("targetUserId"));
  if (targetUserId === "invalid") {
    return { ok: false, error: "Invalid targetUserId." };
  }
  if (targetUserId !== null) {
    clauses.push(`al.target_user_id = ${bind(targetUserId)}`);
  }

  const from = isoDate(searchParams.get("from"));
  if (from === "invalid") return { ok: false, error: "Invalid from date." };
  if (from !== null)
    clauses.push(`al.created_at >= ${bind(from)}::timestamptz`);

  const to = isoDate(searchParams.get("to"));
  if (to === "invalid") return { ok: false, error: "Invalid to date." };
  if (to !== null) clauses.push(`al.created_at <= ${bind(to)}::timestamptz`);

  const q = (searchParams.get("q") ?? "").trim().slice(0, MAX_SEARCH_CHARS);
  if (q) {
    joinsUsers = true;
    const like = bind(`%${escapeLikePattern(q)}%`);
    clauses.push(
      `(al.details ILIKE ${like} ESCAPE '\\'
        OR al.action ILIKE ${like} ESCAPE '\\'
        OR al.ip_address ILIKE ${like} ESCAPE '\\'
        OR au.email ILIKE ${like} ESCAPE '\\'
        OR au.name ILIKE ${like} ESCAPE '\\'
        OR tu.email ILIKE ${like} ESCAPE '\\'
        OR tu.name ILIKE ${like} ESCAPE '\\')`,
    );
  }

  return {
    ok: true,
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
    joinsUsers,
  };
}

/**
 * Totals for the stat tiles, in one pass over the last week.
 *
 * Global, not filtered, and now actually computed over the log: the tiles
 * counted the rows of the current page and were labelled "Today", "This Week"
 * and "Active Admins". COUNT ... FILTER keeps it to a single scan of a window
 * the created_at index already bounds.
 */
export const AUDIT_STATS_SQL = `SELECT
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS last_24h,
    COUNT(*)::int AS last_7d,
    COUNT(DISTINCT admin_id)::int AS active_admins_7d,
    COUNT(*) FILTER (WHERE target_user_id IS NOT NULL)::int AS user_actions_7d
  FROM admin_audit_log
  WHERE created_at >= NOW() - INTERVAL '7 days'`;

export interface AuditStats {
  last24h: number;
  last7d: number;
  activeAdmins7d: number;
  userActions7d: number;
}

export function shapeAuditStats(
  row: Record<string, unknown> | undefined,
): AuditStats {
  return {
    last24h: Number(row?.last_24h ?? 0),
    last7d: Number(row?.last_7d ?? 0),
    activeAdmins7d: Number(row?.active_admins_7d ?? 0),
    userActions7d: Number(row?.user_actions_7d ?? 0),
  };
}

export interface AuditPage {
  rows: Record<string, unknown>[];
  /** Rows the filters leave, across every page. */
  total: number;
  stats: AuditStats;
}

/**
 * One page of the log, the count the filters leave, and the global stat tiles,
 * as three concurrent queries. Here rather than in the route so the SQL can be
 * run against real rows (tests/integration/audit-log-filters.test.ts): whether
 * a filter selects the right rows is Postgres's answer, not a mock's.
 */
export async function fetchAuditPage(
  filter: Extract<AuditFilterResult, { ok: true }>,
  limit: number,
  offset: number,
): Promise<AuditPage> {
  const limitParam = `$${filter.params.length + 1}`;
  const offsetParam = `$${filter.params.length + 2}`;
  // The COUNT only joins users when the search reads their columns.
  const countJoins = filter.joinsUsers
    ? `LEFT JOIN users au ON al.admin_id = au.id
       LEFT JOIN users tu ON al.target_user_id = tu.id`
    : "";
  // perf: the COUNT scans whatever the filter leaves no matter what the
  // sibling LIMIT is, so it used to double the wall time of a page load by
  // running strictly after the paged select. Concurrent, as in
  // app/api/v3/ai/conversations/route.ts.
  const [pageRes, totalRes, statsRes] = await Promise.all([
    pool.query(
      `SELECT al.id, al.action, al.details, al.created_at, al.ip_address,
        al.admin_id, al.target_user_id,
        au.email as admin_email, au.name as admin_name, au.avatar_url as admin_avatar_url,
        tu.email as target_email, tu.name as target_name, tu.avatar_url as target_avatar_url
      FROM admin_audit_log al
      LEFT JOIN users au ON al.admin_id = au.id
      LEFT JOIN users tu ON al.target_user_id = tu.id
      ${filter.where}
      ORDER BY al.created_at DESC, al.id DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}`,
      [...filter.params, limit, offset],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM admin_audit_log al ${countJoins} ${filter.where}`,
      filter.params,
    ),
    pool.query(AUDIT_STATS_SQL),
  ]);
  return {
    rows: pageRes.rows,
    total: Number(totalRes.rows[0]?.count ?? 0),
    stats: shapeAuditStats(statsRes.rows[0]),
  };
}
