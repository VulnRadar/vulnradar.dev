import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import type { SettingKey } from "@/lib/config/registry";
import { PUBLIC_HOST_SQL } from "@/lib/database/sql-fragments";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  RATING_FINDINGS_SQL,
  type RatingFinding,
} from "@/lib/scanner/rating-findings-sql";
import {
  getSafetyRating,
  type SafetyRating,
} from "@/lib/scanner/safety-rating";

/**
 * GET /api/v3/assets
 *
 * Backs app/assets/page.tsx: every distinct host the caller has scanned,
 * grouped from their own scan_history rows, most-recently-scanned host
 * first. scan_history has no separate `host` column (only the full scanned
 * `url`), so the grouping key is HOST_KEY_SQL below.
 *
 * Retention mirrors GET /api/v3/history (same setting keys, same dated-window
 * vs. unlimited branching): a host whose only qualifying scan already fell
 * outside the caller's plan retention window must not appear here just because
 * /api/v3/history also hides it. HISTORY_LIST_MAX_ROWS caps the hosts returned.
 *
 * Each row's safety rating comes from getSafetyRating() run against that
 * host's latest COMPLETED scan's findings -- the same function and the same
 * "safe / caution / unsafe" verdict GET /api/v3/public-scans computes per row
 * -- not a re-derivation from the aggregated severity counts alone.
 */

// Mirrors app/api/v3/history/route.ts's RETENTION_SETTING_KEYS. Duplicated
// (not imported) because that route doesn't export it -- see the module
// comment on lib/billing/plan-limits.ts for why the registry, not
// lib/billing/catalog.ts, is the source of truth for these keys.
const RETENTION_SETTING_KEYS: Record<string, SettingKey> = {
  free: "BILLING_FREE_RETENTION",
  core_supporter: "BILLING_CORE_SUPPORTER_RETENTION",
  pro_supporter: "BILLING_PRO_SUPPORTER_RETENTION",
  elite_supporter: "BILLING_ELITE_SUPPORTER_RETENTION",
};

export interface AssetRow {
  host: string;
  scanCount: number;
  latestScanId: number;
  latestUrl: string;
  latestScannedAt: string;
  findingsCount: number;
  summary: Record<string, number>;
  safetyRating: SafetyRating;
  // Whether the latest scan is public -- GET /api/v3/host/[hostname] (this
  // row's link target) only ever reflects a host's most recent PUBLIC scan
  // (it reads host_reputation, which every private scan is deliberately
  // excluded from -- see that route's own doc comment). A caller's own row
  // here always shows regardless of privacy, since this endpoint reads
  // their scan_history directly, so the frontend needs this flag to avoid
  // linking a private scan to a page that will insist the host "hasn't
  // been scanned yet."
  isPublic: boolean;
}

interface HostRow {
  id: number;
  host: string;
  url: string;
  summary: Record<string, number> | null;
  findings_count: number;
  scanned_at: string | Date;
  is_public: boolean;
  scan_count: number;
  total_hosts: number;
  total_scans: number;
  findings: RatingFinding[] | null;
}

/**
 * The host a scan belongs to: PUBLIC_HOST_SQL, the identity /host/[hostname]
 * (this route's link target) resolves, with www stripped and case folded. A bare
 * IP has a host there too, so an IP-scanned target keeps its own row. That
 * expression stops at the first colon, so a bracketed IPv6 literal is read
 * first and whole. A URL neither can read (a pre-normalization row) is keyed on
 * the URL itself, so it is listed rather than silently dropped.
 */
const IPV6_LITERAL_SQL = `LOWER(substring(url from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^/?#@]*@)?([[][^]/?#@]*[]])'))`;
const HOST_KEY_SQL = `COALESCE(${IPV6_LITERAL_SQL}, ${PUBLIC_HOST_SQL}, LOWER(url))`;

/** Cap on the public "all hosts" browse. host_reputation is small today, but
 *  bound it so the list stays a browse, not an unbounded dump. */
const ALL_HOSTS_MAX = 500;

