import { describe, it, expect } from "vitest";
import { PLANS, type PlanLimits } from "@/lib/billing/catalog";
import * as CONFIG from "@/lib/config/config-values";

/**
 * The 52 numbers that exist twice.
 *
 * Plan limits are declared in two places on purpose, and the split is
 * documented in lib/billing/plan-limits.ts: config-values.ts holds the values
 * the admin settings registry can edit and every route enforces against, and
 * catalog.ts keeps its own copy for the Stripe product descriptions and the
 * pricing-page marketing copy. Thirteen limits across four plans, written out
 * by hand on both sides.
 *
 * Nothing tied the two together. tests/lib/billing/catalog.test.ts checks that
 * catalog.ts is internally consistent with itself, which does not help: both
 * sides can be internally consistent and still disagree with each other. The
 * failure that allows is quiet and expensive - the pricing page and the
 * checkout page advertise one number while the API enforces another, and the
 * first report of it is a customer who paid for a limit they did not get.
 *
 * The mapping is DERIVED rather than listed, so this cannot go stale the way
 * a hand-written table of 52 pairs would. A new limit added to PlanLimits, or
 * a fifth plan added to PLANS, is covered the moment it exists; if its config
 * counterpart is missing, the first test below fails by name rather than the
 * pair silently going unchecked.
 *
 * `dailyScans` is the one key whose constant is not a straight snake-case of
 * its name: it predates the others and is CONFIG_BILLING_<PLAN>_LIMIT.
 */

const LIMIT_KEY_TO_CONFIG_SUFFIX = (key: string) =>
  key === "dailyScans" ? "LIMIT" : key.replace(/([A-Z])/g, "_$1").toUpperCase();

const configName = (planId: string, limitKey: string) =>
  `CONFIG_BILLING_${planId.toUpperCase()}_${LIMIT_KEY_TO_CONFIG_SUFFIX(limitKey)}`;

const configValues = CONFIG as unknown as Record<string, unknown>;

/** Every (plan, limit) pair the catalog declares. */
const PAIRS = PLANS.flatMap((plan) =>
  (Object.keys(plan.limits) as (keyof PlanLimits)[]).map((limitKey) => ({
    planId: plan.id,
    limitKey: limitKey as string,
    catalogValue: plan.limits[limitKey],
    constant: configName(plan.id, limitKey as string),
  })),
);

describe("plan limits: catalog.ts against config-values.ts", () => {
  it("has pairs to check at all", () => {
    // Guards against the derivation above silently producing an empty list,
    // which would make every assertion below vacuously pass.
    expect(PAIRS.length).toBeGreaterThanOrEqual(4 * 13);
  });

  it.each(PAIRS)(
    "$planId.$limitKey has a $constant to check against",
    ({ constant }) => {
      expect(Object.prototype.hasOwnProperty.call(configValues, constant)).toBe(
        true,
      );
    },
  );

  it.each(PAIRS)(
    "$planId.$limitKey matches $constant",
    ({ constant, catalogValue }) => {
      expect(configValues[constant]).toBe(catalogValue);
    },
  );
});
