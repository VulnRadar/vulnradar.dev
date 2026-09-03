import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import type { SettingKey } from "@/lib/config/registry";
import { normalizeHostForReputation } from "@/lib/scanner/host-reputation";
import {
  getSafetyRating,
  type SafetyRating,
} from "@/lib/scanner/safety-rating";
import type { Vulnerability } from "@/lib/scanner/types";

/**
 * GET /api/v3/assets
 *
 * Backs app/assets/page.tsx: every distinct host the caller has scanned,
 * grouped from their own scan_history rows, most-recently-scanned host
 * first. scan_history has no separate `host` column (only the full scanned
 * `url`), so the GROUP BY happens here in JS via hostForGrouping() rather
 * than in SQL -- see normalizeHostForReputation's own doc comment for why
 * host extraction is a TS URL parse, not a SQL regex, elsewhere in this
 * codebase.
 *
 * Retention mirrors GET /api/v3/history exactly (same setting keys, same
 * dated-window vs. unlimited branching, same HISTORY_LIST_MAX_ROWS cap): a
 * host whose only qualifying scan already fell outside the caller's plan
 * retention window must not appear here just because /api/v3/history also
 * hides it.
 *
 * Each row's safety rating comes from getSafetyRating() run against that
 * host's latest scan's full findings array -- the same function and the
 * same "safe / caution / unsafe" verdict GET /api/v3/public-scans computes
 * per row -- not a re-derivation from the aggregated severity counts alone.
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

interface ScanHistoryRow {
  id: number;
  url: string;
  summary: Record<string, number> | null;
  findings_count: number;
  scanned_at: string | Date;
  is_public: boolean;
}

/**
 * Grouping key for one scanned URL. normalizeHostForReputation strips
 * protocol/path/port/www and lowercases -- the exact host identity the
 * /host/[hostname] aggregate page (this route's link target) resolves --
 * but it deliberately returns null for a bare IP literal (see its own doc
 * comment), same as host_reputation never tracking IPs. Falls back to a
 * raw hostname parse so an IP-scanned target still gets its own row instead
 * of silently disappearing from the list (its /host/ link just won't
 * resolve to a report, same as it wouldn't anywhere else in the app today).
 */
function hostForGrouping(url: string): string {
  const normalized = normalizeHostForReputation(url);
  if (normalized) return normalized;

  const trimmed = url.trim();
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
    return new URL(
      hasScheme ? trimmed : `https://${trimmed}`,
    ).hostname.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

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
  if (request.nextUrl.searchParams.get("scope") === "all") {
    const res = await pool.query<{
      host: string;
      severity_counts: Record<string, number> | null;
      findings: Vulnerability[] | null;
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
      `SELECT host, severity_counts, findings, last_scanned_at, source_scan_id
       FROM host_reputation
       ORDER BY last_scanned_at DESC
       LIMIT $1`,
      [ALL_HOSTS_MAX],
    );
    const assets: AssetRow[] = res.rows.map((r) => {
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
      truncated: res.rows.length === ALL_HOSTS_MAX,
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
  const result = await pool.query<ScanHistoryRow>(
    retentionDays <= 0
      ? `SELECT id, url, summary, findings_count, scanned_at, is_public
         FROM scan_history
         WHERE user_id = $1 AND (scan_type IS NULL OR scan_type != 'github')
         ORDER BY scanned_at DESC
         LIMIT $2`
      : `SELECT id, url, summary, findings_count, scanned_at, is_public
         FROM scan_history
         WHERE user_id = $1 AND (scan_type IS NULL OR scan_type != 'github')
           AND scanned_at > NOW() - ($2 * INTERVAL '1 day')
         ORDER BY scanned_at DESC
         LIMIT $3`,
    retentionDays <= 0
      ? [userId, historyMaxRows]
      : [userId, Math.floor(retentionDays), historyMaxRows],
  );

  // Rows arrive most-recent-first (ORDER BY scanned_at DESC above), so the
  // first row seen for a given host is already that host's latest scan --
  // no re-sorting needed once grouped.
  const groups = new Map<
    string,
    { host: string; scanCount: number; latest: ScanHistoryRow }
  >();
  for (const row of result.rows) {
    const host = hostForGrouping(row.url);
    const existing = groups.get(host);
    if (existing) {
      existing.scanCount += 1;
    } else {
      groups.set(host, { host, scanCount: 1, latest: row });
    }
  }

  // Full findings (needed for getSafetyRating's title/severity matching)
  // are only fetched for each host's single latest scan, not for every row
  // in the retention window -- keeps this bounded to one row per host
  // instead of one row per scan.
  const latestIds = Array.from(groups.values()).map((g) => g.latest.id);
  const findingsByScanId = new Map<number, Vulnerability[]>();
  if (latestIds.length > 0) {
    const findingsRes = await pool.query<{
      id: number;
      findings: Vulnerability[] | null;
    }>(`SELECT id, findings FROM scan_history WHERE id = ANY($1::int[])`, [
      latestIds,
    ]);
    for (const row of findingsRes.rows) {
      findingsByScanId.set(row.id, row.findings || []);
    }
  }

  const assets: AssetRow[] = Array.from(groups.values()).map((g) => ({
    host: g.host,
    scanCount: g.scanCount,
    latestScanId: g.latest.id,
    latestUrl: g.latest.url,
    latestScannedAt: new Date(g.latest.scanned_at).toISOString(),
    findingsCount: g.latest.findings_count,
    summary: g.latest.summary || {},
    safetyRating: getSafetyRating(findingsByScanId.get(g.latest.id) || []),
    isPublic: g.latest.is_public,
  }));

  // totalScans is the number of scan rows this request grouped, and that read
  // is capped at HISTORY_LIST_MAX_ROWS, so on an account with more scans than
  // the cap it silently pins to the cap and both counts understate the truth.
  // `limit` and `truncated` say so rather than leaving the client to present a
  // ceiling as a total. ref: AUDIT-015#api-04
  return ApiResponse.success({
    assets,
    totalHosts: assets.length,
    totalScans: result.rows.length,
    limit: historyMaxRows,
    truncated: result.rows.length === historyMaxRows,
  });
});
