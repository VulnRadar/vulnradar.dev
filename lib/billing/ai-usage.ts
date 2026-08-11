import pool from "@/lib/database/db";
import { hasOwnAiConfig } from "@/lib/billing/github-review-usage";
import { getUserPlanLimits } from "@/lib/billing/plan-limits";
import { getSetting } from "@/lib/config/runtime-config";

/**
 * Unified, fixed-window AI token usage tracking for the aiTokensPerWindow
 * plan limit -- shared across AI chat (app/api/v3/ai/chat), AI finding
 * verification (lib/ai/verify-findings.ts), and AI scan summaries
 * (lib/ai/scan-summary.ts). GitHub repo AI code review
 * (lib/billing/github-review-usage.ts, the githubReviewTokensPerWindow
 * plan limit) resets on this exact same window: it imports
 * currentWindowStart()/resolveCurrentWindow() directly from here rather
 * than duplicating the bucketing math, and reads the same
 * AI_USAGE_WINDOW_HOURS setting instead of keeping an independent
 * window-length setting of its own. Its table (github_review_usage) stays
 * separate from ai_usage below purely because the two features have very
 * different per-call sizes (a whole repo vs. one small chat/verify/
 * summary call), not because they run on different cadences anymore.
 *
 * hasOwnAiConfig is reused directly from github-review-usage.ts rather
 * than duplicated or relocated: despite the file name, it isn't
 * GitHub-specific -- it just answers "does this user have their own AI
 * provider configured" via lib/ai/verify-findings.ts's
 * resolveUserEndpoint, the same DB row every AI feature in this app
 * resolves its endpoint through. (This does mean ai-usage.ts and
 * github-review-usage.ts import from each other -- safe here because
 * every cross-import is a hoisted function declaration only ever called
 * from inside another function body, never at module-evaluation time.)
 */

/** Fallback window length (hours) for currentWindowStart's default parameter, matching CONFIG_AI_USAGE_WINDOW_HOURS's shipped default. */
const DEFAULT_WINDOW_HOURS = 5;

/**
 * Start (UTC) of the fixed window `date` falls into, for a window of
 * `windowHours` length. FIXED buckets, not a rolling window: every call in
 * the same `windowHours`-long slice since the Unix epoch (00:00:00 UTC,
 * 1 Jan 1970) shares one counter, and the boundary advances in a strict,
 * predictable step -- never sliding forward with each request the way a
 * rolling window would. Anchored to the epoch, not the local calendar day:
 * for a window length that evenly divides 24 (1, 2, 3, 4, 6, 8, 12, 24)
 * this happens to land on the same clock time every day (e.g. a 6-hour
 * window always resets at 00:00/06:00/12:00/18:00 UTC), but the shipped
 * default of 5 hours does NOT evenly divide a day, so its boundary drifts
 * across clock times day to day rather than lining up with local midnight
 * -- still exactly one fixed, deterministic bucket per call, just not one
 * that resets at the same wall-clock time every day. Pure and synchronous
 * (windowHours is a plain parameter, not read from settings here) so it's
 * trivially testable; the async functions below resolve the
 * admin-configured AI_USAGE_WINDOW_HOURS setting and pass it in.
 */
export function currentWindowStart(
  date: Date = new Date(),
  windowHours: number = DEFAULT_WINDOW_HOURS,
): Date {
  const windowMs = Math.max(1, windowHours) * 60 * 60 * 1000;
  const bucketStartMs = Math.floor(date.getTime() / windowMs) * windowMs;
  return new Date(bucketStartMs);
}

/**
 * Resolves the admin-configured window length and the current bucket's
 * start together. Exported so lib/billing/github-review-usage.ts's
 * checkGithubReviewQuota/recordGithubReviewTokens can resolve their window
 * the exact same way instead of duplicating this pairing.
 */
