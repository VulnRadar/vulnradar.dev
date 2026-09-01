import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import {
  normalizeHostForReputation,
  type SeverityCounts,
} from "@/lib/scanner/host-reputation";
import { APP_NAME } from "@/lib/config/constants";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getClientIp, rateLimitIpKey } from "@/lib/api/request-utils";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

/**
 * GET /api/v3/host/[hostname]
 *
 * Public, no login required: backs the public report page at
 * /host/[hostname] (app/host/[hostname]/page.tsx), the
 * securityheaders.com/SSL-Labs-style feature where a host's latest public
 * scan is viewable by anyone at a stable URL. Reads host_reputation
 * directly -- the SAME table GET /api/v3/scan/reputation reads for the
 * browser extension's popup, just without that route's auth requirement,
 * since this one is meant to be shared and crawled.
 *
 * Never reflects a scan its owner marked private: every upsertHostReputation
 * call site (lib/scanner/scan-jobs.ts, app/api/v3/scan/bulk/route.ts,
 * app/api/v3/scan/authenticated/route.ts) already skips non-public scans,
 * and PATCH /api/v3/history/[id] deletes the host_reputation row outright
 * when the scan that sourced it is flipped from public to private.
 */
export interface HostReportData {
  known: boolean;
  host: string;
  dangerScore: number | null;
  severityCounts: SeverityCounts | null;
  findings: Vulnerability[];
  responseHeaders: Record<string, string> | null;
  lastScannedAt: string | null;
  authenticated: boolean;
  // From host_reputation.result_meta, same source app/api/v3/history/[id]/
  // route.ts reads it from for the owner's own view -- kept in parity so a
  // public host report shows the same detail an owner sees.
  checksRun?: number;
  engineConfidence?: number;
  incomplete?: string[];
  /**
   * The AI scan summary, once the source scan's owner generated one. Resolved
   * from the live scan_history row in the GET handler (it is written there
   * on-demand and never copied into the host_reputation snapshot), falling back
   * to the snapshot's result_meta.
   */
  aiSummary?: string;
  /**
   * The rest of host_reputation.result_meta, same source and shape the owner's
   * own view reads. Declared so the shared report renderer surfaces them here
   * too instead of this hand-built shape silently dropping them (which is
   * exactly how the SSL grade went missing on this page). All come from public
   * scans only -- host_reputation never reflects a private scan.
   */
  sslGrade?: ScanResult["sslGrade"];
  threatIntel?: ScanResult["threatIntel"];
  softwareInventory?: ScanResult["softwareInventory"];
  dnsRecords?: ScanResult["dnsRecords"];
  portScan?: ScanResult["portScan"];
  subdomains?: ScanResult["subdomains"];
  screenshot?: ScanResult["screenshot"];
  /**
   * The same rule-computed tags (lib/tags/auto-tags.ts) a scan owner sees
   * on their own scan, computed from this same findings snapshot at
   * upsertHostReputation time. Always [] for a legacy row that predates
   * this column until its host is scanned again.
   */
  autoTags: string[];
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hostname: string }> },
) {
  try {
    // abuse: unauthenticated and one row per hostname, so without a limiter
    // the whole public-scan corpus (every host anyone has ever scanned
    // publicly, with its full findings) could be walked for free at whatever
    // rate a caller liked. Shares the publicScans bucket with the directory
    // listing at /api/v3/public-scans, which is the same corpus by another
    // door. The badge SVG endpoints are deliberately NOT limited this way:
    // they are embedded in READMEs and fetched through image proxies whose
    // whole traffic arrives from a handful of addresses, so a per-IP cap
    // there would break legitimate badges rather than stop a scraper.
    const ip = await getClientIp();
    const rl = await checkRateLimit({
      key: `host-report:${rateLimitIpKey(ip)}`,
      ...RATE_LIMITS.publicScans,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSeconds) },
        },
      );
    }

    const { hostname: rawHostname } = await params;
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawHostname);
    } catch {
      decoded = rawHostname;
    }
    const host = normalizeHostForReputation(decoded);
    if (!host) {
      return NextResponse.json({ error: "Invalid hostname." }, { status: 400 });
    }

    const result = await pool.query<{
      danger_score: number;
      severity_counts: SeverityCounts;
      findings: Vulnerability[];
      response_headers: Record<string, string> | null;
      last_scanned_at: string | Date;
      result_meta: Record<string, unknown> | null;
      authenticated: boolean;
      auto_tags: string[] | null;
      source_scan_id: number | null;
    }>(
      `SELECT danger_score, severity_counts, findings, response_headers, last_scanned_at, result_meta, authenticated, auto_tags, source_scan_id
       FROM host_reputation
       WHERE host = $1`,
      [host],
    );

    const row = result.rows[0];
    if (!row) {
      const body: HostReportData = {
        known: false,
        host,
        dangerScore: null,
        severityCounts: null,
        findings: [],
        responseHeaders: null,
        lastScannedAt: null,
        authenticated: false,
        autoTags: [],
      };
      return NextResponse.json(body);
    }

    // host_reputation is a snapshot frozen at scan-completion time. Two kinds of
    // data live only on the source scan_history row and never make it into that
    // snapshot: on-demand AI enrichment (result_meta.aiSummary and per-finding
    // aiVerdict, both written to scan_history AFTER the scan finishes), and, for
    // rows created before findings/result_meta were added to host_reputation, the
    // findings and meta themselves (the snapshot defaults them to []/{}, leaving
    // the report showing only the base stats). Resolve the live source scan
    // (public only -- the row is deleted when its scan is made private) and let
    // its findings and result_meta win, falling back to the frozen snapshot when
    // the source scan is missing, private, or predates source_scan_id.
    let liveFindings: Vulnerability[] | null = null;
    let liveMeta: Record<string, unknown> | null = null;
    if (row.source_scan_id != null) {
      try {
        const live = await pool.query<{
          findings: Vulnerability[] | null;
          result_meta: Record<string, unknown> | null;
        }>(
          `SELECT findings, result_meta FROM scan_history WHERE id = $1 AND is_public = true`,
          [row.source_scan_id],
        );
        const scan = live.rows[0];
        if (scan) {
          if (Array.isArray(scan.findings) && scan.findings.length > 0) {
            liveFindings = scan.findings;
          }
          if (scan.result_meta) liveMeta = scan.result_meta;
        }
      } catch (liveErr) {
        console.error(
          `[${APP_NAME}] Host report: source scan lookup failed (using snapshot):`,
          liveErr instanceof Error ? liveErr.message : liveErr,
        );
      }
    }

    // Live meta overrides the snapshot but never drops a field the snapshot had.
    const meta = { ...(row.result_meta || {}), ...(liveMeta || {}) };
    const body: HostReportData = {
      known: true,
      host,
      dangerScore: row.danger_score,
      severityCounts: row.severity_counts,
      findings: liveFindings ?? row.findings ?? [],
      responseHeaders: row.response_headers || null,
      lastScannedAt: new Date(row.last_scanned_at).toISOString(),
      authenticated: row.authenticated || false,
      autoTags: row.auto_tags || [],
      ...meta,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error(
      `[${APP_NAME}] Host report lookup error:`,
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "An unexpected error occurred while looking up this host." },
      { status: 500 },
    );
  }
}
