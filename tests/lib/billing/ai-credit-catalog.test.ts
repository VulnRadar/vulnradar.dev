import { describe, it, expect } from "vitest";
import {
  AI_CREDIT_TIERS,
  getAiCreditTier,
} from "@/lib/billing/ai-credit-catalog";

describe("AI_CREDIT_TIERS", () => {
  it("ships a 4-tier ladder spanning $10 to $100", () => {
    expect(AI_CREDIT_TIERS).toHaveLength(4);
    expect(AI_CREDIT_TIERS[0]).toEqual({
      id: "ai_credits_1m",
      tokens: 1_000_000,
      priceInCents: 1000,
    });
    expect(AI_CREDIT_TIERS[AI_CREDIT_TIERS.length - 1]).toEqual({
      id: "ai_credits_20m",
      tokens: 20_000_000,
      priceInCents: 10000,
    });
  });

  it("every tier has a unique id", () => {
    const ids = AI_CREDIT_TIERS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is ordered cheapest to most expensive", () => {
    for (let i = 1; i < AI_CREDIT_TIERS.length; i++) {
      expect(AI_CREDIT_TIERS[i].priceInCents).toBeGreaterThan(
        AI_CREDIT_TIERS[i - 1].priceInCents,
      );
    }
  });

  it("is a real 'buy more, save more' ladder: tokens per dollar strictly increases with price", () => {
    const ratePerDollar = (tier: (typeof AI_CREDIT_TIERS)[number]) =>
      tier.tokens / (tier.priceInCents / 100);

    for (let i = 1; i < AI_CREDIT_TIERS.length; i++) {
      expect(ratePerDollar(AI_CREDIT_TIERS[i])).toBeGreaterThan(
        ratePerDollar(AI_CREDIT_TIERS[i - 1]),
      );
    }
  });

  it("never reuses the retired ai_credits_500k id", () => {
    // ai_credits_500k was the old single-tier catalog's id -- an
    // already-created Stripe Price for that id must never silently match a
    // different token amount under the new ladder.
    const ids = AI_CREDIT_TIERS.map((t) => t.id);
    expect(ids).not.toContain("ai_credits_500k");
  });
});

describe("getAiCreditTier", () => {
  it("finds a tier by id", () => {
    expect(getAiCreditTier("ai_credits_1m")).toEqual(
      expect.objectContaining({ tokens: 1_000_000, priceInCents: 1000 }),
    );
  });

  it("returns undefined for an unknown id", () => {
    expect(getAiCreditTier("not_a_real_tier")).toBeUndefined();
  });

  it("returns undefined for the retired ai_credits_500k id", () => {
    expect(getAiCreditTier("ai_credits_500k")).toBeUndefined();
  });
});
