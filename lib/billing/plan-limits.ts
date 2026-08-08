// Per-resource plan limits (API keys, webhooks, scheduled scans, teams,
// team members) — distinct from the daily scan quota check in
// lib/rate-limiting/daily-limits.ts, but following the same rules: billing
// disabled means unlimited, staff means unlimited, otherwise the caller's
// plan decides.
//
// The actual numbers live in the admin settings registry (lib/config/
// registry.ts, "Billing" group), not in lib/billing/catalog.ts's PLANS
// array. catalog.ts keeps its own copy for Stripe product descriptions and
// pricing-page marketing copy; this resolver is what every route enforces
// against, so an admin edit in /admin takes effect here within the 30s
// resolver cache TTL, no deploy needed.

import { getUserPlan } from "@/lib/rate-limiting/daily-limits";
import { getSetting, getSettings } from "@/lib/config/runtime-config";
import type { SettingKey } from "@/lib/config/registry";
import { type PlanLimits, type PlanId } from "./catalog";

const PLAN_LIMIT_KEYS: Record<PlanId, Record<keyof PlanLimits, SettingKey>> = {
  free: {
    dailyScans: "BILLING_FREE_LIMIT",
    apiKeys: "BILLING_FREE_API_KEYS",
    apiRequestsPerDay: "BILLING_FREE_API_REQUESTS_PER_DAY",
    teams: "BILLING_FREE_TEAMS",
    teamMembers: "BILLING_FREE_TEAM_MEMBERS",
    webhooks: "BILLING_FREE_WEBHOOKS",
    scheduledScans: "BILLING_FREE_SCHEDULED_SCANS",
    bulkScanUrls: "BILLING_FREE_BULK_SCAN_URLS",
    githubReviewTokensPerMonth: "BILLING_FREE_GITHUB_REVIEW_TOKENS_PER_MONTH",
  },
  core_supporter: {
    dailyScans: "BILLING_CORE_SUPPORTER_LIMIT",
    apiKeys: "BILLING_CORE_SUPPORTER_API_KEYS",
    apiRequestsPerDay: "BILLING_CORE_SUPPORTER_API_REQUESTS_PER_DAY",
    teams: "BILLING_CORE_SUPPORTER_TEAMS",
    teamMembers: "BILLING_CORE_SUPPORTER_TEAM_MEMBERS",
    webhooks: "BILLING_CORE_SUPPORTER_WEBHOOKS",
    scheduledScans: "BILLING_CORE_SUPPORTER_SCHEDULED_SCANS",
    bulkScanUrls: "BILLING_CORE_SUPPORTER_BULK_SCAN_URLS",
    githubReviewTokensPerMonth:
      "BILLING_CORE_SUPPORTER_GITHUB_REVIEW_TOKENS_PER_MONTH",
  },
  pro_supporter: {
    dailyScans: "BILLING_PRO_SUPPORTER_LIMIT",
    apiKeys: "BILLING_PRO_SUPPORTER_API_KEYS",
    apiRequestsPerDay: "BILLING_PRO_SUPPORTER_API_REQUESTS_PER_DAY",
    teams: "BILLING_PRO_SUPPORTER_TEAMS",
    teamMembers: "BILLING_PRO_SUPPORTER_TEAM_MEMBERS",
    webhooks: "BILLING_PRO_SUPPORTER_WEBHOOKS",
    scheduledScans: "BILLING_PRO_SUPPORTER_SCHEDULED_SCANS",
    bulkScanUrls: "BILLING_PRO_SUPPORTER_BULK_SCAN_URLS",
    githubReviewTokensPerMonth:
      "BILLING_PRO_SUPPORTER_GITHUB_REVIEW_TOKENS_PER_MONTH",
  },
  elite_supporter: {
    dailyScans: "BILLING_ELITE_SUPPORTER_LIMIT",
    apiKeys: "BILLING_ELITE_SUPPORTER_API_KEYS",
    apiRequestsPerDay: "BILLING_ELITE_SUPPORTER_API_REQUESTS_PER_DAY",
    teams: "BILLING_ELITE_SUPPORTER_TEAMS",
    teamMembers: "BILLING_ELITE_SUPPORTER_TEAM_MEMBERS",
    webhooks: "BILLING_ELITE_SUPPORTER_WEBHOOKS",
    scheduledScans: "BILLING_ELITE_SUPPORTER_SCHEDULED_SCANS",
    bulkScanUrls: "BILLING_ELITE_SUPPORTER_BULK_SCAN_URLS",
    githubReviewTokensPerMonth:
      "BILLING_ELITE_SUPPORTER_GITHUB_REVIEW_TOKENS_PER_MONTH",
  },
};

/** Null means unlimited: billing is off, or the caller is staff. */
export async function getUserPlanLimits(
  userId: number,
): Promise<PlanLimits | null> {
  const billingEnabled = await getSetting("BILLING_ENABLED");
  if (!billingEnabled) return null;

  const plan = await getUserPlan(userId);
  if (plan === "staff") return null;

  const keys = PLAN_LIMIT_KEYS[plan];
  const resolved = await getSettings(Object.values(keys));

  return {
    dailyScans: Number(resolved[keys.dailyScans]),
    apiKeys: Number(resolved[keys.apiKeys]),
    apiRequestsPerDay: Number(resolved[keys.apiRequestsPerDay]),
    teams: Number(resolved[keys.teams]),
    teamMembers: Number(resolved[keys.teamMembers]),
    webhooks: Number(resolved[keys.webhooks]),
    scheduledScans: Number(resolved[keys.scheduledScans]),
    bulkScanUrls: Number(resolved[keys.bulkScanUrls]),
    githubReviewTokensPerMonth: Number(resolved[keys.githubReviewTokensPerMonth]),
  };
}

/** -1 means unlimited, 0 means the plan does not include this at all. */
export function withinPlanLimit(current: number, limit: number): boolean {
  if (limit === -1) return true;
  return current < limit;
}

/** Copy for the 0-and-N cases, shared so the wording doesn't drift per route. */
export function planLimitMessage(resource: string, limit: number): string {
  if (limit === 0) {
    return `${resource} are not available on your plan. Upgrade to use this.`;
  }
  return `Your plan allows up to ${limit} ${resource}. Upgrade for more.`;
}
