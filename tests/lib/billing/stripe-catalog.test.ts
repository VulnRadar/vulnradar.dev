import { describe, it, expect, beforeEach, vi } from "vitest";
import type Stripe from "stripe";
import type { Product } from "@/lib/billing/catalog";

// "server-only" is a Next.js bundler marker package that unconditionally
// throws when loaded outside webpack's react-server condition. Under plain
// Node (vitest) it must be neutralized to load the real module.
vi.mock("server-only", () => ({}));

const { getOrCreateStripePriceId } =
  await import("@/lib/billing/stripe-catalog");

const product: Product = {
  id: "core_supporter_monthly",
  planId: "core_supporter",
  name: "Core Supporter",
  description: "Support VulnRadar development + 100 scans/day",
  priceInCents: 500,
  interval: "month",
  scansPerDay: 100,
};

const mockProductsSearch = vi.fn();
const mockProductsCreate = vi.fn();
const mockPricesList = vi.fn();
const mockPricesCreate = vi.fn();

function fakeStripe(): Stripe {
  return {
    products: { search: mockProductsSearch, create: mockProductsCreate },
    prices: { list: mockPricesList, create: mockPricesCreate },
  } as unknown as Stripe;
}

beforeEach(() => {
  mockProductsSearch.mockReset();
  mockProductsCreate.mockReset();
  mockPricesList.mockReset();
  mockPricesCreate.mockReset();
});

describe("getOrCreateStripePriceId", () => {
  it("reuses an existing product and price without creating anything", async () => {
    mockProductsSearch.mockResolvedValue({ data: [{ id: "prod_existing" }] });
    mockPricesList.mockResolvedValue({
      data: [
        {
          id: "price_existing",
          unit_amount: 500,
          recurring: { interval: "month" },
        },
      ],
    });

    const priceId = await getOrCreateStripePriceId(fakeStripe(), product);

    expect(priceId).toBe("price_existing");
    expect(mockProductsCreate).not.toHaveBeenCalled();
    expect(mockPricesCreate).not.toHaveBeenCalled();
  });

  it("creates the product once when search finds nothing, but reuses a matching price", async () => {
    mockProductsSearch.mockResolvedValue({ data: [] });
    mockProductsCreate.mockResolvedValue({ id: "prod_new" });
    mockPricesList.mockResolvedValue({
      data: [
        {
          id: "price_existing",
          unit_amount: 500,
          recurring: { interval: "month" },
        },
      ],
    });

    const priceId = await getOrCreateStripePriceId(fakeStripe(), product);

    expect(priceId).toBe("price_existing");
    expect(mockProductsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: product.name,
        metadata: expect.objectContaining({ vulnradar_id: product.id }),
      }),
    );
    expect(mockPricesCreate).not.toHaveBeenCalled();
  });

  it("creates both product and price only when neither exists yet", async () => {
    mockProductsSearch.mockResolvedValue({ data: [] });
    mockProductsCreate.mockResolvedValue({ id: "prod_new" });
    mockPricesList.mockResolvedValue({ data: [] });
    mockPricesCreate.mockResolvedValue({ id: "price_new" });

    const priceId = await getOrCreateStripePriceId(fakeStripe(), product);

    expect(priceId).toBe("price_new");
    expect(mockPricesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        product: "prod_new",
        unit_amount: 500,
        recurring: { interval: "month" },
      }),
    );
  });

  it("does not match a price on a different plan's amount even for the same product", async () => {
    // Guards against reusing a stale/wrong price if a product ever ends up
    // with prices from more than one interval or amount.
    mockProductsSearch.mockResolvedValue({ data: [{ id: "prod_existing" }] });
    mockPricesList.mockResolvedValue({
      data: [
        {
          id: "price_wrong_amount",
          unit_amount: 1000,
          recurring: { interval: "month" },
        },
        {
          id: "price_wrong_interval",
          unit_amount: 500,
          recurring: { interval: "year" },
        },
      ],
    });
    mockPricesCreate.mockResolvedValue({ id: "price_correct" });

    const priceId = await getOrCreateStripePriceId(fakeStripe(), product);

    expect(priceId).toBe("price_correct");
    expect(mockPricesCreate).toHaveBeenCalledTimes(1);
  });
});
