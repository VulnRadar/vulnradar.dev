import pool from "@/lib/database/db";
import { PLANS } from "@/lib/billing/catalog";
import { STAFF_ROLE_HIERARCHY } from "@/lib/config/client-constants";
import { staffRolesByRank } from "@/lib/admin/staff-roles";
import { escapeLikePattern } from "@/lib/history/list-filter";

/**
 * The admin user list's filters, sort and page query.
 *
 * The list took one optional WHERE, an email or name substring, so the
 * questions an operator actually asks could not be answered from the panel:
 * which accounts are disabled, who has not verified their email, who has no
 * second factor, who holds a staff role, who is on which plan. Other panels
 * identify users by id (the queue's "user #123"), and that id could not be
 * searched here either.
 *
 * Built from a whitelist, like the audit filters beside it: a status is one of
 * three names that map to fixed SQL, a plan one of the catalog's ids, a role
 * one of the hierarchy's keys or "staff", and the only free text, the search,
 * reaches SQL as a bound LIKE-escaped parameter. The sort column is picked
 * from a map and interpolated; nothing from the query string ever is.
 */

/** Status names the list filters on. Each maps to a fixed predicate. */
export const USER_STATUS_FILTERS = ["disabled", "unverified", "no2fa"] as const;
export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number];

const STATUS_PREDICATES: Record<UserStatusFilter, string> = {
  disabled: "u.disabled_at IS NOT NULL",
  unverified: "u.email_verified_at IS NULL",
  // totp_enabled is true for email 2FA as well as an authenticator app (the
  // setup route writes it for both), so this is "no second factor at all".
  no2fa: "u.totp_enabled IS NOT TRUE",
};

export type UserFilterResult =
  { ok: true; where: string; params: unknown[] } | { ok: false; error: string };

/** The only searches that are also an id. Digits, and small enough for int4. */
const NUMERIC_SEARCH = /^\d{1,10}$/;
const MAX_INT4 = 2147483647;
const MAX_SEARCH_CHARS = 200;

export function parseUserFilters(
  searchParams: URLSearchParams,
): UserFilterResult {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const status = searchParams.get("status");
  if (status && status !== "all") {
    if (!(USER_STATUS_FILTERS as readonly string[]).includes(status)) {
      return { ok: false, error: "Unknown status filter." };
    }
    clauses.push(STATUS_PREDICATES[status as UserStatusFilter]);
  }

  const plan = searchParams.get("plan");
  if (plan && plan !== "all") {
    if (!PLANS.some((p) => p.id === plan)) {
      return { ok: false, error: "Unknown plan." };
    }
    clauses.push(`u.plan = ${bind(plan)}`);
  }

  const role = searchParams.get("role");
  if (role && role !== "all") {
    if (role === "staff") {
      clauses.push(`u.role = ANY(${bind(staffRolesByRank())}::text[])`);
    } else if (
      Object.prototype.hasOwnProperty.call(STAFF_ROLE_HIERARCHY, role)
    ) {
      clauses.push(`u.role = ${bind(role)}`);
    } else {
      return { ok: false, error: "Unknown role." };
    }
  }

  const search = (searchParams.get("search") ?? "")
    .trim()
    .slice(0, MAX_SEARCH_CHARS);
  if (search) {
    const like = bind(`%${escapeLikePattern(search)}%`);
    const textMatch = `u.email ILIKE ${like} ESCAPE '\\' OR u.name ILIKE ${like} ESCAPE '\\'`;
    // A number is also an id. It still matches the text columns, so searching
    // "2024" finds an email containing it as well as user 2024.
    if (NUMERIC_SEARCH.test(search) && Number(search) <= MAX_INT4) {
      clauses.push(`(u.id = ${bind(Number(search))} OR ${textMatch})`);
    } else {
      clauses.push(`(${textMatch})`);
    }
  }

  return {
    ok: true,
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

/**
 * Server-side sort for the list. The panel used to sort only the ten rows it
 * had already fetched while presenting it as a real sort, so clicking "Joined"
 * on page 1 of 40 gave the oldest of ten, not the oldest account. Whitelisted
 * column names only: the value is interpolated into the ORDER BY, so it can
 * never come from the query string directly.
 */
export const USER_SORT_COLUMNS: Record<string, string> = {
  name: "COALESCE(NULLIF(u.name, ''), u.email)",
  joined: "u.created_at",
};

export function userOrderBy(sort: string | null, dir: string | null): string {
  const expr = sort ? USER_SORT_COLUMNS[sort] : undefined;
  // Tie-break on id so paging is stable when two rows share a sort value.
  return expr
    ? `${expr} ${dir === "asc" ? "ASC" : "DESC"}, u.id DESC`
    : "u.created_at DESC";
}

export interface UsersPage {
  users: Record<string, unknown>[];
  /** Accounts the filters leave, across every page. */
  total: number;
}

/**
 * One page of users and the count the same filter leaves. Here rather than in
 * the route so tests/integration/users-list-filters.test.ts can run it
 * against real rows: whether a filter selects the right accounts is
 * Postgres's answer.
 */
export async function fetchUsersPage(
  filter: Extract<UserFilterResult, { ok: true }>,
  page: { limit: number; offset: number; orderBy: string },
): Promise<UsersPage> {
  const limitParam = `$${filter.params.length + 1}`;
  const offsetParam = `$${filter.params.length + 2}`;
  const [rowsRes, totalRes] = await Promise.all([
    pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.avatar_url, u.totp_enabled, u.tos_accepted_at, u.created_at, u.disabled_at, u.plan, u.subscription_status,
        (SELECT COUNT(*) FROM scan_history sh WHERE sh.user_id = u.id) as scan_count,
        (SELECT COUNT(*) FROM api_keys ak WHERE ak.user_id = u.id AND ak.revoked_at IS NULL) as api_key_count,
        gs.plan as gifted_plan,
        gs.expires_at as gift_end_date
      FROM users u
      LEFT JOIN gifted_subscriptions gs ON gs.user_id = u.id AND gs.revoked_at IS NULL AND gs.expires_at > NOW()
      ${filter.where}
      ORDER BY ${page.orderBy}
      LIMIT ${limitParam} OFFSET ${offsetParam}`,
      [...filter.params, page.limit, page.offset],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM users u ${filter.where}`,
      filter.params,
    ),
  ]);
  return {
    users: rowsRes.rows,
    total: Number(totalRes.rows[0]?.count ?? 0),
  };
}
