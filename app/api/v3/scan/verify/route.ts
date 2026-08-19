import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { validateApiKey } from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import { BEARER_PREFIX } from "@/lib/config/constants";
import pool from "@/lib/database/db";
import { runAiVerification } from "@/lib/ai/verify-findings";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { checkAiUsageQuota } from "@/lib/billing/ai-usage";
import { scanNumericId } from "@/lib/history/resolve-scan";

export const runtime = "nodejs";
// Must stay above CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS (lib/config/config-values.ts,
// currently 600s) plus the probe timeout plus one more call-timeout's worth
// of overrun (the deadline check runs between chunks, not mid-chunk, so the
// in-flight chunk when it trips still finishes) plus slack -- otherwise the
// platform kills the request before that in-app deadline ever gets a chance
// to fire and persist its own partial results cleanly. Raised from 360s
// alongside CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS going from 300s to 600s.
export const maxDuration = 720;

export async function POST(req: NextRequest) {
  // Accept session auth OR API key auth, same dual-auth pattern as the
  // sibling /api/v3/scan/verify-batch (which never persists) -- this route
  // is the one that also writes the enriched findings back onto the scan,
  // so a CI pipeline or any other scripted API consumer can now trigger AI
  // verification of its own scan and have the result actually stick, not
  // just get it back in this one response.
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
      // scoping: persisting AI verdicts onto a scan is part of the active
      // scanning workflow, same reasoning verify-batch's own scan:write
      // requirement documents.
      if (!hasApiKeyScope(keyResult.scopes, API_KEY_SCOPES.SCAN_WRITE)) {
        return NextResponse.json(
          { error: apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_WRITE) },
          { status: 403 },
        );
      }
      userId = keyResult.userId;
    } else {
      return NextResponse.json(
        { error: "Sign in or use an API key to use AI verification." },
        { status: 401 },
      );
    }
  }

  // Rate limit: bounds AI provider cost from a single account. Shared with
  // /api/v3/scan/verify-batch (same key prefix, same named limit) since both
  // routes run the same per-finding AI verification pipeline -- see
  // RATE_LIMITS.aiVerify's doc comment in lib/rate-limiting/rate-limit.ts.
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

  let body: { scanHistoryId: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  // Accepts the opaque public_id (a string) or a legacy numeric id -- the
  // scan lookup below resolves either shape.
  const { scanHistoryId } = body;
  if (
    scanHistoryId === undefined ||
    scanHistoryId === null ||
    (typeof scanHistoryId !== "number" && typeof scanHistoryId !== "string") ||
    String(scanHistoryId).trim() === ""
  ) {
    return NextResponse.json(
      { error: "scanHistoryId is required." },
      { status: 400 },
    );
  }
  const scanIdParam = String(scanHistoryId);

  // Check user hasn't disabled AI
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

  // Fetch the scan — must belong to this user. Resolves the opaque public_id
  // or a legacy numeric id, still scoped to the caller.
  const scanResult = await pool.query(
    `SELECT id, url, findings FROM scan_history
     WHERE (public_id = $1 OR ($2::bigint IS NOT NULL AND id = $2)) AND user_id = $3`,
    [scanIdParam, scanNumericId(scanIdParam), userId],
  );

  if (scanResult.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const { id: scanId, url, findings } = scanResult.rows[0];
  const parsedFindings = Array.isArray(findings) ? findings : [];

  // Pre-call gate: bounds VulnRadar's own AI cost per plan tier. Bypassed
  // entirely for a user with their own AI key configured (quota.usingOwnAi),
  // same as GitHub repo AI code review's identical gate.
  const quota = await checkAiUsageQuota(userId);
  if (!quota.allowed) {
    return NextResponse.json({ error: quota.message }, { status: 429 });
  }

  await runAiVerification(
    url as string,
    parsedFindings,
    scanId,
    userId,
    quota.usingOwnAi,
  );

  // Return the updated findings
  const updated = await pool.query(
    `SELECT findings FROM scan_history WHERE id = $1`,
    [scanId],
  );

  return NextResponse.json({
    success: true,
    findings: updated.rows[0]?.findings ?? parsedFindings,
  });
}
