import pool from "@/lib/database/db";
import { resolveUserEndpoint } from "@/lib/ai/verify-findings";
import { getUserPlanLimits } from "@/lib/billing/plan-limits";

/**
 * Monthly AI token usage tracking for GitHub repo AI code review
 * (githubReviewTokensPerMonth plan limit). Tracks real tokens, not a run
 * count — see the doc comment on PlanLimits.githubReviewTokensPerMonth in
 * lib/billing/catalog.ts for why.
 */

/** 'YYYY-MM' in UTC — the calendar-month window the counter resets on. */
export function currentYearMonth(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

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

/** Real (not estimated) tokens spent so far this calendar month. */
export async function getGithubReviewTokensUsed(
  userId: number,
  yearMonth: string = currentYearMonth(),
): Promise<number> {
  const result = await pool.query<{ tokens_used: number }>(
    "SELECT tokens_used FROM github_review_usage WHERE user_id = $1 AND year_month = $2",
    [userId, yearMonth],
  );
  return result.rows[0]?.tokens_used ?? 0;
}

/**
 * Adds `tokens` (the REAL usage the AI provider reported for one call) to
 * the user's counter for the current month. Called after each AI call
 * completes, not before — see lib/ai/review-source.ts.
 */
export async function recordGithubReviewTokens(
  userId: number,
  tokens: number,
  yearMonth: string = currentYearMonth(),
): Promise<void> {
  if (tokens <= 0) return;
  await pool.query(
    `INSERT INTO github_review_usage (user_id, year_month, tokens_used, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, year_month)
     DO UPDATE SET tokens_used = github_review_usage.tokens_used + $3, updated_at = NOW()`,
    [userId, yearMonth, tokens],
  );
}

export interface GithubReviewQuotaCheck {
  allowed: boolean;
  /** True when the user brings their own AI key — the cap never applies in this case. */
  usingOwnAi: boolean;
  usedTokens: number;
  /** -1 means unlimited (billing disabled or staff); otherwise the plan's monthly cap. */
  limitTokens: number;
  /** Present only when allowed is false. */
  message?: string;
}

/**
 * Pre-run quota check: called before a GitHub repo scan is allowed to
 * start. Bypasses entirely for a user with their own AI key configured
 * (those calls cost VulnRadar nothing). Otherwise compares this month's
 * REAL usage so far against the plan's githubReviewTokensPerMonth cap —
 * this is deliberately not a check against the per-run token estimate,
 * which is a separate, always-enforced ceiling checked by the caller
 * (see lib/config/registry.ts's GITHUB_REVIEW_MAX_TOKENS_PER_RUN and
 * lib/scanner/github-repo-scan.ts's estimateTokens).
 */
export async function checkGithubReviewQuota(
  userId: number,
): Promise<GithubReviewQuotaCheck> {
  const usingOwnAi = await hasOwnAiConfig(userId);
  if (usingOwnAi) {
    return { allowed: true, usingOwnAi: true, usedTokens: 0, limitTokens: -1 };
  }

  const limits = await getUserPlanLimits(userId);
  // null means billing is disabled or the caller is staff: unlimited.
  if (limits === null) {
    return { allowed: true, usingOwnAi: false, usedTokens: 0, limitTokens: -1 };
  }

  const limitTokens = limits.githubReviewTokensPerMonth;
  const usedTokens = await getGithubReviewTokensUsed(userId);

  if (limitTokens === 0) {
    return {
      allowed: false,
      usingOwnAi: false,
      usedTokens,
      limitTokens,
      message:
        "GitHub repo AI code review is not available on your plan. Upgrade to use this, or connect your own AI provider key in Profile > AI settings.",
    };
  }

  if (usedTokens >= limitTokens) {
    return {
      allowed: false,
      usingOwnAi: false,
      usedTokens,
      limitTokens,
      message: `You've used ${usedTokens.toLocaleString()} of your ${limitTokens.toLocaleString()} GitHub review AI tokens for this month. Upgrade your plan, wait for next month's reset, or connect your own AI provider key in Profile > AI settings to bypass this cap.`,
    };
  }

  return { allowed: true, usingOwnAi: false, usedTokens, limitTokens };
}
