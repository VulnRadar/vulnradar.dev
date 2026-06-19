// ============================================================================
// Subscription Plans
// ============================================================================
// Defines available subscription tiers and their features
// ============================================================================

export interface Plan {
  id: string;
  name: string;
  description: string;
  priceInCents: number; // Monthly price
  stripePriceId?: string; // Stripe Price ID (set after creating in Stripe)
  features: string[];
  limits: {
    dailyScans: number;
    apiKeys: number;
    apiRequestsPerDay: number; // API rate limit per day
    teams: number;
    teamMembers: number;
    webhooks: number;
    scheduledScans: number;
    bulkScanUrls: number;
  };
  badge?: {
    text: string;
    color: string;
  };
}

export const PLANS: Plan[] = [
  // NOTE: Daily scan limits and features are controlled by config.yaml → BILLING_PLAN_LIMITS
  // The limits here are defaults that get overridden by config.yaml values
  // Feature strings should NOT include hardcoded scan limits - let pricing page compute them
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
      apiRequestsPerDay: 25, // Free: 25 requests/day
      teams: 0,
      teamMembers: 0,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
    },
  },
  {
    id: "core_supporter",
    name: "Core Supporter",
    description: "For developers who scan regularly",
    priceInCents: 500, // $5/month
    features: [
      "Everything in Free",
      "90-day scan history",
      "Email support",
      "Early access features",
      "Supporter badge",
    ],
    limits: {
      dailyScans: 100,
      apiKeys: 3,
      apiRequestsPerDay: 100, // Core: 100 requests/day
      teams: 0,
      teamMembers: 0,
      webhooks: 1,
      scheduledScans: 0,
      bulkScanUrls: 10,
    },
    badge: {
      text: "Core",
      color: "#10b981",
    },
  },
  {
    id: "pro_supporter",
    name: "Pro Supporter",
    description: "For power users and small teams",
    priceInCents: 1000, // $10/month
    features: [
      "Everything in Core",
      "Unlimited scan history",
      "Priority support",
      "5,000 API requests/day",
      "Pro badge",
    ],
    limits: {
      dailyScans: 150,
      apiKeys: 10,
      apiRequestsPerDay: 5000, // Pro: 5,000 requests/day
      teams: 1,
      teamMembers: 3,
      webhooks: 5,
      scheduledScans: 5,
      bulkScanUrls: 25,
    },
    badge: {
      text: "Pro",
      color: "#3b82f6",
    },
  },
  {
    id: "elite_supporter",
    name: "Elite Supporter",
    description: "For teams and organizations",
    priceInCents: 2000, // $20/month
    features: [
      "Everything in Pro",
      "Unlimited API access",
      "Dedicated support",
      "Beta features access",
      "Elite badge",
    ],
    limits: {
      dailyScans: 500,
      apiKeys: -1, // Unlimited
      apiRequestsPerDay: -1, // Elite: Unlimited
      teams: 3,
      teamMembers: 10,
      webhooks: -1, // Unlimited
      scheduledScans: -1, // Unlimited
      bulkScanUrls: 100,
    },
    badge: {
      text: "Elite",
      color: "#f59e0b",
    },
  },
];

/**
 * Get a plan by ID
 */
export function getPlanById(planId: string): Plan | undefined {
  return PLANS.find((p) => p.id === planId);
}

/**
 * Get the free plan
 */
export function getFreePlan(): Plan {
  return PLANS.find((p) => p.id === "free")!;
}

/**
 * Check if a plan is paid
 */
export function isPaidPlan(planId: string): boolean {
  const plan = getPlanById(planId);
  return plan ? plan.priceInCents > 0 : false;
}

/**
 * Get all paid plans
 */
export function getPaidPlans(): Plan[] {
  return PLANS.filter((p) => p.priceInCents > 0);
}

/**
 * Get API request limit for a plan
 * Returns -1 for unlimited
 */
export function getApiLimitForPlan(planId: string): number {
  const plan = getPlanById(planId);
  return plan?.limits.apiRequestsPerDay ?? 25; // Default to free plan limit
}
