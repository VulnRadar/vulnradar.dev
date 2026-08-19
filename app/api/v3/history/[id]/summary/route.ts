import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { validateApiKey } from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import { BEARER_PREFIX, ERROR_MESSAGES } from "@/lib/config/constants";
import pool from "@/lib/database/db";
import { generateScanSummary } from "@/lib/ai/scan-summary";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { checkAiUsageQuota } from "@/lib/billing/ai-usage";
import { scanNumericId } from "@/lib/history/resolve-scan";
import type { ScanResult } from "@/lib/scanner/types";

export const runtime = "nodejs";
// Comfortably above the AI_SUMMARY_CALL_TIMEOUT_MS setting's own 120s ceiling
// (lib/config/registry.ts): this is a single short call (not the chunked,
// multi-call batches verify/route.ts has to budget for), so it never needs
// that route's much larger maxDuration, but it does need to exceed whatever
// an admin actually configures that setting to, not just its 40s default.
export const maxDuration = 150;

/**
 * On-demand scan-level AI summary, analogous to POST /api/v3/scan/verify
 * (per-finding AI verification) but for the whole scan at once. Owner-only,
 * accepts session OR API key auth (scan:write), same dual-auth pattern as
 * scan/verify/route.ts -- this is a real scripted-API-consumer action, not
 * only a UI button, so a CI pipeline or any other API client can generate
 * (and persist) a summary for a scan it owns without a browser session.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: number | null = null;

  const session = await getSession();
  if (session) {
    userId = session.userId;
  } else {
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith(BEARER_PREFIX)) {
      const key = authHeader.slice(BEARER_PREFIX.length);
      const keyResult = await validateApiKey(key);
      if (!keyResult) {
        return NextResponse.json(
          { error: "Invalid API key." },
          { status: 401 },
        );
      }
      // scoping: generating (and persisting) an AI summary onto a scan is
      // part of the active scanning workflow, same reasoning scan/verify's
      // and verify-batch's own scan:write requirement documents.
      if (!hasApiKeyScope(keyResult.scopes, API_KEY_SCOPES.SCAN_WRITE)) {
        return NextResponse.json(
          { error: apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_WRITE) },
          { status: 403 },
        );
      }
      userId = keyResult.userId;
    } else {
      return NextResponse.json(
        { error: ERROR_MESSAGES.UNAUTHORIZED },
        { status: 401 },
      );
    }
  }

  const { id } = await params;

  // Check the user hasn't disabled AI, same check scan/verify/route.ts makes.
  try {
    const configResult = await pool.query(
      `SELECT ai_disabled FROM user_ai_configs WHERE user_id = $1`,
      [userId],
    );
    if (configResult.rows[0]?.ai_disabled) {
      return NextResponse.json(
        { error: "AI is disabled in your settings." },
        { status: 403 },
      );
    }
  } catch {
    /* no row = AI enabled by default */
  }

  // Resolve by opaque public_id, or a legacy numeric id, still scoped to the
  // caller (an owner-only action): a non-owned or unknown scan returns 404.
  const scanResult = await pool.query(
    `SELECT id, url, scanned_at, duration, findings, summary, response_headers, result_meta, authenticated
     FROM scan_history
     WHERE (public_id = $1 OR ($2::bigint IS NOT NULL AND id = $2)) AND user_id = $3`,
    [id, scanNumericId(id), userId],
  );

  if (scanResult.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const row = scanResult.rows[0];
  // checksRun/dangerScore/engineConfidence/incomplete live in result_meta --
  // see lib/scanner/scan-jobs.ts's finalizeScanSuccess -- and dangerScore in
  // particular is part of what the summary prompt references.
  const meta = row.result_meta || {};

  // Cache short-circuit: a scan whose summary was already generated returns
  // the cached text with no AI call and no rate-limit consumption, unless
  // the caller explicitly asks to regenerate. This is what makes repeatedly
  // opening the summary modal free after the first generation.
  const regenerate = request.nextUrl.searchParams.get("regenerate") === "true";
  if (!regenerate && typeof meta.aiSummary === "string" && meta.aiSummary) {
    return NextResponse.json({
      success: true,
      summary: meta.aiSummary,
      cached: true,
    });
  }

  // Rate limit: only real generate/regenerate calls reach here (a cache hit
  // returns above), so this bounds AI provider cost from a single account
  // without penalizing repeat views of an existing summary.
  const rl = await checkRateLimit({
    key: `ai-summary:${userId}`,
    ...RATE_LIMITS.aiSummary,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Too many AI summary requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      },
      { status: 429 },
    );
  }

  // AI scan summaries are free/unmetered -- not gated on the
  // aiTokensPerWindow cap. Still resolves usingOwnAi (used below to pick
  // which AI provider generateScanSummary calls) and usage is still
  // recorded for admin cost visibility; it just never blocks the request.
  const quota = await checkAiUsageQuota(userId);

  const result: ScanResult = {
    url: row.url,
    scannedAt: row.scanned_at,
    duration: row.duration,
    findings: Array.isArray(row.findings) ? row.findings : [],
    summary: row.summary,
    responseHeaders: row.response_headers || undefined,
    authenticated: row.authenticated || false,
    ...meta,
  };

  const summaryText = await generateScanSummary(
    result,
    userId,
    quota.usingOwnAi,
  );
  if (!summaryText) {
    return NextResponse.json(
      {
        error:
          "Could not generate an AI summary for this scan. Check that an AI endpoint is configured, or try again in a moment.",
      },
      { status: 502 },
    );
  }

  // Merge rather than overwrite: result_meta already carries checksRun/
  // dangerScore/engineConfidence/incomplete from the original scan, and this
  // write must not clobber them.
  await pool.query(
    `UPDATE scan_history
     SET result_meta = COALESCE(result_meta, '{}'::jsonb) || $1::jsonb
     WHERE id = $2 AND user_id = $3`,
    [JSON.stringify({ aiSummary: summaryText }), row.id, userId],
  );

  return NextResponse.json({ success: true, summary: summaryText });
}
