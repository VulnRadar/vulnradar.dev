import pool from "@/lib/database/db";
import { getSetting } from "@/lib/config/runtime-config";
import { resolveUserEndpoint } from "@/lib/ai/verify-findings";
import { getUserPlanLimits } from "@/lib/billing/plan-limits";
import { resolveCurrentWindow } from "@/lib/billing/ai-usage";

/**
 * Fixed-window AI token usage tracking for GitHub repo AI code review
 * (githubReviewTokensPerWindow plan limit). Tracks real tokens, not a run
 * count — see the doc comment on PlanLimits.githubReviewTokensPerWindow in
 * lib/billing/catalog.ts for why.
 *
 * Resets on the exact same fixed window as lib/billing/ai-usage.ts's AI
 * chat/finding-verification/scan-summary tracking: resolveCurrentWindow is
 * imported directly from there rather than duplicated, so this can never
 * drift onto a second, independent window-length setting. Used to be a
 * calendar-month counter (currentYearMonth, year_month column) instead —
 * that cadence was replaced with this shared window, matching every other
 * AI usage limit in the app.
 */

/**
 * True when the user has configured their own AI provider (a `use_vulnradar_ai
 * = false` row in user_ai_configs with a complete provider/model/key/baseUrl).
 * Reuses lib/ai/verify-findings.ts's resolveUserEndpoint so "does this user
 * have their own AI configured" can never drift from "which endpoint would
 * an AI call actually use" — the same DB row answers both questions.
 */
export async function hasOwnAiConfig(userId: number): Promise<boolean> {
  const endpoint = await resolveUserEndpoint(userId);
  return endpoint !== null;
}

/** Real (not estimated) tokens spent so far in the given window. */
export async function getGithubReviewTokensUsed(
  userId: number,
  windowStart: Date,
): Promise<number> {
  const result = await pool.query<{ tokens_used: number }>(
    "SELECT tokens_used FROM github_review_usage WHERE user_id = $1 AND window_start = $2",
    [userId, windowStart],
  );
  return result.rows[0]?.tokens_used ?? 0;
}

/**
 * Purchased GitHub review token balance (users.github_credit_balance) -- a
 * one-time top-up bought via app/actions/stripe.ts's
 * createGithubCreditPaymentIntent and credited by creditGithubCreditPurchase
 * below (called from confirmGithubCreditPurchase and the webhook's
 * payment_intent.succeeded handler). Mirrors lib/billing/ai-usage.ts's
 * getAiCreditBalance exactly: NEVER reset by the window, only goes up (a
 * purchase) or down (a recordGithubReviewTokens spend past the free
 * allowance).
 */
export async function getGithubCreditBalance(userId: number): Promise<number> {
  const result = await pool.query<{ github_credit_balance: number }>(
    "SELECT github_credit_balance FROM users WHERE id = $1",
    [userId],
  );
  return result.rows[0]?.github_credit_balance ?? 0;
}

/**
 * Adds to the user's GitHub review token balance. A plain, non-idempotent
 * `+` -- calling this twice for the same purchase double-credits the user.
 * Callers crediting a Stripe purchase must go through
 * creditGithubCreditPurchase below instead of calling this directly.
 * Mirrors lib/billing/ai-usage.ts's addAiCreditBalance.
 */
export async function addGithubCreditBalance(
  userId: number,
  tokens: number,
): Promise<void> {
  if (tokens <= 0) return;
  await pool.query(
    `UPDATE users SET github_credit_balance = github_credit_balance + $2 WHERE id = $1`,
    [userId, tokens],
  );
}

/**
 * Idempotently applies ONE successful GitHub review credit PaymentIntent to
 * a user's balance. Mirrors lib/billing/ai-usage.ts's
 * creditAiCreditPurchase exactly, guarded by the github_credit_purchases
 * table (payment_intent_id PRIMARY KEY) instead of ai_credit_purchases --
 * see that function's own comment for the full double-credit race it
 * closes.
 */
export async function creditGithubCreditPurchase(
  paymentIntentId: string,
  userId: number,
  tokens: number,
): Promise<{ credited: boolean }> {
  if (tokens <= 0) return { credited: false };
  const result = await pool.query(
    `INSERT INTO github_credit_purchases (payment_intent_id, user_id, tokens)
     VALUES ($1, $2, $3)
     ON CONFLICT (payment_intent_id) DO NOTHING
     RETURNING payment_intent_id`,
    [paymentIntentId, userId, tokens],
  );
  if ((result.rowCount ?? 0) === 0) return { credited: false };
  await addGithubCreditBalance(userId, tokens);
  return { credited: true };
}

/**
 * Reverses a GitHub-review-credit purchase on a Stripe refund/dispute. Mirrors
 * reverseAiCreditPurchase exactly (refunded_at NULL-guard for at-most-once,
 * GREATEST-floor so a partly-spent balance never goes negative).
 */