export async function resolveCurrentWindow(
  date: Date = new Date(),
): Promise<{ windowStart: Date; windowHours: number }> {
  const windowHours = await getSetting("AI_USAGE_WINDOW_HOURS");
  return { windowStart: currentWindowStart(date, windowHours), windowHours };
}

/** Real (not estimated) tokens spent so far in the given window. */
export async function getAiTokensUsed(
  userId: number,
  windowStart: Date,
): Promise<number> {
  const result = await pool.query<{ tokens_used: number }>(
    "SELECT tokens_used FROM ai_usage WHERE user_id = $1 AND window_start = $2",
    [userId, windowStart],
  );
  return result.rows[0]?.tokens_used ?? 0;
}

/**
 * Purchased AI verification token balance (users.ai_credit_balance) -- a
 * one-time top-up bought via app/actions/stripe.ts's
 * createAiCreditPaymentIntent and credited by creditAiCreditPurchase below
 * (called from confirmAiCreditPurchase and the webhook's
 * payment_intent.succeeded handler). Unlike the window counter above, this
 * is NEVER reset by the window: it only goes up (a purchase) or down (a
 * recordAiTokens spend past the free allowance, see below).
 */
export async function getAiCreditBalance(userId: number): Promise<number> {
  const result = await pool.query<{ ai_credit_balance: number }>(
    "SELECT ai_credit_balance FROM users WHERE id = $1",
    [userId],
  );
  return result.rows[0]?.ai_credit_balance ?? 0;
}

/**
 * Adds to the user's AI token balance. A plain, non-idempotent `+` --
 * calling this twice for the same purchase double-credits the user. Callers
 * crediting a Stripe purchase must go through creditAiCreditPurchase below
 * instead of calling this directly; it exists as its own exported function
 * only because a handful of non-purchase paths (admin grants, etc.) add to
 * the balance without a PaymentIntent behind them.
 */
export async function addAiCreditBalance(
  userId: number,
  tokens: number,
): Promise<void> {
  if (tokens <= 0) return;
  await pool.query(
    `UPDATE users SET ai_credit_balance = ai_credit_balance + $2 WHERE id = $1`,
    [userId, tokens],
  );
}

/**
 * Idempotently applies ONE successful AI credit PaymentIntent to a user's
 * balance. Two independent code paths can each try to credit the exact same
 * successful payment: confirmAiCreditPurchase (app/actions/stripe.ts, the
 * fast path called the instant the client confirms payment on
 * app/checkout/credits/page.tsx) and the Stripe webhook's
 * payment_intent.succeeded handler (app/api/v3/webhooks/stripe/route.ts,
 * the backup path for a closed tab / lost connection -- the same redundancy
 * reasoning customer.subscription.created gives the subscription flow).
 *
 * Unlike a subscription's plan UPDATE (idempotent -- the same write twice
 * produces the same result), addAiCreditBalance is a running `+`, so both
 * paths reaching it for the same purchase would double-credit the user.
 * processed_stripe_events only dedupes a REPEATED DELIVERY of the same
 * webhook event -- it does nothing to stop these two DIFFERENT code paths
 * from each crediting once.
 *
 * The real guard is the ai_credit_purchases table (payment_intent_id
 * PRIMARY KEY, see scripts/migrate/versions/2.0.0-to-3.0.0.mjs): the
 * INSERT ... ON CONFLICT DO NOTHING below succeeds for only the first
 * caller to reach it for a given PaymentIntent id, and addAiCreditBalance
 * only runs when that insert actually happened (rowCount > 0). Whichever of
 * the two callers gets there first does the real crediting; the other sees
 * rowCount === 0 and reports credited: false without touching the balance.
 */
