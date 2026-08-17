// Billing Catalog (Source of Truth)

import { APP_NAME, AI_USAGE_WINDOW_HOURS } from "@/lib/config/constants";

// O4: Previously split across plans.ts and products.ts. Two divergent
// source-of-truth declarations for the same billing tiers led to
// drift (PRODUCTS had yearly variants that PLANS didn't know about).
// This module defines the Plan tier once and derives both the
// Stripe-facing Product list (monthly + yearly variants) and the
// application-facing Plan list (features + limits + badge).

export type PlanId =
  "free" | "core_supporter" | "pro_supporter" | "elite_supporter";

export type BillingInterval = "month" | "year";

export interface PlanLimits {
  dailyScans: number;
  apiKeys: number;
  apiRequestsPerDay: number;
  teams: number;
  teamMembers: number;
  webhooks: number;
  scheduledScans: number;
  bulkScanUrls: number;
  /**
   * AI tokens (prompt + completion) allowed per fixed AI_USAGE_WINDOW_HOURS
   * window for GitHub repo AI code review, using VulnRadar's own AI --
   * the exact same window aiTokensPerWindow below resets on (see
   * lib/billing/github-review-usage.ts, which imports its window
   * resolution directly from lib/billing/ai-usage.ts rather than keeping
   * an independent window-length setting). Kept as its own field/table
   * rather than folded into aiTokensPerWindow because a whole-repo review
   * call is a very different size than one chat/verify/summary call, not
   * because it runs on a different cadence. Unlike every other field
   * here, -1 (unlimited) is never valid: VulnRadar's AI usage runs
   * through subsidized/free-tier provider capacity, not an unlimited
   * budget, so even the top tier gets a real finite number. Bringing your
   * own AI key bypasses this cap entirely (see
   * lib/billing/github-review-usage.ts) instead of raising it.
   */
  githubReviewTokensPerWindow: number;
  /**
   * AI tokens (prompt + completion) allowed per fixed AI_USAGE_WINDOW_HOURS
   * window, combined across AI chat, AI finding verification, and AI scan
   * summaries. Separate from githubReviewTokensPerWindow above, which
   * covers a different, much-larger-per-call feature on the same window
   * through its own table -- see lib/billing/ai-usage.ts. Same "never -1
   * (unlimited), even at the top tier" rule as that field, for the same
   * reason: VulnRadar's AI usage runs through subsidized/free-tier
   * provider capacity here too. Bringing your own AI key bypasses this
   * cap entirely (see lib/billing/ai-usage.ts) instead of raising it.
   */
  aiTokensPerWindow: number;
  /**
   * Live-browser (Browserbase) session minutes allowed per calendar month
   * -- see lib/billing/browserbase-usage.ts. A single session is separately
   * capped at BROWSERBASE_MAX_TTL_SECONDS regardless of how much of this
   * monthly allowance remains. Unlike dailyScans/apiRequestsPerDay, this is
   * never -1 (unlimited) at any tier, even elite: Browserbase is a real
   * paid third-party API, the same "no tier is an unbounded budget"
   * reasoning as githubReviewTokensPerWindow/aiTokensPerWindow above. A
   * purchased top-up (users.browserbase_credit_seconds_balance) is spent
   * only as a fallback once this free monthly allowance is exhausted.
   */
  browserbaseMinutesPerMonth: number;
  /**
   * Max scans a user may have in status 'pending' or 'running' at once --
   * see lib/rate-limiting/concurrent-scans.ts. Distinct from dailyScans
   * (a calendar-day total): VulnRadar runs as one persistent Node process
   * with no job queue (see lib/scanner/execute-scan.ts), so every
   * concurrently-running scan shares that one process's resources. This is
   * a real capacity limit, not a demand-shaping one -- a single URL scan
   * (POST /scan) and a crawl's own tracker row both count; a crawl's
   * individual page rows do not (they're written directly as 'completed'
   * once already scanned, never occupy a 'pending'/'running' slot of
   * their own). -1 is a valid value here (unlimited), unlike the AI/
   * Browserbase fields above, since a scan is VulnRadar's own compute, not
   * a metered third-party API with a real per-unit cost.
   */
  concurrentScans: number;
}

export interface PlanBadge {
  text: string;
  color: string;
}

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  priceInCents: number; // Monthly price (yearly is derived)
  features: string[];
  limits: PlanLimits;
  badge?: PlanBadge;
}

