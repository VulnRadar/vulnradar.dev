import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import {
  normalizeHostForReputation,
  type SeverityCounts,
} from "@/lib/scanner/host-reputation";
import { APP_NAME } from "@/lib/config/constants";
import type { Vulnerability } from "@/lib/scanner/types";

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
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hostname: string }> },
) {
  try {
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
    }>(
      `SELECT danger_score, severity_counts, findings, response_headers, last_scanned_at
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
      };
      return NextResponse.json(body);
    }

    const body: HostReportData = {
      known: true,
      host,
      dangerScore: row.danger_score,
      severityCounts: row.severity_counts,
      findings: row.findings || [],
      responseHeaders: row.response_headers || null,
      lastScannedAt: new Date(row.last_scanned_at).toISOString(),
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