export async function creditAiCreditPurchase(
  paymentIntentId: string,
  userId: number,
  tokens: number,
): Promise<{ credited: boolean }> {
  if (tokens <= 0) return { credited: false };
  const result = await pool.query(
    `INSERT INTO ai_credit_purchases (payment_intent_id, user_id, tokens)
     VALUES ($1, $2, $3)
     ON CONFLICT (payment_intent_id) DO NOTHING
     RETURNING payment_intent_id`,
    [paymentIntentId, userId, tokens],
  );
  if ((result.rowCount ?? 0) === 0) return { credited: false };
  await addAiCreditBalance(userId, tokens);
  return { credited: true };
}

/**
 * Adds `tokens` (the REAL usage the AI provider reported, or a
 * character-length estimate when real usage wasn't available -- see the
 * doc comments in app/api/v3/ai/chat/route.ts) to the user's counter for
 * the given window. Called after each AI call completes, not before.
 * Defaults `windowStart` to the current window under the currently
 * configured AI_USAGE_WINDOW_HOURS when the caller doesn't already have
 * one in hand.
 *
 * Spend order: the plan's free aiTokensPerWindow allowance is always
 * consumed first (it costs the buyer nothing), and only the portion of
 * THIS call's tokens that lands above that ceiling is charged against the
 * purchased credit balance (see getAiCreditBalance/addAiCreditBalance
 * above). The window UPSERT below is a single atomic statement that
 * RETURNs the window's new total, so the split is computed from that exact
 * pre/post delta (`newTotal - tokens` = the total right before this call)
 * rather than a separate read that could race with a concurrent call
 * recording into the same window at the same time -- two verification
 * calls landing at once can never double-spend the same slice of credits.
 * The credit-balance UPDATE itself is also a single atomic statement
 * (GREATEST floor at 0), so a concurrent spend can never drive the balance
 * negative either. A plan with no ceiling (aiTokensPerWindow === -1) or
 * billing disabled entirely (getUserPlanLimits returns null, resolved here
 * as -1) never touches credits -- there's no ceiling for anything to spill
 * over from.
 */
export async function recordAiTokens(
  userId: number,
  tokens: number,
  windowStart?: Date,
): Promise<void> {
  if (tokens <= 0) return;
  const start = windowStart ?? (await resolveCurrentWindow()).windowStart;

  const result = await pool.query<{ tokens_used: number }>(
    `INSERT INTO ai_usage (user_id, window_start, tokens_used, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, window_start)
     DO UPDATE SET tokens_used = ai_usage.tokens_used + $3, updated_at = NOW()
     RETURNING tokens_used`,
    [userId, start, tokens],
  );
  const newTotal = result.rows[0]?.tokens_used ?? tokens;

  const limits = await getUserPlanLimits(userId);
  const limitTokens = limits?.aiTokensPerWindow ?? -1;
  if (limitTokens === -1) return;

  const previousTotal = newTotal - tokens;
  const windowPortion = Math.max(
    0,
    Math.min(tokens, limitTokens - previousTotal),
  );
  const creditPortion = tokens - windowPortion;
  if (creditPortion > 0) {
    await pool.query(
      `UPDATE users SET ai_credit_balance = GREATEST(ai_credit_balance - $2, 0) WHERE id = $1`,
      [userId, creditPortion],
    );
  }
}

export interface AiUsageQuotaCheck {
  allowed: boolean;
  /** True when the user brings their own AI key — the cap never applies in this case. */
  usingOwnAi: boolean;
  usedTokens: number;
  /** -1 means unlimited (billing disabled); otherwise the plan's per-window cap (a staff caller resolves to the Pro Supporter cap, see getUserPlanLimits). */
  limitTokens: number;
  /** Start of the window this check evaluated against. */
  windowStart: Date;
  /** The admin-configured window length, in hours, this check evaluated against. */
  windowHours: number;
  /** Present only when allowed is false. */
  message?: string;
  /** Purchased AI verification token balance (see getAiCreditBalance) --
   *  resolved on every branch (even the own-AI bypass and unlimited paths)
   *  so callers like Profile > Billing can always show it accurately,
   *  regardless of whether this particular check needed it to allow the
   *  request. */
  creditBalance: number;
}

