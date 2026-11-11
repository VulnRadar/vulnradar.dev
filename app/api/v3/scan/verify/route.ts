import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseBearer } from "@/lib/api/bearer";
import { authenticateApiKey } from "@/lib/api/api-key-auth";
import { API_KEY_SCOPES } from "@/lib/api/api-key-scopes";
import { readJsonObject, withErrorHandling } from "@/lib/api/api-utils";
import { burstLimitedResponse } from "@/lib/api/rate-limit-response";
import { versioned } from "@/lib/api/v4/wrap";
import pool from "@/lib/database/db";
import {
  estimateVerifyTokens,
  runAiVerification,
} from "@/lib/ai/verify-findings";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { reserveAiTokens } from "@/lib/billing/ai-usage";
import { scanNumericId } from "@/lib/history/resolve-scan";

export const runtime = "nodejs";
// Must stay above CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS (lib/config/config-values.ts)
// plus the probe timeout plus one more call-timeout's worth of overrun (the
// deadline check runs between chunks, not mid-chunk, so the in-flight chunk
// when it trips still finishes) plus slack -- otherwise the platform kills the
// request before that in-app deadline ever gets a chance to fire and persist
// its own partial results cleanly.
export const maxDuration = 1140;

export const POST = versioned(
  "scan.verify",
  withErrorHandling(async (req: NextRequest) => {
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
    } else if (parseBearer(req.headers.get("Authorization")) !== null) {
      // scoping: persisting AI verdicts onto a scan is part of the active
      // scanning workflow, same reasoning verify-batch's own scan:write
      // requirement documents. The Terms check is new here and holds on every
      // version: a gate one version lacks is a way around it.
      const key = await authenticateApiKey(req, {
        scope: API_KEY_SCOPES.SCAN_WRITE,
      });
      if (!key.ok) return key.response;
      userId = key.auth.userId;
    } else {
      return NextResponse.json(
        { error: "Sign in or use an API key to use AI verification." },
        { status: 401 },
      );
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
      return burstLimitedResponse(
        rl,
        `Too many AI verification requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      );
    }

    const parsed = await readJsonObject(req);
    if (!parsed.ok) return parsed.response;

    const scanIdParam = scanIdOf(parsed.data);
    if (scanIdParam === null) {
      return NextResponse.json(
        {
          error:
            "scanId is required: the scan's public id or its numeric id (scanHistoryId is accepted as the same field).",
        },
        { status: 400 },
      );
    }

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

    // Pre-call gate: bounds VulnRadar's own AI cost per plan tier. Reserves the
    // pass's worst case out of the window and the credit balance before any
    // provider call, rather than letting it in on any positive balance and
    // charging afterwards; runAiVerification holds the pass to what was
    // reserved and settles it with the real count. The minimum is one
    // finding, so a scan larger than the allowance is verified as far as it
    // goes instead of refused. A user with their own AI key is let straight
    // through and nothing is charged.
    const { estimate, minimum } = await estimateVerifyTokens(parsedFindings);
    const gate = await reserveAiTokens(userId, estimate, minimum);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.message }, { status: 429 });
    }

    const outcome = await runAiVerification(
      url as string,
      parsedFindings,
      scanId,
      userId,
      gate.reservation,
    );

    // Return the updated findings
    const updated = await pool.query(
      `SELECT findings FROM scan_history WHERE id = $1`,
      [scanId],
    );

    // `ai` says whether the pass actually happened. Without it this response
    // was `success: true` whether the model judged every finding, or no
    // endpoint was configured, or the provider failed on every chunk, and the
    // browser drew the same green "AI didn't confirm any findings" card for all
    // three. A verification that did not run must not read like one that ran
    // and cleared everything.
    return NextResponse.json({
      success: true,
      findings: updated.rows[0]?.findings ?? parsedFindings,
      ai: outcome,
    });
  }),
);

/**
 * The scan named by the body, as text: the public id or the numeric id, under
 * `scanId` (the v4 name) or `scanHistoryId` (what every v3 client sends, and
 * the one that wins when a body carries both). Null when neither is usable.
 */
function scanIdOf(body: Record<string, unknown>): string | null {
  const raw = body.scanHistoryId ?? body.scanId;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const text = String(raw).trim();
  return text === "" ? null : text;
}
