import { describe, it, expect, beforeEach, vi } from "vitest";
import type Stripe from "stripe";
import type { Product } from "@/lib/billing/catalog";

// "server-only" is a Next.js bundler marker package that unconditionally
// throws when loaded outside webpack's react-server condition. Under plain
// Node (vitest) it must be neutralized to load the real module.
vi.mock("server-only", () => ({}));

const { getOrCreateStripePriceId, resolvePlanFromStripeSubscription } =
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

describe("resolvePlanFromStripeSubscription", () => {
  const mockProductsRetrieve = vi.fn();
  const stripe = {
    products: { retrieve: mockProductsRetrieve },
  } as unknown as Stripe;

  beforeEach(() => {
    mockProductsRetrieve.mockReset();
  });

  function subscription(over: Record<string, unknown>): Stripe.Subscription {
    return {
      id: "sub_1",
      metadata: {},
      ...over,
    } as unknown as Stripe.Subscription;
  }

  function priced(price: Record<string, unknown>, metadata = {}) {
    return subscription({ metadata, items: { data: [{ price }] } });
  }

  it("reads the price's own vulnradar_id first", async () => {
    const plan = await resolvePlanFromStripeSubscription(
      stripe,
      priced(
        {
          product: "prod_1",
          metadata: { vulnradar_id: "pro_supporter_monthly" },
        },
        { planId: "elite_supporter" },
      ),
    );
    expect(plan).toBe("pro_supporter");
    expect(mockProductsRetrieve).not.toHaveBeenCalled();
  });

  it("reads an expanded product's vulnradar_id without another request", async () => {
    const plan = await resolvePlanFromStripeSubscription(
      stripe,
      priced(
        {
          product: {
            id: "prod_1",
            object: "product",
            metadata: { vulnradar_id: "elite_supporter_yearly" },
          },
        },
        { productId: "core_supporter_monthly" },
      ),
    );
    expect(plan).toBe("elite_supporter");
    expect(mockProductsRetrieve).not.toHaveBeenCalled();
  });

  it("fetches a product given only by id and reads its vulnradar_id", async () => {
    mockProductsRetrieve.mockResolvedValue({
      id: "prod_1",
      metadata: { vulnradar_id: "core_supporter_monthly" },
    });
    const plan = await resolvePlanFromStripeSubscription(
      stripe,
      priced({ product: "prod_1" }),
    );
    expect(mockProductsRetrieve).toHaveBeenCalledWith("prod_1");
    expect(plan).toBe("core_supporter");
  });

  it("still understands the productId key older products were stamped with", async () => {
    mockProductsRetrieve.mockResolvedValue({
      id: "prod_old",
      metadata: { productId: "pro_supporter_monthly" },
    });
    const plan = await resolvePlanFromStripeSubscription(
      stripe,
      priced({ product: "prod_old" }),
    );
    expect(plan).toBe("pro_supporter");
  });

  it("falls back to the subscription's metadata only when the price names nothing", async () => {
    mockProductsRetrieve.mockResolvedValue({ id: "prod_1", metadata: {} });
    expect(
      await resolvePlanFromStripeSubscription(
        stripe,
        priced({ product: "prod_1" }, { planId: "elite_supporter" }),
      ),
    ).toBe("elite_supporter");
    expect(
      await resolvePlanFromStripeSubscription(
        stripe,
        priced({ product: "prod_1" }, { productId: "core_supporter_yearly" }),
      ),
    ).toBe("core_supporter");
  });

  it("answers empty, not free, when nothing names a paid plan", async () => {
    mockProductsRetrieve.mockResolvedValue({ id: "prod_1", metadata: {} });
    expect(
      await resolvePlanFromStripeSubscription(
        stripe,
        priced({ product: "prod_1" }, { planId: "free" }),
      ),
    ).toBe("");
    expect(
      await resolvePlanFromStripeSubscription(stripe, subscription({})),
    ).toBe("");
  });

  it("treats a product Stripe no longer has as naming nothing", async () => {
    mockProductsRetrieve.mockRejectedValue(
      Object.assign(new Error("No such product"), {
        code: "resource_missing",
        statusCode: 404,
      }),
    );
    expect(
      await resolvePlanFromStripeSubscription(
        stripe,
        priced({ product: "prod_gone" }, { planId: "pro_supporter" }),
      ),
    ).toBe("pro_supporter");
  });

  it("lets an unreachable Stripe fail rather than guess", async () => {
    mockProductsRetrieve.mockRejectedValue(
      Object.assign(new Error("timeout"), { statusCode: 500 }),
    );
    await expect(
      resolvePlanFromStripeSubscription(stripe, priced({ product: "prod_1" })),
    ).rejects.toThrow("timeout");
  });

  it("ignores a deleted product", async () => {
    const plan = await resolvePlanFromStripeSubscription(
      stripe,
      priced(
        { product: { id: "prod_1", object: "product", deleted: true } },
        { planId: "core_supporter" },
      ),
    );
    expect(plan).toBe("core_supporter");
  });
});
