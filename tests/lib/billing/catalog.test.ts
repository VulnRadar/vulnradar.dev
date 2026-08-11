import { describe, it, expect } from "vitest";
import {
  PLANS,
  PRODUCTS,
  getPlanById,
  getFreePlan,
  isPaidPlan,
  getPaidPlans,
  getApiLimitForPlan,
  getPlanFromProductId,
} from "@/lib/billing/catalog";

/**
 * Pure-function tests for the billing catalog (source of truth for plans
 * and Stripe-facing products). No mocking needed: nothing here touches the
 * network or the database.
 */

describe("PLANS", () => {
  it("declares the four plan ids in order", () => {
    expect(PLANS.map((p) => p.id)).toEqual([
      "free",
      "core_supporter",
      "pro_supporter",
      "elite_supporter",
    ]);
  });

  it("free plan has zero price and only excludes team features and GitHub AI review", () => {
    const free = PLANS.find((p) => p.id === "free")!;
    expect(free.priceInCents).toBe(0);
    expect(free.limits).toEqual({
      dailyScans: 25,
      apiKeys: 1,
      apiRequestsPerDay: 25,
      // Free never gets team features or GitHub AI review, by design --
      // everything else on this plan is a real, if modest, allowance
      // rather than a paid-only "—" like these two stay.
      teams: 0,
      teamMembers: 0,
      githubReviewTokensPerWindow: 0,
      webhooks: 1,
      scheduledScans: 3,
      bulkScanUrls: 5,
      aiTokensPerWindow: 80_000,
    });
  });

  it("githubReviewTokensPerWindow is a real finite number on every plan, never -1 (unlimited)", () => {
    for (const plan of PLANS) {
      expect(plan.limits.githubReviewTokensPerWindow).toBeGreaterThanOrEqual(0);
    }
    // Even the top tier gets a real cap, unlike every other elite limit
    // above (which use -1 for unlimited).
    const elite = PLANS.find((p) => p.id === "elite_supporter")!;
    expect(elite.limits.githubReviewTokensPerWindow).toBeGreaterThan(0);
  });

  it("aiTokensPerWindow is a real finite number on every plan, never -1 (unlimited)", () => {
    for (const plan of PLANS) {
      expect(plan.limits.aiTokensPerWindow).toBeGreaterThan(0);
    }
    // Even the top tier gets a real cap, same reasoning as
    // githubReviewTokensPerWindow above.
    const elite = PLANS.find((p) => p.id === "elite_supporter")!;
    expect(elite.limits.aiTokensPerWindow).toBe(8_000_000);
  });

  it("aiTokensPerWindow increases monotonically with plan tier", () => {
    const tokens = PLANS.map((p) => p.limits.aiTokensPerWindow);
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i]).toBeGreaterThan(tokens[i - 1]);
    }
  });

  it("every paid plan has a positive price", () => {
    const paid = PLANS.filter((p) => p.id !== "free");
    expect(paid).toHaveLength(3);
    for (const plan of paid) {
      expect(plan.priceInCents).toBeGreaterThan(0);
    }
  });
});

describe("PRODUCTS (derived from PLANS)", () => {
  it("produces no products for the free plan", () => {
    const freeProducts = PRODUCTS.filter((p) => p.planId === "free");
    expect(freeProducts).toHaveLength(0);
  });

  it("produces exactly a monthly and yearly product per paid plan", () => {
    for (const plan of PLANS.filter((p) => p.id !== "free")) {
      const forPlan = PRODUCTS.filter((p) => p.planId === plan.id);
      expect(forPlan.map((p) => p.id).sort()).toEqual(
        [`${plan.id}_monthly`, `${plan.id}_yearly`].sort(),
      );
    }
  });

  it("computes the yearly price as a 20% discount off monthly * 12", () => {
    const monthly = PRODUCTS.find((p) => p.id === "core_supporter_monthly")!;
    const yearly = PRODUCTS.find((p) => p.id === "core_supporter_yearly")!;
    expect(monthly.priceInCents).toBe(500);
    expect(yearly.priceInCents).toBe(Math.round(500 * 12 * 0.8));
    expect(yearly.priceInCents).toBe(4800);
  });

  it("carries the plan's dailyScans through as scansPerDay on both variants", () => {
    const plan = getPlanById("pro_supporter")!;
    const monthly = PRODUCTS.find((p) => p.id === "pro_supporter_monthly")!;
    const yearly = PRODUCTS.find((p) => p.id === "pro_supporter_yearly")!;
    expect(monthly.scansPerDay).toBe(plan.limits.dailyScans);
    expect(yearly.scansPerDay).toBe(plan.limits.dailyScans);
  });
});

describe("getPlanById", () => {
  it("returns the matching plan", () => {
    expect(getPlanById("elite_supporter")?.name).toBe("Elite Supporter");
  });

  it("returns undefined for an unknown id", () => {
    expect(getPlanById("not_a_real_plan")).toBeUndefined();
  });
});

describe("getFreePlan", () => {
  it("returns the free plan", () => {
    expect(getFreePlan().id).toBe("free");
  });
});

describe("isPaidPlan", () => {
  it("is true for a paid plan id", () => {
    expect(isPaidPlan("core_supporter")).toBe(true);
  });

  it("is false for the free plan", () => {
    expect(isPaidPlan("free")).toBe(false);
  });

  it("is false for an unknown plan id", () => {
    expect(isPaidPlan("not_a_real_plan")).toBe(false);
  });
});

describe("getPaidPlans", () => {
  it("returns exactly the three paid plans, excluding free", () => {
    const paid = getPaidPlans();
    expect(paid.map((p) => p.id)).toEqual([
      "core_supporter",
      "pro_supporter",
      "elite_supporter",
    ]);
  });
});

describe("getApiLimitForPlan", () => {
  it("returns the plan's apiRequestsPerDay", () => {
    expect(getApiLimitForPlan("pro_supporter")).toBe(5000);
  });

  it("falls back to 25 for an unknown plan id", () => {
    expect(getApiLimitForPlan("not_a_real_plan")).toBe(25);
  });
});

describe("getPlanFromProductId", () => {
  it("maps a core_supporter product id to core_supporter", () => {
    expect(getPlanFromProductId("core_supporter_monthly")).toBe(
      "core_supporter",
    );
  });

  it("maps a pro_supporter product id to pro_supporter", () => {
    expect(getPlanFromProductId("pro_supporter_yearly")).toBe("pro_supporter");
  });

  it("maps an elite_supporter product id to elite_supporter", () => {
    expect(getPlanFromProductId("elite_supporter_monthly")).toBe(
      "elite_supporter",
    );
  });

  it("falls back to free for an unrecognized prefix", () => {
    expect(getPlanFromProductId("some_other_product")).toBe("free");
  });

  it("falls back to free for an empty string", () => {
    expect(getPlanFromProductId("")).toBe("free");
  });
});
