/**
 * Host-level reputation cache: "has any VulnRadar user ever scanned this
 * host, and what did the latest scan find." Feeds the browser extension's
 * popup (GET /api/v3/scan/reputation), which shows up when a user visits a
 * site, similar to a password manager offering to save a login.
 *
 * `host_reputation` is keyed by the normalized root domain with NO user_id
 * column at all -- intentionally not tied to who scanned it. It is
 * public-safety data about a website, not personal data about who ran the
 * scan, so it must survive a user deleting their own scan history,
 * downgrading plans, or deleting their account entirely. See the matching
 * comments in lib/database/cleanup.ts and app/api/v3/data-request/route.ts,
 * and the table's creation site in instrumentation.ts.
 *
 * Every path that finishes a scan and writes to scan_history calls
 * `upsertHostReputation` so the cached row always reflects the most recent
 * scan of that host by anyone: lib/scanner/scan-jobs.ts's
 * finalizeScanSuccess (single-URL and crawl scans, run from the web app or
 * via API key), plus app/api/v3/scan/bulk/route.ts and
 * app/api/v3/scan/authenticated/route.ts, which write scan_history directly
 * instead of going through that shared function.
 */

import { isIP } from "net";
import pool from "@/lib/database/db";
import { getDangerScore } from "./safety-rating";
import { APP_NAME } from "@/lib/config/constants";
import type { Vulnerability } from "./types";

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

/**
 * Normalize a raw host or full URL string into the exact-hostname key
 * host_reputation is keyed by: strip protocol/path/port, lowercase, and
 * strip a leading "www." (the one collapse that's safe -- "www.example.com"
 * and "example.com" are conventionally the same site).
 *
 * Deliberately does NOT collapse to the registrable/organizational domain
 * the way lib/scanner/root-domain.ts's extractRootDomain does for crawl
 * scoping and subdomain enumeration. Reputation is per-host, not per-
 * organization: panel.vulnradar.dev finding a critical vuln says nothing
 * about vulnradar.dev's own security posture (different app, different
 * team, maybe a different security story entirely), so collapsing them
 * onto one host_reputation row -- which is exactly what calling
 * extractRootDomain here used to do -- made the extension's popup report
 * one subdomain's scan result for every other subdomain of the same site.
 * The path/query in a URL is correctly ignored (reputation is host-level,
 * not page-level); the subdomain label is not.
 *
 * Returns null for anything that isn't a domain-shaped hostname (a raw IP
 * literal, or unparseable input): host_reputation only ever tracks domains,
 * since the feature is "reputation of a website you're visiting," not of a
 * bare IP address.
 */
export function normalizeHostForReputation(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let hostname: string;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    // URL.hostname keeps the brackets for an IPv6 literal ("[::1]"), which
    // net.isIP() does not recognize as an IP -- strip them before the check.
    hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }

  if (!hostname || isIP(hostname)) return null;
  return hostname.replace(/^www\./, "");
}

export interface UpsertHostReputationParams {
  /** The scanned URL (or a bare hostname); normalized before storage. */
  url: string;
  /**
   * The FULL findings array, same shape scan_history stores -- this is a
   * standalone copy, not a reference, so the reputation row keeps showing
   * real findings even after the owning scan_history row is retained-out
   * or the account that ran it is deleted.
   */
  findings: Vulnerability[];
  summary: Partial<SeverityCounts>;
  /** Same shape as scan_history.response_headers; optional since not every caller has it handy. */
  responseHeaders?: Record<string, string> | null;
  /** The scan_history row this result came from, for the deep link. Null if unavailable. */
  scanId: number | null;
  scannedAt: string | Date;
  /**
   * Same shape as scan_history.result_meta (checksRun, engineConfidence,
   * incomplete, and for crawl scans, crawl) -- lets the public /host/[hostname]
   * page show the same "N checks run" detail /shared/[token] already does,
   * instead of always falling back to a generic total. Optional: bulk and
   * authenticated-session scans don't compute this today, so they fall back
   * to {} (the UI's own TOTAL_CHECKS_LABEL fallback handles the rest).
   */
  resultMeta?: Record<string, unknown>;
  /** Same as scan_history.authenticated. Defaults to false for callers that don't track it. */
  authenticated?: boolean;
}

/**
 * Upsert the host-level reputation row for whatever host `url` belongs to,
 * unconditionally overwriting with the freshest result -- there is no
 * "worse wins" merge logic, the row always reflects the latest scan.
 *
 * Fire-and-forget safe: never throws, only logs. A missed or failed upsert
 * only means the extension's popup shows stale data next time, never a
 * broken scan, so every call site can invoke this without awaiting it.
 */
