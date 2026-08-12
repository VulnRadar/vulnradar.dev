import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { generateScanSummary } from "@/lib/ai/scan-summary";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { checkAiUsageQuota } from "@/lib/billing/ai-usage";
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
 * session auth only -- no API key path, matching scan/verify/route.ts's
 * simpler auth rather than the full API-key dance the other history/[id]
 * routes support, since this is an AI action a human triggers from the UI,
 * not something scripted API consumers are expected to call.
 *
 * Caches its result: once a scan already has result_meta.aiSummary, a plain
 * call returns that cached text instead of calling the AI provider again --
 * pressing the (now labeled "Regenerate") button repeatedly would otherwise
 * re-call the provider on every click even though nothing about the scan
 * changed. Pass ?regenerate=true to force a fresh call and overwrite the
 * cached summary; components/scanner/scan-actions-menu.tsx does this
 * whenever it already has a summary to show (i.e. whenever its own label
 * reads "Regenerate" rather than "Generate").
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  const { id } = await params;
  const scanId = Number(id);
  if (!Number.isInteger(scanId)) {
    return NextResponse.json({ error: "Invalid scan id." }, { status: 400 });
  }

  // Check the user hasn't disabled AI, same check scan/verify/route.ts makes.
  try {
    const configResult = await pool.query(
      `SELECT ai_disabled FROM user_ai_configs WHERE user_id = $1`,
      [session.userId],
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

  const scanResult = await pool.query(
    `SELECT url, scanned_at, duration, findings, summary, response_headers, result_meta, authenticated
     FROM scan_history WHERE id = $1 AND user_id = $2`,
    [scanId, session.userId],
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
    key: `ai-summary:${session.userId}`,
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
  const quota = await checkAiUsageQuota(session.userId);

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
    session.userId,
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
    [JSON.stringify({ aiSummary: summaryText }), scanId, session.userId],
  );

  return NextResponse.json({ success: true, summary: summaryText });
}
