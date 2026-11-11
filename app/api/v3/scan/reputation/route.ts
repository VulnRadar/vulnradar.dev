import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseBearer } from "@/lib/api/bearer";
import { authenticateApiKey } from "@/lib/api/api-key-auth";
import { API_KEY_SCOPES } from "@/lib/api/api-key-scopes";
import { withErrorHandling } from "@/lib/api/api-utils";
import { burstLimitedResponse } from "@/lib/api/rate-limit-response";
import { versioned } from "@/lib/api/v4/wrap";
import {
  checkRateLimit as checkGlobalRL,
  RATE_LIMITS,
} from "@/lib/rate-limiting/rate-limit";
import pool from "@/lib/database/db";
import { APP_NAME } from "@/lib/config/constants";
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
   * The same scan's opaque id, which is what a scan URL takes. Null when
   * known is false, and when the scan behind a host-level row has since been
   * deleted (source_scan_id is then null too).
   */
  scanPublicId: string | null;
  /**
   * "exact" when this reflects a scan of the precise page the caller asked
   * about (via the `url` query param, compared by origin and path); "host"
   * when it's the host-level fallback -- a scan of a DIFFERENT page on the
   * same host, since a scan of one page shouldn't be shown as the reputation
   * of every unrelated page on a host like github.com. null when known is
   * false.
   */
  matchType: "exact" | "host" | null;
  /**
   * The page that was actually scanned to produce this result, as origin and
   * path. Only ever set for an "exact" match, where it is the page the caller
   * asked about; the stored query string is never included, since the match
   * ignores it and it belongs to whoever ran that scan. Always null for a
   * "host" fallback match or when known is false -- a host-level match is
   * someone ELSE's scan of an unrelated page on this host, and returning that
   * URL verbatim (including its query string) to a caller who only knows the
   * hostname would leak whatever that URL contained, e.g. a token in a
   * password-reset or magic-login link (AUDIT-009#reputation-01).
   */
  scannedUrl: string | null;
}

async function handler(request: NextRequest) {
  try {
    // Auth: check API key first (Bearer token), then fall back to session
    // cookie. Same dual-auth pattern as POST /api/v3/scan.
    let authedUserId: number;

    if (parseBearer(request.headers.get("authorization")) !== null) {
      // scoping: this is a read (host reputation lookup), so it requires
      // scan:read.
      const key = await authenticateApiKey(request, {
        scope: API_KEY_SCOPES.SCAN_READ,
      });
      if (!key.ok) return key.response;
      authedUserId = key.auth.userId;
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

    // Validated before the limiter, so a malformed lookup costs the caller
    // nothing: the extension asks once per site visited and must not spend
    // its window on a tab whose host is an IP or a browser page.
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

    // Its own named limit (RATE_LIMIT_REPUTATION_*), not the general API
    // cap: the extension looks up every site its user visits, so the right
    // ceiling is far above what a scripted client needs elsewhere.
    const rl = await checkGlobalRL({
      key: `scan-reputation:${authedUserId}`,
      ...RATE_LIMITS.reputation,
    });
    if (!rl.allowed) {
      return burstLimitedResponse(
        rl,
        `Rate limit reached. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
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
          scanPublicId: exact.scanPublicId,
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
      source_scan_public_id: string | null;
      findings: unknown;
    }>(
      `SELECT hr.danger_score, hr.severity_counts, hr.last_scanned_at, hr.source_scan_id,
              sh.public_id AS source_scan_public_id, hr.findings
       FROM host_reputation hr
       LEFT JOIN scan_history sh ON sh.id = hr.source_scan_id
       WHERE hr.host = $1`,
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
        scanPublicId: null,
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
      scanPublicId: row.source_scan_public_id ?? null,
      matchType: "host",
      // Deliberately NOT the scan's URL here (AUDIT-009#reputation-01).
      // A host-level match is someone ELSE's scan of a DIFFERENT page on
      // this host -- the caller never supplied that URL, so returning it
      // verbatim (including its query string) to any signed-in caller who
      // only knows the hostname would leak whatever that URL contained,
      // e.g. a password-reset or magic-login link with a token in the
      // query string. scannedUrl is only set in the "exact" branch above,
      // for the page the caller named themselves.
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

export const GET = versioned("scan.reputation", withErrorHandling(handler));
