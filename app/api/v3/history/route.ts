import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { versioned } from "@/lib/api/v4/wrap";
import { SUCCESS_MESSAGES } from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import type { SettingKey } from "@/lib/config/registry";
import {
  buildHistoryCountsQuery,
  buildHistoryFilter,
} from "@/lib/history/list-filter";
import {
  incompleteFlagSql,
  withPublicErrorMessage,
} from "@/lib/history/list-row";
import { parsePaging } from "@/lib/history/paging";
import { authenticateHistoryCaller, completeCall } from "@/lib/history/caller";
import { API_KEY_SCOPES } from "@/lib/api/api-key-scopes";

// billing: mirrors lib/database/cleanup.ts's retention resolution, but
// applied to what this route READS/SHOWS rather than what it deletes --
// see the module comment on lib/billing/plan-limits.ts for why the
// registry (not lib/billing/catalog.ts) is the source of truth here.
const RETENTION_SETTING_KEYS: Record<string, SettingKey> = {
  free: "BILLING_FREE_RETENTION",
  core_supporter: "BILLING_CORE_SUPPORTER_RETENTION",
  pro_supporter: "BILLING_PRO_SUPPORTER_RETENTION",
  elite_supporter: "BILLING_ELITE_SUPPORTER_RETENTION",
};

/**
 * Read the optional `q` (URL substring) and `tag` filters off the query string.
 *
 * `search` is accepted as an alias for `q` because the web UI's control is
 * called Search and an API client guessing at the name will reach for one of
 * the two.
 *
 * Absence is the previous behaviour exactly (no filtering), and an empty or
 * whitespace-only value counts as absent rather than as "match nothing": a
 * cleared search box must return the list, not an empty one.
 */
function parseFilters(searchParams: URLSearchParams): {
  q: string | null;
  tag: string | null;
} {
  const rawQ = (
    searchParams.get("q") ??
    searchParams.get("search") ??
    ""
  ).trim();
  const rawTag = (searchParams.get("tag") ?? "").trim();
  return { q: rawQ || null, tag: rawTag || null };
}

export const GET = versioned(
  "history.list",
  withErrorHandling(async (request: NextRequest) => {
    const authenticated = await authenticateHistoryCaller(
      request,
      API_KEY_SCOPES.SCAN_READ,
    );
    if (!authenticated.ok) return authenticated.response;
    const { caller } = authenticated;
    const authedUserId = caller.userId;

    // Get user's plan and role to determine history retention from the
    // live admin-configured settings (database ?? env ?? shipped default),
    // not the compiled BILLING_HISTORY_RETENTION table -- otherwise an
    // admin-edited retention window would keep showing the old value here
    // even though lib/database/cleanup.ts is already deleting on the new one.
    const userRes = await pool.query(
      "SELECT plan, role FROM users WHERE id = $1",
      [authedUserId],
    );
    const userPlan = userRes.rows[0]?.plan || "free";
    const userRole = userRes.rows[0]?.role || "user";

    // Staff/admin always get unlimited retention regardless of plan
    const isStaff = ["admin", "moderator", "support"].includes(userRole);
    const retentionSettingKey =
      RETENTION_SETTING_KEYS[userPlan] ?? RETENTION_SETTING_KEYS.free;
    const retentionSettings = await getSettings([
      retentionSettingKey,
      "HISTORY_LIST_MAX_ROWS",
    ] as const);
    const retentionDays = isStaff
      ? -1
      : Number(retentionSettings[retentionSettingKey]);
    const historyMaxRows = Number(retentionSettings.HISTORY_LIST_MAX_ROWS);
    const { limit: pageLimit, offset: pageOffset } = parsePaging(
      request.nextUrl.searchParams,
      historyMaxRows,
    );

    // Search and tag filtering run in SQL, over the whole retention window, and
    // the clause is built by lib/history/list-filter.ts so tests/integration can
    // run this exact WHERE against a real PostgreSQL. Both filters are appended
    // to the user-scoped clause the unfiltered list already used, never
    // substituted for it, so a filter can only narrow the caller's own rows.
    const { q, tag } = parseFilters(request.nextUrl.searchParams);
    const filter = buildHistoryFilter({
      userId: authedUserId,
      retentionDays,
      q,
      tag,
    });
    const { where: listWhere, params: listParams, filtering } = filter;

    // sh.status is projected so the list can distinguish a finished scan from
    // one that is still pending/running or that failed. The row is inserted as
    // 'pending' before any work starts, with summary '{}', findings_count 0 and
    // duration 0, so a scan the user navigated away from used to appear in
    // History wearing a clean result's clothes: "0 findings in 0.0s".
    //
    // `incomplete` is the same idea one level down: a COMPLETED scan with zero
    // findings and an area that never ran (result_meta.incomplete) is not a clean
    // result either. It is a boolean, not result_meta itself, because the list
    // must not ship (or the client parse) a blob that can hold a whole crawl.
    //
    // The tiebreaker is the id: scanned_at is set when the row is inserted, and
    // a bulk submission inserts many rows inside one transaction, which share a
    // timestamp. Without it two rows with the same instant could swap places
    // between page 1 and page 2, so a client paging through would see one scan
    // twice and miss another.
    const list = pool.query(
      `SELECT sh.public_id AS id, sh.url, sh.summary, sh.findings_count, sh.duration, sh.scanned_at, sh.source, sh.status, sh.error_message,
         ${incompleteFlagSql("sh.result_meta")} AS incomplete,
         COALESCE(
           (SELECT json_agg(json_build_object('tag', st.tag, 'source', st.source) ORDER BY st.source, st.tag)
            FROM scan_tags st WHERE st.scan_id = sh.id AND st.user_id = $1),
           '[]'::json
         ) as tags
       FROM scan_history sh
       WHERE ${listWhere}
       ORDER BY sh.scanned_at DESC, sh.id DESC
       LIMIT $${listParams.length + 1} OFFSET $${listParams.length + 2}`,
      [...listParams, pageLimit, pageOffset],
    );

    // The list above is capped at HISTORY_LIST_MAX_ROWS, so scans.length is a
    // page size, not an account total. Returning the real count alongside it
    // stops the client presenting the cap as the total, which is what made the
    // "delete all history" confirmation understate what the DELETE below
    // actually removes (the DELETE is deliberately unbounded).
    //
    // `total` is the account total and ignores q/tag; `matched` is the filtered
    // count pagination is about. Reported separately on purpose: a filtered
    // number in `total` would understate what the unbounded DELETE removes.
    // Both come from one statement, started with the list rather than after it
    // (neither reads the other).
    //
    // Degrades to the page size rather than failing the request: an operator
    // losing the exact total is a far better outcome than the whole history
    // page 500ing, and the count is advisory.
    const countsQuery = buildHistoryCountsQuery(filter);
    const counts = pool
      .query<{ total: number; matched: number }>(
        countsQuery.sql,
        countsQuery.params,
      )
      .catch((err: unknown) => {
        console.error("[history] count failed, falling back to page size", err);
        return null;
      });

    const [result, countsRes] = await Promise.all([list, counts]);

    const total = countsRes?.rows?.[0]?.total ?? result.rows.length;
    const matched =
      countsRes?.rows?.[0]?.matched ??
      (filtering ? pageOffset + result.rows.length : total);

    return completeCall(
      caller,
      ApiResponse.success({
        // error_message goes through the same read-boundary sanitizer the status
        // route uses: this list is reachable with an API key, and the raw column
        // can name an internal table or a private address and port.
        scans: result.rows.map(withPublicErrorMessage),
        total,
        matched,
        // Echoed back so a client can tell what the server actually filtered on
        // rather than assuming its request arrived intact.
        q,
        tag,
        // The page size actually applied, not the ceiling: a caller that asked for
        // ?limit=10 was previously told `limit: 100` because this reported the cap
        // rather than the number of rows it was willing to return.
        limit: pageLimit,
        offset: pageOffset,
        maxLimit: historyMaxRows,
        // "There are rows after this page", measured against the filtered set so
        // paging works through a search rather than through the whole account.
        // With no filter, matched === total and this is the same boolean it has
        // always been.
        truncated: pageOffset + result.rows.length < matched,
      }),
    );
  }),
);

