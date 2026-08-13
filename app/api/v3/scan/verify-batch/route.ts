import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { validateApiKey } from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import { BEARER_PREFIX } from "@/lib/config/constants";
import { verifyFindingsBatch } from "@/lib/ai/verify-findings";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { checkAiUsageQuota } from "@/lib/billing/ai-usage";
import { getSettings } from "@/lib/config/runtime-config";
import pool from "@/lib/database/db";
import type { Vulnerability } from "@/lib/scanner/types";

export const runtime = "nodejs";
// See app/api/v3/scan/verify/route.ts for why this must stay above
// CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS -- verifyFindingsBatch shares the same
// deadline/chunk settings as runAiVerification.
export const maxDuration = 720;

export async function POST(req: NextRequest) {
  // Accept session auth OR API key auth
  let userId: number | null = null;

  const session = await getSession();
  if (session) {
    userId = session.userId;
  } else {
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith(BEARER_PREFIX)) {
      const key = authHeader.slice(BEARER_PREFIX.length);
      const keyResult = await validateApiKey(key);
      if (!keyResult) {
        return NextResponse.json(
          { error: "Invalid API key." },
          { status: 401 },
        );
      }
      // scoping: AI-verifying a batch of findings is part of the active
      // scanning workflow (enriching results from a scan the key just ran),
      // so it requires scan:write like the scan-triggering endpoints it
      // supports.
      if (!hasApiKeyScope(keyResult.scopes, API_KEY_SCOPES.SCAN_WRITE)) {
        return NextResponse.json(
          { error: apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_WRITE) },
          { status: 403 },
        );
      }
      userId = keyResult.userId;
    } else {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    }
  }

  // Rate limit: shares RATE_LIMITS.aiVerify's bucket with
  // /api/v3/scan/verify (same key prefix, keyed per-user) so a caller can't
  // double their effective AI-verification quota by hitting both routes.
  // This applies to session AND API-key callers alike, matching
  // verify/route.ts's per-account gate -- verify-batch was previously
  // reachable by any API key on any plan with no gate at all.
  const rl = await checkRateLimit({
    key: `ai-verify:${userId}`,
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

  // Check user hasn't disabled AI -- same gate app/api/v3/scan/verify/route.ts
  // applies. Kept consistent since this route runs the identical per-finding
  // AI verification pipeline (lib/ai/verify-findings.ts) against a
  // caller-supplied findings array instead of one read from scan_history.
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

  let body: { url: string; findings: Vulnerability[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const { url, findings } = body;
  if (!url || !Array.isArray(findings)) {
    return NextResponse.json(
      { error: "url and findings[] are required." },
      { status: 400 },
    );
  }

  // Hard cap on findings[]: unlike verify/route.ts (which only ever
  // processes findings already stored on one of the caller's own scans),
  // this route takes an arbitrary caller-supplied array. Without a cap, any
  // authenticated caller -- including a free-tier API key -- could force
  // unbounded AI spend in a single request.
  const { AI_VERIFY_BATCH_MAX_FINDINGS } = await getSettings([
    "AI_VERIFY_BATCH_MAX_FINDINGS",
  ] as const);
  if (findings.length > AI_VERIFY_BATCH_MAX_FINDINGS) {
    return NextResponse.json(
      {
        error: `Too many findings: this endpoint accepts at most ${AI_VERIFY_BATCH_MAX_FINDINGS} findings per request.`,
      },
      { status: 400 },
    );
  }

  // Pre-call gate: bounds VulnRadar's own AI cost per plan tier. Bypassed
  // entirely for a user with their own AI key configured (quota.usingOwnAi),
  // same as GitHub repo AI code review's identical gate.
  const quota = await checkAiUsageQuota(userId);
  if (!quota.allowed) {
    return NextResponse.json({ error: quota.message }, { status: 429 });
  }

  const enriched = await verifyFindingsBatch(
    url,
    findings,
    userId,
    quota.usingOwnAi,
  );

  return NextResponse.json({ findings: enriched });
}