/**
 * Pre-call quota check: called before an AI chat message, AI finding
 * verification batch, or AI scan summary is allowed to run. Bypasses
 * entirely for a user with their own AI key configured (those calls cost
 * VulnRadar nothing). Otherwise compares the current window's REAL usage
 * so far against the plan's aiTokensPerWindow cap.
 *
 * Fails safe, not fail-open, on the "is this even gated" question: only a
 * genuinely disabled billing system is unlimited (matching every other
 * plan-limit check in this codebase); a staff caller is evaluated against
 * the Pro Supporter cap like a real account (see getUserPlanLimits), and
 * any other path enforces the cap normally -- unlike checkGithubReviewQuota,
 * this does not treat every reason getUserPlanLimits might be unavailable
 * as "unlimited"; only its own documented null-means-billing-off contract
 * does.
 *
 * Purchased AI credits (users.ai_credit_balance) are a fallback, never a
 * substitute: a request that the free per-window allowance alone would
 * deny is still allowed here when the account has a positive credit
 * balance, but a request the free allowance already covers never touches
 * credits at all. This is a per-call, not per-token, decision (matching
 * this check's existing per-call granularity for the free allowance) --
 * the exact split of a single call's tokens between the two pools is
 * resolved after the call completes, in recordAiTokens.
 */
export async function checkAiUsageQuota(
  userId: number,
): Promise<AiUsageQuotaCheck> {
  const usingOwnAi = await hasOwnAiConfig(userId);
  const creditBalance = await getAiCreditBalance(userId);

  if (usingOwnAi) {
    const { windowStart, windowHours } = await resolveCurrentWindow();
    return {
      allowed: true,
      usingOwnAi: true,
      usedTokens: 0,
      limitTokens: -1,
      windowStart,
      windowHours,
      creditBalance,
    };
  }

  const { windowStart, windowHours } = await resolveCurrentWindow();
  const limits = await getUserPlanLimits(userId);
  // null means billing is disabled: unlimited. (A staff caller now
  // resolves to the Pro Supporter plan's real limits, not null.)
  if (limits === null) {
    return {
      allowed: true,
      usingOwnAi: false,
      usedTokens: 0,
      limitTokens: -1,
      windowStart,
      windowHours,
      creditBalance,
    };
  }

  const limitTokens = limits.aiTokensPerWindow;
  const usedTokens = await getAiTokensUsed(userId, windowStart);

  if (limitTokens === 0) {
    if (creditBalance > 0) {
      return {
        allowed: true,
        usingOwnAi: false,
        usedTokens,
        limitTokens,
        windowStart,
        windowHours,
        creditBalance,
      };
    }
    return {
      allowed: false,
      usingOwnAi: false,
      usedTokens,
      limitTokens,
      windowStart,
      windowHours,
      creditBalance,
      message:
        "AI features are not available on your plan. Upgrade to use this, connect your own AI provider key in Profile > AI settings, or buy AI credits in Profile > Billing.",
    };
  }

  if (limitTokens !== -1 && usedTokens >= limitTokens) {
    if (creditBalance > 0) {
      return {
        allowed: true,
        usingOwnAi: false,
        usedTokens,
        limitTokens,
        windowStart,
        windowHours,
        creditBalance,
      };
    }
    return {
      allowed: false,
      usingOwnAi: false,
      usedTokens,
      limitTokens,
      windowStart,
      windowHours,
      creditBalance,
      message: `You've used ${usedTokens.toLocaleString()} of your ${limitTokens.toLocaleString()} AI tokens for this ${windowHours}-hour window. Upgrade your plan, wait for the window to reset, connect your own AI provider key in Profile > AI settings, or buy AI credits in Profile > Billing to bypass this cap.`,
    };
  }

  return {
    allowed: true,
    usingOwnAi: false,
    usedTokens,
    limitTokens,
    windowStart,
    windowHours,
    creditBalance,
  };
}
