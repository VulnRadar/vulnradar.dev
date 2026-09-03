// Per-resource plan limits (API keys, webhooks, scheduled scans, teams,
// team members) — distinct from the daily scan quota check in
// lib/rate-limiting/daily-limits.ts, but following the same rules: billing
// disabled means unlimited; staff are capped at the Pro Supporter plan's
// limits (not unlimited); otherwise the caller's real plan decides.
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
import { PLANS, type PlanLimits, type PlanId } from "./catalog";

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
    crawlPages: "BILLING_FREE_CRAWL_PAGES",
    githubReviewTokensPerWindow: "BILLING_FREE_GITHUB_REVIEW_TOKENS_PER_WINDOW",
    aiTokensPerWindow: "BILLING_FREE_AI_TOKENS_PER_WINDOW",
    browserbaseMinutesPerMonth: "BILLING_FREE_BROWSERBASE_MINUTES_PER_MONTH",
    concurrentScans: "BILLING_FREE_CONCURRENT_SCANS",
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
    crawlPages: "BILLING_CORE_SUPPORTER_CRAWL_PAGES",
    githubReviewTokensPerWindow:
      "BILLING_CORE_SUPPORTER_GITHUB_REVIEW_TOKENS_PER_WINDOW",
    aiTokensPerWindow: "BILLING_CORE_SUPPORTER_AI_TOKENS_PER_WINDOW",
    browserbaseMinutesPerMonth:
      "BILLING_CORE_SUPPORTER_BROWSERBASE_MINUTES_PER_MONTH",
    concurrentScans: "BILLING_CORE_SUPPORTER_CONCURRENT_SCANS",
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
    crawlPages: "BILLING_PRO_SUPPORTER_CRAWL_PAGES",
    githubReviewTokensPerWindow:
      "BILLING_PRO_SUPPORTER_GITHUB_REVIEW_TOKENS_PER_WINDOW",
    aiTokensPerWindow: "BILLING_PRO_SUPPORTER_AI_TOKENS_PER_WINDOW",
    browserbaseMinutesPerMonth:
      "BILLING_PRO_SUPPORTER_BROWSERBASE_MINUTES_PER_MONTH",
    concurrentScans: "BILLING_PRO_SUPPORTER_CONCURRENT_SCANS",
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
    crawlPages: "BILLING_ELITE_SUPPORTER_CRAWL_PAGES",
    githubReviewTokensPerWindow:
      "BILLING_ELITE_SUPPORTER_GITHUB_REVIEW_TOKENS_PER_WINDOW",
    aiTokensPerWindow: "BILLING_ELITE_SUPPORTER_AI_TOKENS_PER_WINDOW",
    browserbaseMinutesPerMonth:
      "BILLING_ELITE_SUPPORTER_BROWSERBASE_MINUTES_PER_MONTH",
    concurrentScans: "BILLING_ELITE_SUPPORTER_CONCURRENT_SCANS",
  },
};

/**
 * Null means billing is disabled entirely (unlimited). A staff caller is
 * NOT null here: it resolves to the Pro Supporter plan's real PlanLimits,
 * the same substitution getDailyLimit (lib/rate-limiting/daily-limits.ts)
 * makes for the daily scan cap.
 */
export async function getUserPlanLimits(
  userId: number,
): Promise<PlanLimits | null> {
  const billingEnabled = await getSetting("BILLING_ENABLED");
  if (!billingEnabled) return null;
  return getPlanLimitsForPlan(await getUserPlan(userId));
}

/**
 * The limits half of getUserPlanLimits, for a plan the caller has already
 * resolved. GET /api/v3/auth/me runs on every page load and already reads
 * both the users row and the gifted_subscriptions row it would take to
 * resolve the plan; going through getUserPlanLimits made it read both a
 * second time (a third time counting getSession's own users read) purely to
 * arrive at the same answer.
 *
 * Returns null when billing is disabled, the same convention
 * getUserPlanLimits uses, so a caller can treat the two identically.
 */
export async function getPlanLimitsForPlan(
  plan: Awaited<ReturnType<typeof getUserPlan>>,
): Promise<PlanLimits | null> {
  const billingEnabled = await getSetting("BILLING_ENABLED");
  if (!billingEnabled) return null;

  // Staff are capped at the Pro Supporter plan's limits, not unlimited --
  // substitute the real plan id and resolve it like a real account.
  const effectivePlan: PlanId = plan === "staff" ? "pro_supporter" : plan;

  // getUserPlan casts the raw users.plan / gifted_subscriptions.plan value with
  // no validation, so a stale or removed plan id can reach here. Fall back to
  // the free plan's keys rather than letting Object.values(undefined) throw a
  // 500 -- fail closed to the most restrictive real plan.
  const keys = PLAN_LIMIT_KEYS[effectivePlan] ?? PLAN_LIMIT_KEYS.free;
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
    crawlPages: Number(resolved[keys.crawlPages]),
    githubReviewTokensPerWindow: Number(
      resolved[keys.githubReviewTokensPerWindow],
    ),
    aiTokensPerWindow: Number(resolved[keys.aiTokensPerWindow]),
    browserbaseMinutesPerMonth: Number(
      resolved[keys.browserbaseMinutesPerMonth],
    ),
    concurrentScans: Number(resolved[keys.concurrentScans]),
  };
}

/** Every plan's limits, keyed by plan id. What the pricing table advertises. */
export type AllPlanLimits = Record<PlanId, PlanLimits>;

