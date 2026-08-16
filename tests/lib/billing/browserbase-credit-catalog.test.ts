import { describe, it, expect } from "vitest";
import {
  BROWSERBASE_CREDIT_TIERS,
  getBrowserbaseCreditTier,
} from "@/lib/billing/browserbase-credit-catalog";

describe("BROWSERBASE_CREDIT_TIERS", () => {
  it("ships a 4-tier ladder spanning $5 to $60", () => {
    expect(BROWSERBASE_CREDIT_TIERS).toHaveLength(4);
    expect(BROWSERBASE_CREDIT_TIERS[0]).toEqual({
      id: "browserbase_credits_30m",
      minutes: 30,
      priceInCents: 500,
    });
    expect(
      BROWSERBASE_CREDIT_TIERS[BROWSERBASE_CREDIT_TIERS.length - 1],
    ).toEqual({
      id: "browserbase_credits_500m",
      minutes: 500,
      priceInCents: 6000,
    });
  });

  it("every tier has a unique id", () => {
    const ids = BROWSERBASE_CREDIT_TIERS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is ordered cheapest to most expensive", () => {
    for (let i = 1; i < BROWSERBASE_CREDIT_TIERS.length; i++) {
      expect(BROWSERBASE_CREDIT_TIERS[i].priceInCents).toBeGreaterThan(
        BROWSERBASE_CREDIT_TIERS[i - 1].priceInCents,
      );
    }
  });

  it("is a real 'buy more, save more' ladder: minutes per dollar strictly increases with price", () => {
    const ratePerDollar = (tier: (typeof BROWSERBASE_CREDIT_TIERS)[number]) =>
      tier.minutes / (tier.priceInCents / 100);

    for (let i = 1; i < BROWSERBASE_CREDIT_TIERS.length; i++) {
      expect(ratePerDollar(BROWSERBASE_CREDIT_TIERS[i])).toBeGreaterThan(
        ratePerDollar(BROWSERBASE_CREDIT_TIERS[i - 1]),
      );
    }
  });
});

describe("getBrowserbaseCreditTier", () => {
  it("finds a tier by id", () => {
    expect(getBrowserbaseCreditTier("browserbase_credits_30m")).toEqual(
      expect.objectContaining({ minutes: 30, priceInCents: 500 }),
    );
  });

  it("returns undefined for an unknown id", () => {
    expect(getBrowserbaseCreditTier("not_a_real_tier")).toBeUndefined();
  });
});
