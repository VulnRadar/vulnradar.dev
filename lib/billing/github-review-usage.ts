import pool from "@/lib/database/db";
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
 * Adds `tokens` (the REAL usage the AI provider reported for one call) to
 * the user's counter for the given window. Called after each AI call
 * completes, not before — see lib/ai/review-source.ts. Defaults
 * `windowStart` to the current window under the currently configured
 * AI_USAGE_WINDOW_HOURS when the caller doesn't already have one in hand,
 * matching lib/billing/ai-usage.ts's recordAiTokens.
 */
export async function recordGithubReviewTokens(
  userId: number,
  tokens: number,
  windowStart?: Date,
): Promise<void> {
  if (tokens <= 0) return;
  const start = windowStart ?? (await resolveCurrentWindow()).windowStart;
  await pool.query(
    `INSERT INTO github_review_usage (user_id, window_start, tokens_used, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, window_start)
     DO UPDATE SET tokens_used = github_review_usage.tokens_used + $3, updated_at = NOW()`,
    [userId, start, tokens],
  );
}

/** How often the free-plan trial review renews. Not the same clock as the windowed token quota this trial is layered in front of. */
const FREE_TRIAL_WINDOW_HOURS = 24;

/**
 * True when this account has already used its free trial review within
 * the last FREE_TRIAL_WINDOW_HOURS. Only ever consulted for a plan whose
 * githubReviewTokensPerWindow is 0 -- see checkGithubReviewQuota below.
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
  const windowMs = FREE_TRIAL_WINDOW_HOURS * 60 * 60 * 1000;
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
  const windowMs = FREE_TRIAL_WINDOW_HOURS * 60 * 60 * 1000;
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
  if (usingOwnAi) {
    const { windowStart, windowHours } = await resolveCurrentWindow();
    return {
      allowed: true,
      usingOwnAi: true,
      usedTokens: 0,
      limitTokens: -1,
      windowStart,
      windowHours,
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
    };
  }

  const limitTokens = limits.githubReviewTokensPerWindow;
  const usedTokens = await getGithubReviewTokensUsed(userId, windowStart);

  if (limitTokens === 0) {
    // Hidden trial, never advertised on the pricing page: a plan with no
    // real GitHub review entitlement still gets one review every
    // FREE_TRIAL_WINDOW_HOURS so it can see what the feature does before
    // deciding to upgrade.
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
      };
    }
    return {
      allowed: false,
      usingOwnAi: false,
      usedTokens,
      limitTokens,
      windowStart,
      windowHours,
      message: `You've used today's free GitHub AI review. Upgrade for regular access, connect your own AI provider key in Profile > AI settings, or check back in ${FREE_TRIAL_WINDOW_HOURS} hours.`,
    };
  }

  if (usedTokens >= limitTokens) {
    return {
      allowed: false,
      usingOwnAi: false,
      usedTokens,
      limitTokens,
      windowStart,
      windowHours,
      message: `You've used ${usedTokens.toLocaleString()} of your ${limitTokens.toLocaleString()} GitHub review AI tokens for this ${windowHours}-hour window. Upgrade your plan, wait for the window to reset, or connect your own AI provider key in Profile > AI settings to bypass this cap.`,
    };
  }

  return {
    allowed: true,
    usingOwnAi: false,
    usedTokens,
    limitTokens,
    windowStart,
    windowHours,
  };
}