export async function reverseGithubCreditPurchase(
  paymentIntentId: string,
): Promise<{ reversed: boolean; userId?: number; tokens?: number }> {
  const claimed = await pool.query<{ user_id: number; tokens: number }>(
    `UPDATE github_credit_purchases SET refunded_at = NOW()
       WHERE payment_intent_id = $1 AND refunded_at IS NULL
       RETURNING user_id, tokens`,
    [paymentIntentId],
  );
  const row = claimed.rows[0];
  if (!row) return { reversed: false };
  await pool.query(
    `UPDATE users SET github_credit_balance = GREATEST(github_credit_balance - $2, 0) WHERE id = $1`,
    [row.user_id, row.tokens],
  );
  return { reversed: true, userId: row.user_id, tokens: Number(row.tokens) };
}

/**
 * Adds `tokens` (the REAL usage the AI provider reported for one call) to
 * the user's counter for the given window. Called after each AI call
 * completes, not before — see lib/ai/review-source.ts. Defaults
 * `windowStart` to the current window under the currently configured
 * AI_USAGE_WINDOW_HOURS when the caller doesn't already have one in hand,
 * matching lib/billing/ai-usage.ts's recordAiTokens.
 *
 * Spend order mirrors recordAiTokens exactly: the plan's free
 * githubReviewTokensPerWindow allowance is always consumed first, and only
 * the portion of THIS call's tokens that lands above that ceiling is
 * charged against the purchased credit balance. Same atomic
 * UPSERT-then-GREATEST-floor pair, for the same concurrency-safety reason —
 * see recordAiTokens' own comment for the full race it closes.
 */
export async function recordGithubReviewTokens(
  userId: number,
  tokens: number,
  windowStart?: Date,
): Promise<void> {
  if (tokens <= 0) return;
  const start = windowStart ?? (await resolveCurrentWindow()).windowStart;
  const result = await pool.query<{ tokens_used: number }>(
    `INSERT INTO github_review_usage (user_id, window_start, tokens_used, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, window_start)
     DO UPDATE SET tokens_used = github_review_usage.tokens_used + $3, updated_at = NOW()
     RETURNING tokens_used`,
    [userId, start, tokens],
  );
  const newTotal = result.rows[0]?.tokens_used ?? tokens;

  const limits = await getUserPlanLimits(userId);
  const limitTokens = limits?.githubReviewTokensPerWindow ?? -1;
  // <= 0, not === -1: 0 means this plan's real entitlement is the hidden
  // free-trial allowance (see checkGithubReviewQuota below), not a real
  // per-window cap. recordGithubReviewTokens has no way to tell here
  // whether THIS specific call was covered by that trial or by a purchased
  // credit fallback -- but checkGithubReviewQuota never offers a credit
  // fallback for the 0-limit case either (only for a real, > 0 window cap
  // that's been exhausted), so nothing on a 0-limit plan should ever reach
  // here having legitimately spent credits. Skipping the spend entirely
  // for limitTokens <= 0 avoids silently draining a purchased balance for
  // what was supposed to be a free trial review.
  if (limitTokens <= 0) return;

  const previousTotal = newTotal - tokens;
  const windowPortion = Math.max(
    0,
    Math.min(tokens, limitTokens - previousTotal),
  );
  const creditPortion = tokens - windowPortion;
  if (creditPortion > 0) {
    await pool.query(
      `UPDATE users SET github_credit_balance = GREATEST(github_credit_balance - $2, 0) WHERE id = $1`,
      [userId, creditPortion],
    );
  }
}

/**
 * True when this account has already used its free trial review within
 * the last admin-configurable GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS. Only
 * ever consulted for a plan whose githubReviewTokensPerWindow is 0 -- see
 * checkGithubReviewQuota below.
 */
export async function hasUsedFreeGithubReviewToday(
  userId: number,
): Promise<boolean> {
  const result = await pool.query<{ free_github_review_used_at: Date | null }>(
    "SELECT free_github_review_used_at FROM users WHERE id = $1",
    [userId],
  );
  const usedAt = result.rows[0]?.free_github_review_used_at;
  if (!usedAt) return false;
  const windowHours = await getSetting("GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS");
  const windowMs = windowHours * 60 * 60 * 1000;
  return Date.now() - new Date(usedAt).getTime() < windowMs;
}

/**
 * Atomically claims the free trial slot for `userId` if it hasn't been
 * used within the last FREE_TRIAL_WINDOW_HOURS, returning whether the
 * claim succeeded. The check-then-stamp used to be two separate steps
 * (hasUsedFreeGithubReviewToday, then markFreeGithubReviewUsed after a
 * review ran) -- two concurrent requests from the same account could
 * both see "not used yet" before either had stamped it, allowing two
 * free reviews inside one window instead of one. The UPDATE...WHERE...
 * RETURNING here is the actual mutex: only one concurrent caller's
 * UPDATE can match the WHERE clause and return a row before the other's
 * NOW() has landed.
 *
 * Still "reserve, then give back on failure", not "stamp only after
 * success": a review that ultimately fails must not cost the user their
 * daily trial. Call releaseFreeGithubReviewTrial if the review this
 * claimed a slot for doesn't complete -- see
 * app/api/v3/scan/github/route.ts.
 */
