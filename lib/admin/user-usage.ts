import {
  getDailyLimit,
  getDailyRequestCount,
} from "@/lib/rate-limiting/daily-limits";
import { getUserPlanLimits } from "@/lib/billing/plan-limits";
import { getAiTokensUsed, resolveCurrentWindow } from "@/lib/billing/ai-usage";
import {
  getGithubReviewTokensUsed,
  hasOwnAiConfig,
} from "@/lib/billing/github-review-usage";
import type { UserUsage } from "@/components/admin/types";

/**
 * What a user has spent against each allowance right now.
 *
 * The admin panel could reset a user's daily scan count, AI usage and GitHub
 * review usage, and could not show any of them, so support reset limits blind:
 * not knowing whether the account sat at 3% or 100% of the cap, and with no
 * way to tell whether a reset was needed at all. The helpers that read these
 * already exist (the same ones the quota checks use), so the figures here are
 * the ones enforcement compares against, not a second calculation.
 *
 * A limit of `null` is unlimited: billing is off, or the plan's cap is -1.
 *
 * Runs in two small groups rather than one wide Promise.all. The user-detail
 * request already holds a connection for its main query, and this is called
 * alongside it, so a group of three keeps the request at four.
 */
export async function getUserUsage(userId: number): Promise<UserUsage> {
  const { windowStart, windowHours } = await resolveCurrentWindow();
  const windowEndsAt = new Date(
    windowStart.getTime() + windowHours * 60 * 60 * 1000,
  ).toISOString();

  const [scansToday, dailyLimit, limits] = await Promise.all([
    getDailyRequestCount(userId),
    getDailyLimit(userId),
    getUserPlanLimits(userId),
  ]);
  const [aiUsed, githubUsed, usingOwnKey] = await Promise.all([
    getAiTokensUsed(userId, windowStart),
    getGithubReviewTokensUsed(userId, windowStart),
    hasOwnAiConfig(userId),
  ]);

  // getDailyLimit returns Infinity for unlimited; Infinity is not JSON.
  const finiteOrNull = (value: number) =>
    Number.isFinite(value) && value >= 0 ? value : null;

  return {
    scans: { used: scansToday, limit: finiteOrNull(dailyLimit) },
    ai: {
      used: aiUsed,
      // limits is null when billing is disabled (unlimited); -1 is the plan's
      // own unlimited sentinel.
      limit: limits ? finiteOrNull(limits.aiTokensPerWindow) : null,
      windowEndsAt,
      usingOwnKey,
    },
    githubReview: {
      used: githubUsed,
      limit: limits ? finiteOrNull(limits.githubReviewTokensPerWindow) : null,
      windowEndsAt,
    },
  };
}