/**
 * Resolve every plan's limits in one settings read, for the surfaces that
 * advertise them rather than enforce them (the pricing comparison table, the
 * upgrade modal, the checkout summary).
 *
 * Those surfaces used to render lib/billing/catalog.ts's hardcoded PLANS[]
 * copy while enforcement resolved these 48 admin-editable settings, so any
 * one edit in /admin silently desynchronised what was advertised from what
 * was charged, and the table carried a comment asserting that could not
 * happen (AUDIT-011#drift-10). Reading the same resolver both halves use is
 * what actually makes that true.
 *
 * Unlike getPlanLimitsForPlan this does NOT collapse to null when billing is
 * disabled: a plan comparison still has to state each tier's numbers, and
 * "billing is off so everything is unlimited" is a fact about the deployment,
 * not about the plans.
 */
export async function getAllPlanLimits(): Promise<AllPlanLimits> {
  const everyKey = Object.values(PLAN_LIMIT_KEYS).flatMap(
    (keys) => Object.values(keys) as SettingKey[],
  );
  const resolved = await getSettings(everyKey);

  const forPlan = (planId: PlanId): PlanLimits => {
    const keys = PLAN_LIMIT_KEYS[planId];
    const shipped = PLANS.find((p) => p.id === planId)?.limits;
    // A setting that fails to resolve falls back to the shipped catalog value
    // rather than rendering NaN in a price comparison. typeof, not Number():
    // Number(null) and Number("") are both 0, and 0 is the "this tier does not
    // get the feature at all" sentinel, so coercing would advertise a missing
    // setting as a withheld feature. Every int setting resolves through
    // coerceSettingValue's zod schema, so a real value is always a number.
    const read = (field: keyof PlanLimits): number => {
      const value = resolved[keys[field]];
      return typeof value === "number" && Number.isFinite(value)
        ? value
        : (shipped?.[field] ?? 0);
    };
    return {
      dailyScans: read("dailyScans"),
      apiKeys: read("apiKeys"),
      apiRequestsPerDay: read("apiRequestsPerDay"),
      teams: read("teams"),
      teamMembers: read("teamMembers"),
      webhooks: read("webhooks"),
      scheduledScans: read("scheduledScans"),
      bulkScanUrls: read("bulkScanUrls"),
      crawlPages: read("crawlPages"),
      githubReviewTokensPerWindow: read("githubReviewTokensPerWindow"),
      aiTokensPerWindow: read("aiTokensPerWindow"),
      browserbaseMinutesPerMonth: read("browserbaseMinutesPerMonth"),
      concurrentScans: read("concurrentScans"),
    };
  };

  return {
    free: forPlan("free"),
    core_supporter: forPlan("core_supporter"),
    pro_supporter: forPlan("pro_supporter"),
    elite_supporter: forPlan("elite_supporter"),
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

/** Index into PLANS (free=0 .. elite_supporter=highest). Unknown plan ids
 *  (a stale/custom value) rank below every real plan, same fail-safe as
 *  getDailyLimitForUser's fallback-to-free lookup above. Exported for
 *  lib/billing/staff-plan.ts, which needs a raw rank comparison (not just
 *  planMeetsMinimum's boolean threshold check) to tell whether a staff
 *  account's plan was upgraded past its granted floor by a real purchase. */
export function planRank(planId: string): number {
  const idx = PLANS.findIndex((p) => p.id === planId);
  return idx === -1 ? -1 : idx;
}

/** True if `planId` is at or above `minPlan` in the plan hierarchy declared
 *  by catalog.ts's PLANS array order (free < core < pro < elite). */
export function planMeetsMinimum(planId: string, minPlan: PlanId): boolean {
  return planRank(planId) >= planRank(minPlan);
}

/**
 * Does this user's plan unlock a schedule frequency that requires
 * `minPlan` (see lib/scanner/schedule-timing.ts's FREQUENCIES)? Mirrors
 * getUserPlanLimits' "billing off = unlimited" rule so a self-hosted
 * deployment (BILLING_ENABLED=false) never hits a plan-tier wall that only
 * makes sense for the hosted SaaS. A staff caller is NOT auto-passed here:
 * it's substituted with "pro_supporter" and evaluated by planMeetsMinimum
 * like a real Pro Supporter account, the same substitution getUserPlanLimits
 * and getDailyLimit make.
 *
 * `minPlan` undefined (a frequency with no extra gate, e.g. daily/weekly/
 * monthly) always passes -- the base "can schedule at all" limit is
 * enforced separately via `scheduledScans` in getUserPlanLimits.
 */
export async function userMeetsScheduleFrequency(
  userId: number,
  minPlan: PlanId | undefined,
): Promise<boolean> {
  if (!minPlan) return true;

  const billingEnabled = await getSetting("BILLING_ENABLED");
  if (!billingEnabled) return true;

  const plan = await getUserPlan(userId);
  const effectivePlan: PlanId = plan === "staff" ? "pro_supporter" : plan;

  return planMeetsMinimum(effectivePlan, minPlan);
}

/**
 * True when the user's plan is at or above `minPlan`. Applies the same
 * "billing off = allowed" (self-host) and staff = pro_supporter substitution
 * as userMeetsScheduleFrequency, so a self-hosted deployment
 * (BILLING_ENABLED=false) never hits a plan wall.
 *
 * Used to gate the premium result-panel refreshes (DNS / ports / screenshot)
 * on the server, mirroring the client's PREMIUM_FEATURES.dns_refetch gate
 * (whose requiredPlan is "pro_supporter").
 */
export async function userMeetsMinimumPlan(
  userId: number,
  minPlan: PlanId,
): Promise<boolean> {
  const billingEnabled = await getSetting("BILLING_ENABLED");
  if (!billingEnabled) return true;

  const plan = await getUserPlan(userId);
  const effectivePlan: PlanId = plan === "staff" ? "pro_supporter" : plan;

  return planMeetsMinimum(effectivePlan, minPlan);
}
