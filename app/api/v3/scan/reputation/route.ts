import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { validateApiKey } from "@/lib/api/api-keys";
import {
  checkRateLimit as checkGlobalRL,
  RATE_LIMITS,
} from "@/lib/rate-limiting/rate-limit";
import pool from "@/lib/database/db";
import { APP_NAME, BEARER_PREFIX } from "@/lib/config/constants";
import {
  normalizeHostForReputation,
  type SeverityCounts,
} from "@/lib/scanner/host-reputation";

/**
 * GET /api/v3/scan/reputation?host=<hostname>
 *
 * Extension-facing: "has any VulnRadar user ever scanned this host, and
 * what did the latest scan find." Backs the browser extension's popup
 * (a password-manager-style prompt shown when visiting a site). Reads
 * host_reputation, a host-keyed cache with no user_id column, so this
 * answers for the host regardless of who scanned it, what plan they were
 * on, or whether they've since deleted that scan or their account.
 *
 * Auth: same dual pattern as POST /api/v3/scan (API key via
 * `Authorization: Bearer <key>`, else session cookie), and rate-limited the
 * same way via lib/rate-limiting/rate-limit.ts.
 *
 * The response shape below is a contract the extension codes against
 * directly -- keep field names and null-vs-value semantics exact.
 */
export interface ScanReputationResponse {
  known: boolean;
  host: string;
  dangerScore: number | null;
  severityCounts: SeverityCounts | null;
  lastScannedAt: string | null;
  scanId: number | null;
}

export async function GET(request: NextRequest) {
  try {
    // Auth: check API key first (Bearer token), then fall back to session
    // cookie. Same dual-auth pattern as POST /api/v3/scan.
    const authHeader = request.headers.get("authorization");
    let authedUserId: number | null = null;

    if (authHeader?.startsWith(BEARER_PREFIX)) {
      const token = authHeader.slice(7);
      const keyData = await validateApiKey(token);

      if (!keyData) {
        return NextResponse.json(
          { error: "Invalid or revoked API key." },
          { status: 401 },
        );
      }

      if (keyData.needsTermsAcceptance) {
        return NextResponse.json(
          {
            error:
              "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API.",
          },
          { status: 403 },
        );
      }

      authedUserId = keyData.userId;
    } else {
      const session = await getSession();
      if (!session) {
        return NextResponse.json(
          {
            error:
              "Unauthorized. Provide an API key via Authorization: Bearer <key> header, or sign in.",
          },
          { status: 401 },
        );
      }
      authedUserId = session.userId;
    }

    // Rate limit: a lightweight lookup, not a scan trigger, so it uses the
    // general API cap rather than the heavier scan-trigger cap.
    const rl = await checkGlobalRL({
      key: `scan-reputation:${authedUserId}`,
      ...RATE_LIMITS.api,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: `Rate limit reached. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
        },
        { status: 429 },
      );
    }

    const rawHost = request.nextUrl.searchParams.get("host");
    if (!rawHost || !rawHost.trim()) {
      return NextResponse.json(
        { error: "host query parameter is required." },
        { status: 400 },
      );
    }

    const host = normalizeHostForReputation(rawHost);
    if (!host) {
      return NextResponse.json(
        { error: "Invalid host parameter." },
        { status: 400 },
      );
    }

    const result = await pool.query<{
      danger_score: number;
      severity_counts: SeverityCounts;
      last_scanned_at: string | Date;
      source_scan_id: number | null;
    }>(
      `SELECT danger_score, severity_counts, last_scanned_at, source_scan_id
       FROM host_reputation
       WHERE host = $1`,
      [host],
    );

    const row = result.rows[0];
    if (!row) {
      const body: ScanReputationResponse = {
        known: false,
        host,
        dangerScore: null,
        severityCounts: null,
        lastScannedAt: null,
        scanId: null,
      };
      return NextResponse.json(body);
    }

    const body: ScanReputationResponse = {
      known: true,
      host,
      dangerScore: row.danger_score,
      severityCounts: row.severity_counts,
      lastScannedAt: new Date(row.last_scanned_at).toISOString(),
      // source_scan_id is nulled automatically (ON DELETE SET NULL) if the
      // underlying scan_history row was deleted, so this is already exact.
      scanId: row.source_scan_id,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error(
      `[${APP_NAME}] Host reputation lookup error:`,
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "An unexpected error occurred while looking up host reputation." },
      { status: 500 },
    );
  }
}
