import type { ScanResult } from "@/lib/scanner/types";

/**
 * Shape of GET /api/v3/history/[id]'s JSON body (app/api/v3/history/[id]/route.ts),
 * restricted to the fields that make up a ScanResult. The route also returns
 * notes/userId/isPublic/crawl and whatever else lives in result_meta -- this
 * type only names what mapHistoryDetailResponse below actually consumes, not
 * the full response.
 */
export interface HistoryDetailResponse {
  url: string;
  scannedAt: string;
  duration: number;
  summary: ScanResult["summary"];
  findings: ScanResult["findings"];
  responseHeaders?: ScanResult["responseHeaders"];
  authenticated?: boolean;
  checksRun?: number;
  dangerScore?: number;
  engineConfidence?: number;
  incomplete?: string[];
  /** From scan_history.result_meta: a redirect away from the requested URL. */
  redirect?: ScanResult["redirect"];
  /** From scan_history.result_meta once a "Generate AI summary" action has run. */
  aiSummary?: string;
  /** From scan_history.result_meta when an opt-in page screenshot was captured. */
  screenshot?: ScanResult["screenshot"];
  /** From scan_history.result_meta: the full structured DNS record set. */
  dnsRecords?: ScanResult["dnsRecords"];
  /** From scan_history.result_meta: auto-discovered subdomains captured during the scan. */
  subdomains?: ScanResult["subdomains"];
  /** From scan_history.result_meta: the opt-in curated port sweep result. */
  portScan?: ScanResult["portScan"];
  /** From scan_history.result_meta: TLS grade (A+..F), when the target served HTTPS. */
  sslGrade?: ScanResult["sslGrade"];
  /** From scan_history.result_meta: multi-source threat-reputation summary. */
  threatIntel?: ScanResult["threatIntel"];
  /** From scan_history.result_meta: detected software with CVE correlation. */
  softwareInventory?: ScanResult["softwareInventory"];
}

/**
 * Maps a GET /api/v3/history/[id] response onto the ScanResult shape every
 * page that renders <ScanSummary> expects, shared by every caller of that
 * endpoint (app/history/page.tsx, components/repos/repo-detail.tsx) so the
 * field list lives in exactly one place.
 *
 * Extracted after aiSummary was silently dropped by both callers' own
 * hand-rolled field lists: the API route already spread result_meta
 * (including aiSummary) into its response, but neither caller picked that
 * key back out, so a generated summary never reached the screen even though
 * app/shared/[token]/page.tsx -- which stores the whole fetched object
 * instead of cherry-picking fields -- showed it fine. A single shared
 * mapper means a field added to ScanResult in the future can't quietly go
 * missing on one caller and not another the same way again.
 */
export function mapHistoryDetailResponse(
  data: HistoryDetailResponse,
): ScanResult {
  return {
    url: data.url,
    scannedAt: data.scannedAt,
    duration: data.duration,
    summary: data.summary,
    findings: data.findings,
    responseHeaders: data.responseHeaders,
    authenticated: data.authenticated || false,
    checksRun: data.checksRun,
    dangerScore: data.dangerScore,
    engineConfidence: data.engineConfidence,
    incomplete: data.incomplete,
    redirect: data.redirect,
    aiSummary: data.aiSummary,
    screenshot: data.screenshot,
    dnsRecords: data.dnsRecords,
    subdomains: data.subdomains,
    portScan: data.portScan,
    sslGrade: data.sslGrade,
    threatIntel: data.threatIntel,
    softwareInventory: data.softwareInventory,
  };
}
