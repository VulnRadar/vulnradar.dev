import { describe, it, expect } from "vitest";
import {
  GITHUB_CREDIT_TIERS,
  getGithubCreditTier,
} from "@/lib/billing/github-credit-catalog";

describe("GITHUB_CREDIT_TIERS", () => {
  it("ships a 4-tier ladder spanning $10 to $100, same rate as AI_CREDIT_TIERS", () => {
    expect(GITHUB_CREDIT_TIERS).toHaveLength(4);
    expect(GITHUB_CREDIT_TIERS[0]).toEqual({
      id: "github_credits_1m",
      tokens: 1_000_000,
      priceInCents: 1000,
    });
    expect(GITHUB_CREDIT_TIERS[GITHUB_CREDIT_TIERS.length - 1]).toEqual({
      id: "github_credits_20m",
      tokens: 20_000_000,
      priceInCents: 10000,
    });
  });

  it("every tier has a unique id", () => {
    const ids = GITHUB_CREDIT_TIERS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is ordered cheapest to most expensive", () => {
    for (let i = 1; i < GITHUB_CREDIT_TIERS.length; i++) {
      expect(GITHUB_CREDIT_TIERS[i].priceInCents).toBeGreaterThan(
        GITHUB_CREDIT_TIERS[i - 1].priceInCents,
      );
    }
  });

  it("is a real 'buy more, save more' ladder: tokens per dollar strictly increases with price", () => {
    const ratePerDollar = (tier: (typeof GITHUB_CREDIT_TIERS)[number]) =>
      tier.tokens / (tier.priceInCents / 100);

    for (let i = 1; i < GITHUB_CREDIT_TIERS.length; i++) {
      expect(ratePerDollar(GITHUB_CREDIT_TIERS[i])).toBeGreaterThan(
        ratePerDollar(GITHUB_CREDIT_TIERS[i - 1]),
      );
    }
  });

  it("never collides with an AI credit tier id", async () => {
    const { AI_CREDIT_TIERS } = await import("@/lib/billing/ai-credit-catalog");
    const aiIds = new Set(AI_CREDIT_TIERS.map((t) => t.id));
    for (const tier of GITHUB_CREDIT_TIERS) {
      expect(aiIds.has(tier.id)).toBe(false);
    }
  });
});

describe("getGithubCreditTier", () => {
  it("finds a tier by id", () => {
    expect(getGithubCreditTier("github_credits_1m")).toEqual(
      expect.objectContaining({ tokens: 1_000_000, priceInCents: 1000 }),
    );
  });

  it("returns undefined for an unknown id", () => {
    expect(getGithubCreditTier("not_a_real_tier")).toBeUndefined();
  });

  it("returns undefined for an AI credit tier id (separate catalogs)", () => {
    expect(getGithubCreditTier("ai_credits_1m")).toBeUndefined();
  });
});
