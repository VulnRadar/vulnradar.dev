// Billing Catalog (Source of Truth)

import { APP_NAME } from "@/lib/config/constants";

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
   * AI tokens (prompt + completion) allowed per calendar month for GitHub
   * repo AI code review, using VulnRadar's own AI. Unlike every other
   * field here, -1 (unlimited) is never valid: VulnRadar's AI usage runs
   * through subsidized/free-tier provider capacity, not an unlimited
   * budget, so even the top tier gets a real finite number. Bringing your
   * own AI key bypasses this cap entirely (see
   * lib/billing/github-review-usage.ts) instead of raising it.
   */
  githubReviewTokensPerMonth: number;
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
    ],
    limits: {
      dailyScans: 25,
      apiKeys: 1,
      apiRequestsPerDay: 25,
      teams: 0,
      teamMembers: 0,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
      githubReviewTokensPerMonth: 0,
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
      "10 URLs per bulk scan",
      "200K AI review tokens/month",
      "Supporter badge",
    ],
    limits: {
      dailyScans: 100,
      apiKeys: 3,
      apiRequestsPerDay: 100,
      teams: 0,
      teamMembers: 0,
      webhooks: 1,
      scheduledScans: 0,
      bulkScanUrls: 10,
      githubReviewTokensPerMonth: 200_000,
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
      "5 scheduled scans",
      "5,000 API requests/day",
      "1M AI review tokens/month",
      "Pro badge",
    ],
    limits: {
      dailyScans: 150,
      apiKeys: 10,
      apiRequestsPerDay: 5000,
      teams: 1,
      teamMembers: 3,
      webhooks: 5,
      scheduledScans: 5,
      bulkScanUrls: 25,
      githubReviewTokensPerMonth: 1_000_000,
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
      "5M AI review tokens/month",
      "Beta features access",
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
      // the PlanLimits.githubReviewTokensPerMonth doc comment above.
      githubReviewTokensPerMonth: 5_000_000,
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
