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
  {
    id: "free",
    name: "Free",
    description: "Basic scanning for individuals",
    priceInCents: 0,
    features: [
      "10 scans per day",
      "1 API key",
      "Basic vulnerability reports",
      "7-day scan history",
    ],
    limits: {
      dailyScans: 10,
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
    description: "Support VulnRadar development",
    priceInCents: 300, // $3/month
    features: [
      "50 scans per day",
      "3 API keys",
      "PDF reports",
      "30-day scan history",
      "1 webhook",
      "Discord supporter role",
    ],
    limits: {
      dailyScans: 50,
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
    description: "For security professionals",
    priceInCents: 500, // $5/month
    features: [
      "150 scans per day",
      "10 API keys",
      "PDF reports",
      "90-day scan history",
      "5 webhooks",
      "Scheduled scans",
      "Bulk scanning (25 URLs)",
      "Priority support",
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
    description: "Maximum power for teams",
    priceInCents: 1000, // $10/month
    features: [
      "500 scans per day",
      "Unlimited API keys",
      "PDF reports",
      "Unlimited scan history",
      "Unlimited webhooks",
      "Unlimited scheduled scans",
      "Bulk scanning (100 URLs)",
      "Team collaboration",
      "Priority support",
      "Early access to features",
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
