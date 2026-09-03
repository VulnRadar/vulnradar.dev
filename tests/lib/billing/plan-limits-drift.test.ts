/**
 * The guard for AUDIT-011#drift-10.
 *
 * Plan limits exist in two places on purpose:
 *
 *   - `lib/billing/catalog.ts` PLANS[].limits, the shipped copy. It is what
 *     Stripe product descriptions read and what every advertising surface
 *     falls back to before the live values arrive.
 *   - the 48 `BILLING_*` entries in `lib/config/registry.ts`, which
 *     `lib/billing/plan-limits.ts` resolves and every route enforces against.
 *
 * The pricing table used to render the first while the API charged the
 * second, under a comment asserting the two could not drift. They could, and
 * nothing checked. The display surfaces now read the resolver, so the catalog
 * is only a fallback -- but a fallback that quotes a number the deployment
 * never shipped is its own bug, and it is exactly the failure that would go
 * unnoticed, because it only shows for the moment before the fetch lands.
 *
 * This suite is the thing that makes "they cannot drift" true: it asserts the
 * catalog copy equals the registry default for every plan and every field. A
 * change to either side alone fails here.
 *
 * Same shape as the `TOTAL_CHECKS_LABEL` / `EXACT_CHECK_CATEGORY_COUNT` guard
 * over `lib/config/check-stats.generated.ts`.
 */
import { describe, it, expect } from "vitest";
import { PLANS, type PlanId, type PlanLimits } from "@/lib/billing/catalog";
import { SETTINGS_REGISTRY, type SettingKey } from "@/lib/config/registry";

/**
 * The (plan, field) -> setting key map, copied deliberately rather than
 * imported from lib/billing/plan-limits.ts. That module is what this suite is
 * checking; importing its own map would let a wrong key pair up with a wrong
 * default and still pass. Written out, a rename on either side has to be made
 * here too, which is the point.
 */
const PLAN_LIMIT_SETTING: Record<
  PlanId,
  Record<keyof PlanLimits, SettingKey>
> = {
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

const PLAN_IDS = Object.keys(PLAN_LIMIT_SETTING) as PlanId[];

describe("catalog plan limits vs the billing settings registry", () => {
  it("covers every plan the catalog ships", () => {
    expect([...PLANS].map((p) => p.id).sort()).toEqual([...PLAN_IDS].sort());
  });

  it("covers every field of PlanLimits for every plan", () => {
    // Driven off the catalog's own object so a NEW PlanLimits field cannot be
    // added without either a registry setting or a deliberate edit here.
    const fields = Object.keys(PLANS[0].limits).sort();
    for (const planId of PLAN_IDS) {
      expect(Object.keys(PLAN_LIMIT_SETTING[planId]).sort()).toEqual(fields);
    }
  });

  it.each(PLAN_IDS)(
    "%s: every catalog limit equals its registry default",
    (planId) => {
      const plan = PLANS.find((p) => p.id === planId);
      expect(plan, `no catalog entry for plan ${planId}`).toBeDefined();

      const mapping = PLAN_LIMIT_SETTING[planId];
      for (const field of Object.keys(mapping) as (keyof PlanLimits)[]) {
        const key = mapping[field];
        const entry = SETTINGS_REGISTRY[key];
        expect(entry, `${key} is missing from SETTINGS_REGISTRY`).toBeDefined();
        expect(
          entry.default,
          `${planId}.${field}: catalog says ${plan!.limits[field]}, ${key} defaults to ${entry.default}`,
        ).toBe(plan!.limits[field]);
      }
    },
  );

  it("names a distinct setting for every plan and field", () => {
    const keys = PLAN_IDS.flatMap((planId) =>
      Object.values(PLAN_LIMIT_SETTING[planId]),
    );
    // Two plans sharing one setting key would make an admin's edit to one tier
    // silently move another tier's advertised and enforced limit together.
    expect(new Set(keys).size).toBe(keys.length);
  });
});