export const GET = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }
  const userId = session.userId;

  const userRes = await pool.query(
    "SELECT plan, role, disabled_at FROM users WHERE id = $1",
    [userId],
  );
  if (userRes.rows[0]?.disabled_at) {
    return ApiResponse.forbidden("Account suspended.");
  }
  const userPlan = userRes.rows[0]?.plan || "free";
  const userRole = userRes.rows[0]?.role || "user";

  // scope=all: every host on file, not just the caller's own scans. This reads
  // ONLY host_reputation, which is public-scan-only by construction (every
  // upsertHostReputation call skips non-public scans, and the row is deleted
  // when its source scan is flipped to private -- see that table's callers and
  // GET /api/v3/host/[hostname]). So it exposes nothing that isn't already
  // public at /host/[hostname]; a caller's own private scans never appear here.
  // That claim only holds because scanned_url is NOT selected below: it is the
  // one column here that /host/[hostname] never returns.
  //
  // This branch needs no status filter, unlike the per-user one below:
  // host_reputation is written only by finalizeScanSuccess, so every row is a
  // completed scan's snapshot and a later pending or failed attempt never
  // replaces it.
  if (request.nextUrl.searchParams.get("scope") === "all") {
    // Every row here costs a walk of that host's findings, up to ALL_HOSTS_MAX
    // of them per call, for any signed-in account. The per-user branch below is
    // bounded by what that account has scanned; this one is not.
    const rl = await checkRateLimit({
      key: `assets-all:${userId}`,
      ...RATE_LIMITS.api,
    });
    if (!rl.allowed) {
      return ApiResponse.tooManyRequests(undefined, rl.retryAfterSeconds);
    }

    const res = await pool.query<{
      host: string;
      severity_counts: Record<string, number> | null;
      findings: RatingFinding[] | null;
      last_scanned_at: string | Date;
      source_scan_id: number | null;
    }>(
      // Deliberately NOT selecting scanned_url (AUDIT-009#reputation-01, and
      // the same null-out already applied at app/api/v3/scan/reputation).
      // host_reputation.scanned_url is the scanned URL verbatim, query string
      // included, and this branch has no owner predicate at all: returning it
      // would hand every signed-in caller the full URL of the latest public
      // scan of every host on file, tokens and all (a magic-login link, a
      // password-reset URL, a presigned S3 URL). The host itself is already
      // public at /host/[hostname]; the exact URL is not.
      //
      // One past the cap, so `truncated` can tell "exactly the cap" from "more
      // than the cap".
      `SELECT host, severity_counts, ${RATING_FINDINGS_SQL} AS findings, last_scanned_at, source_scan_id
       FROM host_reputation
       ORDER BY last_scanned_at DESC
       LIMIT $1`,
      [ALL_HOSTS_MAX + 1],
    );
    const assets: AssetRow[] = res.rows.slice(0, ALL_HOSTS_MAX).map((r) => {
      const counts = r.severity_counts || {};
      const findingsCount =
        (counts.critical ?? 0) +
        (counts.high ?? 0) +
        (counts.medium ?? 0) +
        (counts.low ?? 0) +
        (counts.info ?? 0);
      return {
        host: r.host,
        // host_reputation holds one snapshot per host, not a per-host scan
        // count, so this is the single latest public scan.
        scanCount: 1,
        latestScanId: r.source_scan_id ?? 0,
        latestUrl: `https://${r.host}`,
        latestScannedAt: new Date(r.last_scanned_at).toISOString(),
        findingsCount,
        summary: counts,
        safetyRating: getSafetyRating(r.findings || []),
        // Every host_reputation row is a public scan by construction.
        isPublic: true,
      };
    });
    // totalHosts/totalScans are counted over the rows this request returned,
    // which the LIMIT above caps. Reported alongside `limit` and `truncated`
    // so a client can tell a real total from a floor: without them a capped
    // page reads as "that is everything", which is the opposite of what a
    // truncation means. Same reasoning as GET /api/v3/history.
    // ref: AUDIT-015#api-04
    return ApiResponse.success({
      assets,
      totalHosts: assets.length,
      totalScans: assets.length,
      limit: ALL_HOSTS_MAX,
      truncated: res.rows.length > ALL_HOSTS_MAX,
      scope: "all",
    });
  }

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

  // GitHub repo scans are excluded here for the same reason GET
  // /api/v3/history excludes them: they get their own dedicated history at
  // /repos, scoped per-repo instead of mixed into this host list.
  //
  // Only COMPLETED scans, in both the unlimited and the dated branch. A row is
  // 'pending' with summary '{}' and no findings from the moment it is queued,
  // and a failed or cancelled one keeps those defaults, so letting one in made
  // it the host's "latest" and the page reported 0 findings and a "safe"
  // rating for a site whose last real result had criticals. The price is that
  // a host with no completed scan at all has no posture to show and does not
  // appear (its attempts are still in History).
  //
  // Grouped here rather than in Node so the cap counts hosts. It used to cut
  // off the newest HISTORY_LIST_MAX_ROWS scans and group what was left, so one
  // site rescanned daily spent the whole allowance and pushed every other host
  // off the list, and any account past the cap read as truncated even with
  // nothing missing. The findings are read last, for the returned rows only.
  const retentionWindow =
    retentionDays > 0 ? `AND scanned_at > NOW() - ($3 * INTERVAL '1 day')` : "";
  const result = await pool.query<HostRow>(
    `WITH per_host AS (
       SELECT DISTINCT ON (host)
              id, host, url, summary, findings_count, scanned_at, is_public, scan_count
         FROM (
           SELECT id, url, summary, findings_count, scanned_at, is_public,
                  ${HOST_KEY_SQL} AS host,
                  COUNT(*) OVER (PARTITION BY ${HOST_KEY_SQL})::int AS scan_count
             FROM scan_history
            WHERE user_id = $1 AND (scan_type IS NULL OR scan_type != 'github')
              AND status = 'completed'
              ${retentionWindow}
         ) scans
        ORDER BY host, scanned_at DESC, id DESC
     ),
     page AS (
       SELECT per_host.*,
              COUNT(*) OVER ()::int AS total_hosts,
              SUM(scan_count) OVER ()::int AS total_scans
         FROM per_host
        ORDER BY scanned_at DESC, id DESC
        LIMIT $2
     )
     SELECT page.*, ${RATING_FINDINGS_SQL} AS findings
       FROM page
       JOIN scan_history USING (id)
      ORDER BY page.scanned_at DESC, page.id DESC`,
    retentionDays > 0
      ? [userId, historyMaxRows, Math.floor(retentionDays)]
      : [userId, historyMaxRows],
  );

  const assets: AssetRow[] = result.rows.map((row) => ({
    host: row.host,
    scanCount: row.scan_count,
    latestScanId: row.id,
    latestUrl: row.url,
    latestScannedAt: new Date(row.scanned_at).toISOString(),
    findingsCount: row.findings_count,
    summary: row.summary || {},
    safetyRating: getSafetyRating(row.findings || []),
    isPublic: row.is_public,
  }));

  // Both totals are computed before the cap, so they are real figures for the
  // retention window, and `truncated` is true only when a host was left out.
  // ref: AUDIT-015#api-04
  const totalHosts = result.rows[0]?.total_hosts ?? 0;
  return ApiResponse.success({
    assets,
    totalHosts,
    totalScans: result.rows[0]?.total_scans ?? 0,
    limit: historyMaxRows,
    truncated: totalHosts > assets.length,
  });
});
