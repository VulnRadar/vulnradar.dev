import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { runAiVerification } from "@/lib/ai/verify-findings";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { checkAiUsageQuota } from "@/lib/billing/ai-usage";

export const runtime = "nodejs";
// Must stay above CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS (lib/config/config-values.ts,
// currently 300s) plus the probe timeout plus one more call-timeout's worth
// of overrun (the deadline check runs between chunks, not mid-chunk, so the
// in-flight chunk when it trips still finishes) plus slack -- otherwise the
// platform kills the request before that in-app deadline ever gets a chance
// to fire and persist its own partial results cleanly. Previously 60s,
// which was already shorter than the 90s app-level budget it was supposed
// to bound.
export const maxDuration = 360;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Sign in to use AI verification." },
      { status: 401 },
    );
  }

  // Rate limit: bounds AI provider cost from a single account. Shared with
  // /api/v3/scan/verify-batch (same key prefix, same named limit) since both
  // routes run the same per-finding AI verification pipeline -- see
  // RATE_LIMITS.aiVerify's doc comment in lib/rate-limiting/rate-limit.ts.
  const rl = await checkRateLimit({
    key: `ai-verify:${session.userId}`,
    ...RATE_LIMITS.aiVerify,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Too many AI verification requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      },
      { status: 429 },
    );
  }

  let body: { scanHistoryId: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const { scanHistoryId } = body;
  if (!scanHistoryId || typeof scanHistoryId !== "number") {
    return NextResponse.json(
      { error: "scanHistoryId is required." },
      { status: 400 },
    );
  }

  // Check user hasn't disabled AI
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

  // Fetch the scan — must belong to this user
  const scanResult = await pool.query(
    `SELECT url, findings FROM scan_history WHERE id = $1 AND user_id = $2`,
    [scanHistoryId, session.userId],
  );

  if (scanResult.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const { url, findings } = scanResult.rows[0];
  const parsedFindings = Array.isArray(findings) ? findings : [];

  // Pre-call gate: bounds VulnRadar's own AI cost per plan tier. Bypassed
  // entirely for a user with their own AI key configured (quota.usingOwnAi),
  // same as GitHub repo AI code review's identical gate.
  const quota = await checkAiUsageQuota(session.userId);
  if (!quota.allowed) {
    return NextResponse.json({ error: quota.message }, { status: 429 });
  }

  await runAiVerification(
    url as string,
    parsedFindings,
    scanHistoryId,
    session.userId,
    quota.usingOwnAi,
  );

  // Return the updated findings
  const updated = await pool.query(
    `SELECT findings FROM scan_history WHERE id = $1`,
    [scanHistoryId],
  );

  return NextResponse.json({
    success: true,
    findings: updated.rows[0]?.findings ?? parsedFindings,
  });
}