export const PLANS: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    description: "For individuals exploring security scanning",
    priceInCents: 0,
    features: [
      "Full vulnerability detection",
      "Security headers analysis",
      "SSL/TLS checks",
      "API access",
      "30-day scan history",
      "5 URLs per bulk scan",
      "3 scheduled scans",
      "1 webhook alert",
    ],
    limits: {
      dailyScans: 25,
      apiKeys: 1,
      apiRequestsPerDay: 25,
      teams: 0,
      teamMembers: 0,
      webhooks: 1,
      scheduledScans: 3,
      bulkScanUrls: 5,
      githubReviewTokensPerWindow: 0,
      aiTokensPerWindow: 80_000,
      browserbaseMinutesPerMonth: 0,
      concurrentScans: 1,
    },
  },
  {
    id: "core_supporter",
    name: "Core Supporter",
    description: `Support ${APP_NAME} development + 100 scans/day`,
    priceInCents: 500,
    features: [
      "Everything in Free",
      "90-day scan history",
      "1 webhook alert",
      "5 scheduled scans",
      "10 URLs per bulk scan",
      `200K AI review tokens / ${AI_USAGE_WINDOW_HOURS}hr window`,
      "30 live-browser minutes/month",
      "2 scans running at once",
      "Supporter badge",
    ],
    limits: {
      dailyScans: 100,
      apiKeys: 3,
      apiRequestsPerDay: 100,
      teams: 0,
      teamMembers: 0,
      webhooks: 1,
      scheduledScans: 5,
      bulkScanUrls: 10,
      githubReviewTokensPerWindow: 200_000,
      aiTokensPerWindow: 400_000,
      browserbaseMinutesPerMonth: 30,
      concurrentScans: 2,
    },
    badge: { text: "Core", color: "#10b981" },
  },
  {
    id: "pro_supporter",
    name: "Pro Supporter",
    description: "For power users - 150 scans/day",
    priceInCents: 1000,
    features: [
      "Everything in Core",
      "Unlimited scan history",
      "Teams, up to 3 members",
      "10 scheduled scans",
      "5,000 API requests/day",
      `1M AI review tokens / ${AI_USAGE_WINDOW_HOURS}hr window`,
      "90 live-browser minutes/month",
      "3 scans running at once",
      "Pro badge",
    ],
    limits: {
      dailyScans: 150,
      apiKeys: 10,
      apiRequestsPerDay: 5000,
      teams: 1,
      teamMembers: 3,
      webhooks: 5,
      scheduledScans: 10,
      bulkScanUrls: 25,
      githubReviewTokensPerWindow: 1_000_000,
      aiTokensPerWindow: 2_000_000,
      browserbaseMinutesPerMonth: 90,
      concurrentScans: 3,
    },
    badge: { text: "Pro", color: "#3b82f6" },
  },
  {
    id: "elite_supporter",
    name: "Elite Supporter",
    description: "Maximum power - 500 scans/day",
    priceInCents: 2000,
    features: [
      "Everything in Pro",
      "Unlimited API access",
      "Unlimited webhooks and scheduled scans",
      "Teams, up to 10 members",
      `5M AI review tokens / ${AI_USAGE_WINDOW_HOURS}hr window`,
      "300 live-browser minutes/month",
      "5 scans running at once",
      "Elite badge",
    ],
    limits: {
      dailyScans: 500,
      apiKeys: -1,
      apiRequestsPerDay: -1,
      teams: 3,
      teamMembers: 10,
      webhooks: -1,
      scheduledScans: -1,
      bulkScanUrls: 100,
      // Never -1 (unlimited) for this field, even at the top tier — see
      // the PlanLimits.githubReviewTokensPerWindow doc comment above.
      githubReviewTokensPerWindow: 5_000_000,
      // Same rule as above: never -1 (unlimited), even at the top tier —
      // see the PlanLimits.aiTokensPerWindow doc comment above.
      aiTokensPerWindow: 8_000_000,
      // Same rule again: never -1 (unlimited), even at the top tier — see
      // the PlanLimits.browserbaseMinutesPerMonth doc comment above.
      browserbaseMinutesPerMonth: 300,
      // Unlike the three fields above, concurrentScans IS a valid -1 kind
      // of field (see its own doc comment) -- 5, not unlimited, because
      // VulnRadar's single-process architecture makes this a real shared-
      // capacity limit, not just a monetization tier.
      concurrentScans: 5,
    },
    badge: { text: "Elite", color: "#f59e0b" },
  },
];

// Stripe-facing Products (derived from PLANS)

// Each paid plan generates two products: one monthly, one yearly with
// a 20% discount. Free has no product.

export interface Product {
  id: string;
  planId: PlanId;
  name: string;
  description: string;
  priceInCents: number;
  interval: BillingInterval;
  scansPerDay: number;
}

const YEARLY_DISCOUNT = 0.2;

export const PRODUCTS: readonly Product[] = PLANS.flatMap((plan) => {
  if (plan.priceInCents === 0) return [];
  const monthly: Product = {
    id: `${plan.id}_monthly`,
    planId: plan.id,
    name: plan.name,
    description: plan.description,
    priceInCents: plan.priceInCents,
    interval: "month",
    scansPerDay: plan.limits.dailyScans,
  };
  const yearlyPrice = Math.round(
    plan.priceInCents * 12 * (1 - YEARLY_DISCOUNT),
  );
  const yearly: Product = {
    id: `${plan.id}_yearly`,
    planId: plan.id,
    name: `${plan.name} (Yearly)`,
    description: plan.description,
    priceInCents: yearlyPrice,
    interval: "year",
    scansPerDay: plan.limits.dailyScans,
  };
  return [monthly, yearly];
});

// Lookup helpers

export function getPlanById(planId: string): Plan | undefined {
  return PLANS.find((p) => p.id === planId);
}

export function getFreePlan(): Plan {
  return PLANS.find((p) => p.id === "free")!;
}

export function isPaidPlan(planId: string): boolean {
  const plan = getPlanById(planId);
  return plan ? plan.priceInCents > 0 : false;
}

export function getPaidPlans(): readonly Plan[] {
  return PLANS.filter((p) => p.priceInCents > 0);
}

export function getApiLimitForPlan(planId: string): number {
  const plan = getPlanById(planId);
  return plan?.limits.apiRequestsPerDay ?? 25;
}

export function getPlanFromProductId(productId: string): PlanId {
  if (productId.startsWith("core_supporter")) return "core_supporter";
  if (productId.startsWith("pro_supporter")) return "pro_supporter";
  if (productId.startsWith("elite_supporter")) return "elite_supporter";
  return "free";
}