export const DELETE = versioned(
  "history.clear",
  withErrorHandling(async (request: NextRequest) => {
    // scoping: clearing all scan history is destructive -- requires
    // scan:delete, deliberately excluded from a newly created key's default
    // scopes.
    const authenticated = await authenticateHistoryCaller(
      request,
      API_KEY_SCOPES.SCAN_DELETE,
    );
    if (!authenticated.ok) return authenticated.response;
    const { caller } = authenticated;
    const authedUserId = caller.userId;

    // Scoped to the same "not a GitHub repo scan" set the GET above lists,
    // so "Clear history" only clears URL-scan history -- repo scan history
    // (its own thing at /repos) survives a URL-history wipe.
    await pool.query(
      `DELETE FROM scan_tags WHERE user_id = $1 AND scan_id IN (
       SELECT id FROM scan_history
       WHERE user_id = $1 AND (scan_type IS NULL OR scan_type != 'github')
     )`,
      [authedUserId],
    );
    // Before the scans go, not after. host_reputation.source_scan_id is
    // ON DELETE SET NULL, so deleting the scans first orphans the findings copy
    // rather than removing it: the row survives with a null source, every purge
    // path keys on source_scan_id, and nothing can ever reach it again. The
    // findings then keep serving on the unauthenticated /host/<hostname> page
    // forever.
    //
    // Every single-scan delete already does this (history/[id]/delete,
    // history/[id] DELETE, and account deletion, which explains the ordering in
    // the same words). Clearing all of them was the one path that did not, so
    // deleting scans one at a time and deleting them together gave opposite
    // results for the same intent, and the one that looked like the thorough
    // option was the one that left data public.
    await pool.query(
      `DELETE FROM host_reputation
      WHERE source_scan_id IN (
        SELECT id FROM scan_history
        WHERE user_id = $1 AND (scan_type IS NULL OR scan_type != 'github')
      )`,
      [authedUserId],
    );
    await pool.query(
      `DELETE FROM scan_history
     WHERE user_id = $1 AND (scan_type IS NULL OR scan_type != 'github')`,
      [authedUserId],
    );

    return completeCall(
      caller,
      ApiResponse.success({ message: SUCCESS_MESSAGES.DELETED }),
    );
  }),
);
