import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { normalizeHostForReputation } from "@/lib/scanner/host-reputation";
import { getDangerScore } from "@/lib/scanner/safety-rating";
import { RATING_FINDINGS_SQL } from "@/lib/scanner/rating-findings-sql";
import { PUBLIC_HOST_SQL } from "@/lib/database/sql-fragments";
import { APP_NAME } from "@/lib/config/constants";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getClientIp, rateLimitIpKey } from "@/lib/api/request-utils";
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
 * scan_history has no `host` column, only the full scanned `url`, so the
 * match is on PUBLIC_HOST_SQL: the host inside url, lowercased, one leading
 * "www." removed. That mirrors normalizeHostForReputation, so "example.com"
 * and "www.example.com" scans both count, while "evil.example.com" and
 * "example.com.attacker.com" do not. It has to be that exact expression text
 * and those exact two predicates, because that is what the partial index
 * idx_scan_history_public_host is built on: anything else still returns the
 * right rows and quietly goes back to walking every public scan.
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
    // abuse: anonymous, and the hostname it looks up is whatever the caller
    // put in the path, against the one table every list, dashboard and public
    // page reads from. Same publicScans budget the host report uses, under its
    // own key so a normal page load (which fetches both) spends one from each
    // rather than two from one.
    const ip = await getClientIp();
    const rl = await checkRateLimit({
      key: `host-trend:${rateLimitIpKey(ip)}`,
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
      id: number;
      findings: Vulnerability[] | string | null;
      scanned_at: string | Date;
    }>(
      // perf: this used to select the whole findings JSONB -- every finding's
      // description, explanation, fixSteps and codeExamples -- for 30 rows on
      // a public unauthenticated route, purely to hand each array to
      // getDangerScore. That function reads exactly four fields off a
      // finding, so project those four in SQL and leave the rest on disk,
      // the same shape app/api/v3/shares/route.ts and the posture digest
      // already use (AUDIT-012#perf-16).
      `SELECT id, scanned_at, ${RATING_FINDINGS_SQL} AS findings
       FROM scan_history
       WHERE is_public = true AND status = 'completed' AND ${PUBLIC_HOST_SQL} = $1
       ORDER BY scanned_at DESC
       LIMIT $2`,
      [host, TREND_SCAN_LIMIT],
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
