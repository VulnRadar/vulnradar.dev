import "server-only";

import { checkAiUsageQuota } from "@/lib/billing/ai-usage";
import { checkGithubReviewQuota } from "@/lib/billing/github-review-usage";
import { checkBrowserbaseQuota } from "@/lib/billing/browserbase-usage";
import type { CreditKindId } from "./credit-kinds";

/**
 * One credit balance, in the kind's own unit, as of this render.
 *
 * Read on the server so /credits and the three top-up pages paint the real
 * numbers on the first frame. The pages they replace fetched
 * /api/v3/auth/me purely to decide whether to redirect to login, a question
 * middleware.ts has already answered before the route renders, and then
 * showed a full-page skeleton while doing it. So a buyer waited on a request
 * that could not change what they saw, and still was not told the one fact
 * that decides whether to buy at all: how many credits they already hold.
 */
export interface CreditSnapshot {
  kindId: CreditKindId;
  /** Purchased balance. Never expires, never reset by the period below. */
  purchased: number;
  /**
   * The plan's free allowance for the current period, same unit.
   * -1 means no cap at all; 0 means the plan does not include the feature,
   * in which case purchased credits are the only way to use it.
   */
  freeLimit: number;
  freeUsed: number;
  /** When freeUsed goes back to zero. ISO 8601. */
  resetsAt: string;
  /** The admin-configured window length. Only meaningful for period "window". */
  windowHours: number;
  /** AI and GitHub only: an own-provider key bypasses the cap entirely. */
  usingOwnKey: boolean;
}

/** Whole seconds to minutes, keeping the fraction: a 90 second session is 1.5
 *  minutes of a monthly allowance and rounding it to 2 would overstate what
 *  has been spent. Rendering decides how many decimals to show. */
function toMinutes(seconds: number): number {
  return seconds / 60;
}

async function aiSnapshot(userId: number): Promise<CreditSnapshot> {
  const ai = await checkAiUsageQuota(userId);
  return {
    kindId: "ai",
    purchased: ai.creditBalance,
    freeLimit: ai.limitTokens,
    freeUsed: ai.usedTokens,
    resetsAt: new Date(
      ai.windowStart.getTime() + ai.windowHours * 60 * 60 * 1000,
    ).toISOString(),
    windowHours: ai.windowHours,
    usingOwnKey: ai.usingOwnAi,
  };
}

async function githubSnapshot(userId: number): Promise<CreditSnapshot> {
  const github = await checkGithubReviewQuota(userId);
  return {
    kindId: "github",
    purchased: github.creditBalance,
    freeLimit: github.limitTokens,
    freeUsed: github.usedTokens,
    resetsAt: new Date(
      github.windowStart.getTime() + github.windowHours * 60 * 60 * 1000,
    ).toISOString(),
    windowHours: github.windowHours,
    usingOwnKey: github.usingOwnAi,
  };
}

async function browserSnapshot(userId: number): Promise<CreditSnapshot> {
  const browser = await checkBrowserbaseQuota(userId);
  return {
    kindId: "browser",
    purchased: toMinutes(browser.creditBalanceSeconds),
    freeLimit: browser.limitMinutes,
    freeUsed: toMinutes(browser.usedSeconds),
    // Calendar month, not a rolling window: the first instant of the month
    // after the one this check evaluated, computed in UTC exactly as
    // app/api/v3/billing/route.ts computes it.
    resetsAt: new Date(
      Date.UTC(
        browser.periodStart.getUTCFullYear(),
        browser.periodStart.getUTCMonth() + 1,
        1,
      ),
    ).toISOString(),
    windowHours: 0,
    usingOwnKey: false,
  };
}

const LOADERS: Record<
  CreditKindId,
  (userId: number) => Promise<CreditSnapshot>
> = {
  ai: aiSnapshot,
  github: githubSnapshot,
  browser: browserSnapshot,
};

/** One balance. A top-up page reads only the one it sells, rather than paying
 *  for three quota lookups to show one number. */
export function loadCreditSnapshot(
  userId: number,
  kindId: CreditKindId,
): Promise<CreditSnapshot> {
  return LOADERS[kindId](userId);
}

/**
 * All three balances for one user, in one pass.
 *
 * Deliberately the same three quota functions /api/v3/billing calls, so the
 * number on /credits and the number in Profile > Billing can never disagree.
 */
export async function loadCreditSnapshots(
  userId: number,
): Promise<Record<CreditKindId, CreditSnapshot>> {
  const [ai, github, browser] = await Promise.all([
    aiSnapshot(userId),
    githubSnapshot(userId),
    browserSnapshot(userId),
  ]);
  return { ai, github, browser };
}
