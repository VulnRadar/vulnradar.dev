import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { normalizeHostForReputation } from "@/lib/scanner/host-reputation";
import { getDangerScore } from "@/lib/scanner/safety-rating";
import { APP_NAME } from "@/lib/config/constants";
import type { Vulnerability } from "@/lib/scanner/types";

/**
 * GET /api/v3/host/[hostname]/trend
 *
 * Public, no login required, same trust boundary as GET
 * /api/v3/host/[hostname] which it sits beside: backs the risk-score
 * history chart on the public report page at /host/[hostname]
 * (components/host/danger-score-trend.tsx).
 *
 * host_reputation only ever keeps the LATEST scan of a host -- every
 * upsertHostReputation call overwrites the row unconditionally (see
 * lib/scanner/host-reputation.ts) -- so there is no history to chart there.
 * This route reads scan_history directly instead, the same table
 * getExactUrlReputation reads for the exact-URL reputation lookup, and
 * applies the identical privacy scope: is_public = true AND status =
 * 'completed'. A scan its owner kept private (or an authenticated scan,
 * which is always private) must never surface here, exactly as documented
 * on getExactUrlReputation.
 *
 * scan_history has no `host` column (see instrumentation.ts's scan_history
 * DDL) -- only the full scanned `url`. Rather than adding a schema column
 * (a migration touches the same instrumentation.ts other in-flight work is
 * editing concurrently), this matches the host boundary with a regex:
 * scheme, optional "www.", the exact normalized host, then a port/path/
 * query boundary or end of string. That mirrors normalizeHostForReputation's
 * own www-stripping so "example.com" and "www.example.com" scans both
 * count, without also matching an unrelated subdomain like
 * "evil.example.com" or "example.com.attacker.com".
 */
export interface HostScoreTrendPoint {
  scanId: number;
  scannedAt: string;
  dangerScore: number;
}

export interface HostScoreTrendResponse {
  host: string;
  points: HostScoreTrendPoint[];
}

// Most-recent scans considered per host. Keeps the query bounded and the
// chart readable -- a host scanned daily for years doesn't need a decade
// of points, just enough to show direction.
const TREND_SCAN_LIMIT = 30;

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

    const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hostPattern = `^https?://(www\\.)?${escapedHost}([:/?]|$)`;

    const result = await pool.query<{
      id: number;
      findings: Vulnerability[] | string | null;
      scanned_at: string | Date;
    }>(
      `SELECT id, findings, scanned_at
       FROM scan_history
       WHERE is_public = true AND status = 'completed' AND url ~* $1
       ORDER BY scanned_at DESC
       LIMIT $2`,
      [hostPattern, TREND_SCAN_LIMIT],
    );

    const points: HostScoreTrendPoint[] = result.rows
      .map((row) => {
        const rawFindings =
          typeof row.findings === "string"
            ? JSON.parse(row.findings)
            : row.findings;
        const findings: Vulnerability[] = Array.isArray(rawFindings)
          ? rawFindings
          : [];
        return {
          scanId: row.id,
          scannedAt:
            row.scanned_at instanceof Date
              ? row.scanned_at.toISOString()
              : new Date(row.scanned_at).toISOString(),
          dangerScore: getDangerScore(findings),
        };
      })
      // Query orders newest-first so LIMIT keeps the most recent scans;
      // the chart reads left-to-right chronologically.
      .reverse();

    const body: HostScoreTrendResponse = { host, points };
    return NextResponse.json(body);
  } catch (error) {
    console.error(
      `[${APP_NAME}] Host score trend lookup error:`,
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error:
          "An unexpected error occurred while loading this host's score trend.",
      },
      { status: 500 },
    );
  }
}
