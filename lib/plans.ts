// ============================================================================
// Subscription Plans
// ============================================================================
// Defines available subscription tiers and their features
// ============================================================================

export interface Plan {
  id: string
  name: string
  description: string
  priceInCents: number  // Monthly price
  stripePriceId?: string  // Stripe Price ID (set after creating in Stripe)
  features: string[]
  limits: {
    dailyScans: number
    apiKeys: number
    teams: number
    teamMembers: number
    webhooks: number
    scheduledScans: number
    bulkScanUrls: number
  }
  badge?: {
    text: string
    color: string
  }
}

export const PLANS: Plan[] = [
  // NOTE: Daily scan limits are controlled by config.yaml → BILLING_PLAN_LIMITS
  // The limits here are defaults that get overridden by config.yaml values
  {
    id: "free",
    name: "Free",
    description: "For individuals exploring security scanning",
    priceInCents: 0,
    features: [
      "50 scans per day",
      "Full vulnerability detection",
      "Security headers analysis",
      "SSL/TLS checks",
      "API access",
      "30-day scan history",
    ],
    limits: {
      dailyScans: 50,
      apiKeys: 1,
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
      "100 scans per day",
      "Everything in Free",
      "90-day scan history",
      "Email support",
      "Early access features",
      "Supporter badge",
    ],
    limits: {
      dailyScans: 100,
      apiKeys: 3,
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
      "150 scans per day",
      "Everything in Core",
      "Unlimited scan history",
      "Priority support",
      "5,000 API requests/day",
      "Pro badge",
    ],
    limits: {
      dailyScans: 150,
      apiKeys: 10,
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
      "500 scans per day",
      "Everything in Pro",
      "Unlimited API access",
      "Dedicated support",
      "Beta features access",
      "Elite badge",
    ],
    limits: {
      dailyScans: 500,
      apiKeys: -1, // Unlimited
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
]

/**
 * Get a plan by ID
 */
export function getPlanById(planId: string): Plan | undefined {
  return PLANS.find((p) => p.id === planId)
}

/**
 * Get the free plan
 */
export function getFreePlan(): Plan {
  return PLANS.find((p) => p.id === "free")!
}

/**
 * Check if a plan is paid
 */
export function isPaidPlan(planId: string): boolean {
  const plan = getPlanById(planId)
  return plan ? plan.priceInCents > 0 : false
}

/**
 * Get all paid plans
 */
export function getPaidPlans(): Plan[] {
  return PLANS.filter((p) => p.priceInCents > 0)
}
