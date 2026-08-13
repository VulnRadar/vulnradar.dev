import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { validateApiKey } from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import {
  checkRateLimit as checkGlobalRL,
  RATE_LIMITS,
} from "@/lib/rate-limiting/rate-limit";
import pool from "@/lib/database/db";
import { APP_NAME, BEARER_PREFIX } from "@/lib/config/constants";
import {
  normalizeHostForReputation,
  getExactUrlReputation,
  type SeverityCounts,
} from "@/lib/scanner/host-reputation";
import {
  getSafetyRating,
  type SafetyRating,
} from "@/lib/scanner/safety-rating";
import type { Vulnerability } from "@/lib/scanner/types";

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
  /**
   * The canonical safe/caution/unsafe tier (lib/scanner/safety-rating.ts's
   * getSafetyRating), computed here from the full findings array. Every
   * consumer (extension popup, content-script card, badge) should read
   * this directly instead of re-deriving a tier from severityCounts --
   * a naive "high > 0" re-derivation can't distinguish a high-severity
   * EXPLOITABLE finding from a high-severity HARDENING one (e.g. a lone
   * "Missing HSTS"), so it wrongly flags hosts the canonical scorer
   * considers safe. null only when known is false.
   */
  verdict: SafetyRating | null;
  severityCounts: SeverityCounts | null;
  lastScannedAt: string | null;
  scanId: number | null;
  /**
   * "exact" when this reflects a scan of the precise page the caller asked
   * about (via the `url` query param); "host" when it's the host-level
   * fallback -- a scan of a DIFFERENT page on the same host, since a scan
   * of one page shouldn't be shown as the reputation of every unrelated
   * page on a host like github.com. null when known is false.
   */
  matchType: "exact" | "host" | null;
  /**
   * The exact URL that was actually scanned to produce this result.
   * Only ever set for an "exact" match, where it just echoes back the
   * `url` the caller already supplied. Always null for a "host" fallback
   * match or when known is false -- a host-level match is someone ELSE's
   * scan of an unrelated page on this host, and returning that URL
   * verbatim (including its query string) to a caller who only knows the
   * hostname would leak whatever that URL contained, e.g. a token in a
   * password-reset or magic-login link (AUDIT-009#reputation-01).
   */
  scannedUrl: string | null;
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

      // scoping: this is a read (host reputation lookup), so it requires
      // scan:read.
      if (!hasApiKeyScope(keyData.scopes, API_KEY_SCOPES.SCAN_READ)) {
        return NextResponse.json(
          { error: apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_READ) },
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

    // Exact-page match first: the caller passes `url` (the page it's
    // actually asking about, not just its host) whenever it has one --
    // the extension does since it always knows the current tab's exact
    // URL. See getExactUrlReputation's own doc comment for why this
    // exists: host_reputation is host-level, so without this a scan of
    // one page (e.g. one repo on github.com) gets shown as "the
    // reputation" of every other unrelated page on that same host.
    const rawUrl = request.nextUrl.searchParams.get("url");
    if (rawUrl && rawUrl.trim()) {
      const exact = await getExactUrlReputation(rawUrl);
      if (exact) {
        const body: ScanReputationResponse = {
          known: true,
          host,
          dangerScore: exact.dangerScore,
          verdict: exact.verdict,
          severityCounts: exact.severityCounts,
          lastScannedAt: exact.lastScannedAt,
          scanId: exact.scanId,
          matchType: "exact",
          scannedUrl: exact.url,
        };
        return NextResponse.json(body);
      }
    }

    const result = await pool.query<{
      danger_score: number;
      severity_counts: SeverityCounts;
      last_scanned_at: string | Date;
      source_scan_id: number | null;
      scanned_url: string | null;
      findings: unknown;
    }>(
      `SELECT danger_score, severity_counts, last_scanned_at, source_scan_id, scanned_url, findings
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
        verdict: null,
        severityCounts: null,
        lastScannedAt: null,
        scanId: null,
        matchType: null,
        scannedUrl: null,
      };
      return NextResponse.json(body);
    }

    const rawFindings =
      typeof row.findings === "string"
        ? JSON.parse(row.findings)
        : row.findings;
    const findings: Vulnerability[] = Array.isArray(rawFindings)
      ? rawFindings
      : [];

    const body: ScanReputationResponse = {
      known: true,
      host,
      dangerScore: row.danger_score,
      verdict: getSafetyRating(findings),
      severityCounts: row.severity_counts,
      lastScannedAt: new Date(row.last_scanned_at).toISOString(),
      // source_scan_id is nulled automatically (ON DELETE SET NULL) if the
      // underlying scan_history row was deleted, so this is already exact.
      scanId: row.source_scan_id,
      matchType: "host",
      // Deliberately NOT row.scanned_url here (AUDIT-009#reputation-01).
      // A host-level match is someone ELSE's scan of a DIFFERENT page on
      // this host -- the caller never supplied that URL, so returning it
      // verbatim (including its query string) to any signed-in caller who
      // only knows the hostname would leak whatever that URL contained,
      // e.g. a password-reset or magic-login link with a token in the
      // query string. scannedUrl only round-trips the URL the caller
      // already gave us themselves, in the "exact" branch above.
      scannedUrl: null,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error(
      `[${APP_NAME}] Host reputation lookup error:`,
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "An unexpected error occurred while looking up host reputation.",
      },
      { status: 500 },
    );
  }
}