export async function claimFreeGithubReviewTrial(
  userId: number,
): Promise<boolean> {
  const windowHours = await getSetting("GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS");
  const windowMs = windowHours * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs);
  const result = await pool.query(
    `UPDATE users SET free_github_review_used_at = NOW()
     WHERE id = $1
       AND (free_github_review_used_at IS NULL OR free_github_review_used_at < $2)
     RETURNING id`,
    [userId, cutoff],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Gives back a trial slot claimFreeGithubReviewTrial reserved when the
 * review it was reserved for didn't actually complete. Resets to NULL
 * rather than restoring some prior value: a successful claim only ever
 * happens when there was nothing to restore to in the first place (the
 * claim's WHERE clause only matches NULL or an already-expired
 * timestamp, and either one reads identically to "not used within the
 * window" either way).
 */
export async function releaseFreeGithubReviewTrial(
  userId: number,
): Promise<void> {
  await pool.query(
    "UPDATE users SET free_github_review_used_at = NULL WHERE id = $1",
    [userId],
  );
}

export interface GithubReviewQuotaCheck {
  allowed: boolean;
  /** True when the user brings their own AI key — the cap never applies in this case. */
  usingOwnAi: boolean;
  usedTokens: number;
  /** -1 means unlimited (billing disabled); otherwise the plan's per-window cap (a staff caller resolves to the Pro Supporter cap, see getUserPlanLimits). */
  limitTokens: number;
  /** Start of the window this check evaluated against. Mirrors AiUsageQuotaCheck's shape in lib/billing/ai-usage.ts. */
  windowStart: Date;
  /** The admin-configured window length, in hours, this check evaluated against. */
  windowHours: number;
  /**
   * True when this specific `allowed: true` came from the hidden
   * free-trial allowance (limitTokens === 0, trial not yet used today) —
   * not a real plan entitlement. The caller must call
   * markFreeGithubReviewUsed after the review actually runs when this is
   * true; every other allowed:true case needs no such follow-up.
   */
  isFreeTrial?: boolean;
  /** Present only when allowed is false. */
  message?: string;
  /** Purchased GitHub review token balance (see getGithubCreditBalance) --
   *  resolved on every branch (even the own-AI bypass and unlimited paths)
   *  so callers like Profile > Billing can always show it accurately,
   *  regardless of whether this particular check needed it to allow the
   *  request. Mirrors AiUsageQuotaCheck.creditBalance exactly. Never a
   *  fallback for the 0-limit (free-trial-gated) case -- see
   *  recordGithubReviewTokens' own comment for why. */
  creditBalance: number;
}

/**
 * Pre-run quota check: called before a GitHub repo scan is allowed to
 * start. Bypasses entirely for a user with their own AI key configured
 * (those calls cost VulnRadar nothing). Otherwise compares the current
 * window's REAL usage so far against the plan's githubReviewTokensPerWindow
 * cap — this is deliberately not a check against the per-run token
 * estimate, which is a separate, always-enforced ceiling checked by the
 * caller (see lib/config/registry.ts's GITHUB_REVIEW_MAX_TOKENS_PER_RUN and
 * lib/scanner/github-repo-scan.ts's estimateTokens).
 */
export async function checkGithubReviewQuota(
  userId: number,
): Promise<GithubReviewQuotaCheck> {
  const usingOwnAi = await hasOwnAiConfig(userId);
  const creditBalance = await getGithubCreditBalance(userId);

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

  const limitTokens = limits.githubReviewTokensPerWindow;
  const usedTokens = await getGithubReviewTokensUsed(userId, windowStart);

  if (limitTokens === 0) {
    // Hidden trial, never advertised on the pricing page: a plan with no
    // real GitHub review entitlement still gets one review every
    // admin-configurable GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS so it can
    // see what the feature does before deciding to upgrade. Deliberately
    // no credit-balance fallback here (unlike the real-cap branch below)
    // -- recordGithubReviewTokens never spends credits for a 0-limit plan
    // either, see its own comment for why threading "was this call
    // trial-covered or credit-covered" through would be needed to do that
    // safely, which isn't worth the complexity for what's meant to be a
    // free taste of the feature.
    const usedTrialRecently = await hasUsedFreeGithubReviewToday(userId);
    if (!usedTrialRecently) {
      return {
        allowed: true,
        usingOwnAi: false,
        usedTokens,
        limitTokens,
        windowStart,
        windowHours,
        isFreeTrial: true,
        creditBalance,
      };
    }
    const freeTrialWindowHours = await getSetting(
      "GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS",
    );
    return {
      allowed: false,
      usingOwnAi: false,
      usedTokens,
      limitTokens,
      windowStart,
      windowHours,
      creditBalance,
      message: `You've used today's free GitHub AI review. Upgrade for regular access, connect your own AI provider key in Profile > AI settings, or check back in ${freeTrialWindowHours} hours.`,
    };
  }

  if (usedTokens >= limitTokens) {
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
      message: `You've used ${usedTokens.toLocaleString()} of your ${limitTokens.toLocaleString()} GitHub review AI tokens for this ${windowHours}-hour window. Upgrade your plan, wait for the window to reset, connect your own AI provider key in Profile > AI settings, or buy GitHub review credits in Profile > Billing to bypass this cap.`,
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
