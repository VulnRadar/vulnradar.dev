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
import { extractRootDomain } from "./root-domain";
import { getDangerScore } from "./safety-rating";
import { APP_NAME } from "@/lib/config/constants";

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

/** Shape getDangerScore actually needs; matches the Finding interface in safety-rating.ts. */
interface ReputationFinding {
  severity: string;
  title: string;
  confidence?: number;
}

/**
 * Normalize a raw host or full URL string into the root-domain key
 * host_reputation is keyed by: strip protocol/path/port, lowercase, strip a
 * leading "www.", and collapse to the registrable/organizational domain via
 * extractRootDomain -- the same grouping lib/scanner/root-domain.ts already
 * provides for grouping scans by root host.
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
  return extractRootDomain(hostname);
}

export interface UpsertHostReputationParams {
  /** The scanned URL (or a bare hostname); normalized before storage. */
  url: string;
  findings: ReputationFinding[];
  summary: Partial<SeverityCounts>;
  /** The scan_history row this result came from, for the deep link. Null if unavailable. */
  scanId: number | null;
  scannedAt: string | Date;
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
  const { url, findings, summary, scanId, scannedAt } = params;

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
      `INSERT INTO host_reputation (host, danger_score, severity_counts, last_scanned_at, source_scan_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (host) DO UPDATE SET
         danger_score = EXCLUDED.danger_score,
         severity_counts = EXCLUDED.severity_counts,
         last_scanned_at = EXCLUDED.last_scanned_at,
         source_scan_id = EXCLUDED.source_scan_id`,
      [host, dangerScore, JSON.stringify(severityCounts), scannedAtIso, scanId],
    );
  } catch (err) {
    console.error(
      `[${APP_NAME}] Failed to upsert host_reputation (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}