export async function upsertHostReputation(
  params: UpsertHostReputationParams,
): Promise<void> {
  const {
    url,
    findings,
    summary,
    responseHeaders,
    scanId,
    scannedAt,
    resultMeta,
    authenticated,
  } = params;

  const host = normalizeHostForReputation(url);
  if (!host) return;

  const severityCounts: SeverityCounts = {
    critical: summary.critical ?? 0,
    high: summary.high ?? 0,
    medium: summary.medium ?? 0,
    low: summary.low ?? 0,
    info: summary.info ?? 0,
  };
  const dangerScore = getDangerScore(findings);
  const scannedAtIso =
    scannedAt instanceof Date ? scannedAt.toISOString() : scannedAt;

  try {
    await pool.query(
      `INSERT INTO host_reputation
         (host, danger_score, severity_counts, last_scanned_at, source_scan_id, findings, response_headers, result_meta, authenticated, scanned_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (host) DO UPDATE SET
         danger_score = EXCLUDED.danger_score,
         severity_counts = EXCLUDED.severity_counts,
         last_scanned_at = EXCLUDED.last_scanned_at,
         source_scan_id = EXCLUDED.source_scan_id,
         findings = EXCLUDED.findings,
         response_headers = EXCLUDED.response_headers,
         result_meta = EXCLUDED.result_meta,
         authenticated = EXCLUDED.authenticated,
         scanned_url = EXCLUDED.scanned_url`,
      [
        host,
        dangerScore,
        JSON.stringify(severityCounts),
        scannedAtIso,
        scanId,
        JSON.stringify(findings),
        responseHeaders ? JSON.stringify(responseHeaders) : null,
        JSON.stringify(resultMeta ?? {}),
        authenticated ?? false,
        url,
      ],
    );
  } catch (err) {
    console.error(
      `[${APP_NAME}] Failed to upsert host_reputation (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Strip the fragment (client-side only, never sent to or seen by the
 *  server) and prepend https:// if missing, matching how
 *  lib/scanner/execute-scan.ts's normalizeUrl treats a bare host before it
 *  ever reaches scan_history.url. Deliberately does NOT touch query
 *  strings, trailing slashes, or path casing -- this is a best-effort exact
 *  match, not a canonicalizer, and a mismatch on those just means the
 *  caller falls back to the host-level result instead of failing. */
function normalizeUrlForExactMatch(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z]+:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export interface ExactUrlReputationResult {
  url: string;
  dangerScore: number;
  severityCounts: SeverityCounts;
  lastScannedAt: string;
  scanId: number;
}

/**
 * Reputation for the EXACT page a caller is asking about, not just its
 * host -- distinct from host_reputation's "latest scan of anything on this
 * host" aggregate. A host like github.com hosts millions of unrelated
 * pages; showing one repo's scan result while browsing a completely
 * different repo on the same host is misleading. This is the first thing
 * GET /api/v3/scan/reputation now tries before falling back to the
 * host-level cache.
 *
 * Reads scan_history directly (no new table) since it already has
 * everything needed: url, findings, summary, scanned_at, is_public. Scoped
 * to `is_public = true` for the same reason upsertHostReputation only
 * writes host_reputation for public scans (see
 * lib/scanner/scan-jobs.ts's finalizeScanSuccess) -- this is a
 * public-safety lookup any visitor to a site can trigger, so a scan its
 * owner explicitly kept private must never be exposed through it, exact-URL
 * match or not.
 */
export async function getExactUrlReputation(
  rawUrl: string,
): Promise<ExactUrlReputationResult | null> {
  const url = normalizeUrlForExactMatch(rawUrl);
  if (!url) return null;

  try {
    const result = await pool.query<{
      id: number;
      url: string;
      findings: unknown;
      summary: Partial<SeverityCounts> | null;
      scanned_at: string | Date;
    }>(
      `SELECT id, url, findings, summary, scanned_at
       FROM scan_history
       WHERE url = $1 AND is_public = true AND status = 'completed'
       ORDER BY scanned_at DESC
       LIMIT 1`,
      [url],
    );

    const row = result.rows[0];
    if (!row) return null;

    const rawFindings =
      typeof row.findings === "string"
        ? JSON.parse(row.findings)
        : row.findings;
    const findings: Vulnerability[] = Array.isArray(rawFindings)
      ? rawFindings
      : [];
    const summary = row.summary ?? {};
    const severityCounts: SeverityCounts = {
      critical: summary.critical ?? 0,
      high: summary.high ?? 0,
      medium: summary.medium ?? 0,
      low: summary.low ?? 0,
      info: summary.info ?? 0,
    };

    return {
      url: row.url,
      dangerScore: getDangerScore(findings),
      severityCounts,
      lastScannedAt:
        row.scanned_at instanceof Date
          ? row.scanned_at.toISOString()
          : new Date(row.scanned_at).toISOString(),
      scanId: row.id,
    };
  } catch (err) {
    console.error(
      `[${APP_NAME}] Exact-URL reputation lookup failed (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
