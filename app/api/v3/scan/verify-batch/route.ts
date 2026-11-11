import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseBearer } from "@/lib/api/bearer";
import { authenticateApiKey } from "@/lib/api/api-key-auth";
import { API_KEY_SCOPES } from "@/lib/api/api-key-scopes";
import { readJsonObject, withErrorHandling } from "@/lib/api/api-utils";
import { burstLimitedResponse } from "@/lib/api/rate-limit-response";
import { versioned } from "@/lib/api/v4/wrap";
import {
  estimateVerifyTokens,
  isAskableFinding,
  verifyFindingsBatchWithOutcome,
} from "@/lib/ai/verify-findings";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { reserveAiTokens } from "@/lib/billing/ai-usage";
import { getSettings } from "@/lib/config/runtime-config";
import { isAiDisabledForUser } from "@/lib/ai/user-ai-config";
import { checkAccessRules } from "@/lib/scanner/access-rules";
import type { Vulnerability } from "@/lib/scanner/types";

export const runtime = "nodejs";
// See app/api/v3/scan/verify/route.ts for why this must stay above
// CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS -- verifyFindingsBatchWithOutcome shares
// the same deadline/chunk settings as runAiVerification.
export const maxDuration = 1140;

const ALLOWANCE_RAN_OUT_MESSAGE =
  "Your AI allowance ran out before any finding on this page could be verified. Upgrade your plan, wait for the window to reset, connect your own AI provider key in Profile > AI settings, or buy AI credits in Profile > Billing.";

export const POST = versioned(
  "scan.verifyBatch",
  withErrorHandling(async (req: NextRequest) => {
    // Accept session auth OR API key auth
    let userId: number | null = null;

    const session = await getSession();
    if (session) {
      userId = session.userId;
    } else if (parseBearer(req.headers.get("Authorization")) !== null) {
      // scoping: AI-verifying a batch of findings is part of the active
      // scanning workflow (enriching results from a scan the key just ran),
      // so it requires scan:write like the scan-triggering endpoints it
      // supports. The Terms check is new here and holds on every version, as
      // on /scan/verify.
      const key = await authenticateApiKey(req, {
        scope: API_KEY_SCOPES.SCAN_WRITE,
      });
      if (!key.ok) return key.response;
      userId = key.auth.userId;
    } else {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
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
      return burstLimitedResponse(
        rl,
        `Too many AI verification requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      );
    }

    // Check user hasn't disabled AI -- same gate app/api/v3/scan/verify/route.ts
    // applies. Kept consistent since this route runs the identical per-finding
    // AI verification pipeline (lib/ai/verify-findings.ts) against a
    // caller-supplied findings array instead of one read from scan_history.
    // A failed read throws to withErrorHandling's 500 rather than reading as
    // "AI on": see isAiDisabledForUser.
    if (await isAiDisabledForUser(userId)) {
      return NextResponse.json(
        { error: "AI is disabled in your settings." },
        { status: 403 },
      );
    }

    const parsed = await readJsonObject(req);
    if (!parsed.ok) return parsed.response;

    const { url, findings } = parsed.data as {
      url: string;
      findings: Vulnerability[];
    };
    if (!url || !Array.isArray(findings)) {
      return NextResponse.json(
        { error: "url and findings[] are required." },
        { status: 400 },
      );
    }
    // The url reaches the probe as it is. One that was only truthy got coerced
    // into a probe of "https://123" or "https://[object Object]".
    if (!isWebTarget(url)) {
      return NextResponse.json(
        { error: "url must be an http or https address." },
        { status: 400 },
      );
    }

    // security: the pass probes the target with a real request, so the admin
    // blocklist and a domain owner's "block scanning" stop it as they stop a
    // scan, with the same answer. The URL is checked in the form the probe
    // will fetch, since a bare host is accepted. checkAccessRules fails
    // closed on its own database error.
    const access = await checkAccessRules(asProbeUrl(url));
    if (!access.allowed) {
      return NextResponse.json(
        {
          error: "This target cannot be scanned.",
          details:
            "This domain or IP address has been restricted from scanning for security, privacy, or compliance reasons. Access controls are enforced to protect sensitive infrastructure and user data. If you believe this is an error, please contact support.",
          statusCode: "BLOCKED",
        },
        { status: 403 },
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
    // No element is refused on v3. A null one, and one the prompt builder cannot
    // turn into text, come back as sent and unverified, as 3.9.1 handed them
    // back (see isAskableFinding). When that is all there is, there is nothing
    // to ask about, so nothing is reserved and the target is not probed. Going
    // through the gate could answer 429 for a request that would not have
    // spent a token.
    if (!findings.some(isAskableFinding)) {
      return NextResponse.json({
        findings,
        ai: { configured: true, verdicts: 0, attempted: 0 },
      });
    }

    // Pre-call gate: reserves the batch's worst case before any provider call,
    // and the pass is held to it and settles it. See
    // app/api/v3/scan/verify/route.ts, which gates the same way.
    const { estimate, minimum } = await estimateVerifyTokens(findings);
    const gate = await reserveAiTokens(userId, estimate, minimum);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.message }, { status: 429 });
    }

    const { findings: enriched, outcome } =
      await verifyFindingsBatchWithOutcome(
        url,
        findings,
        userId,
        gate.reservation,
      );

    // The gate admits a pass on its first finding priced against an empty
    // page, and the probe can make that finding cost more than the account
    // has. A pass the allowance stopped before anything was verified answers
    // the way 3.9.1 answered an account out of allowance: a 429 whose body is
    // the error alone, with no Retry-After, as 3.9.1 sent none. The pass has
    // settled the reservation by now, so nothing stays held.
    if (outcome.budgetExhausted && outcome.verdicts === 0) {
      return NextResponse.json(
        { error: ALLOWANCE_RAN_OUT_MESSAGE },
        { status: 429 },
      );
    }

    // `ai` is additive and has the shape POST /scan/verify returns. It is how
    // a caller tells a pass the allowance stopped partway (budgetExhausted,
    // with verdicts against attempted) from one that judged everything.
    return NextResponse.json({ findings: enriched, ai: outcome });
  }),
);

// The probe prefixes https:// to a bare host, so a bare host stays accepted
// and only what cannot become a web address is refused.
function asProbeUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function isWebTarget(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(asProbeUrl(value));
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
