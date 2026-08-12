import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * lib/billing/billing.ts orchestrates subscription state across the pg
 * pool and the Stripe SDK. Both are mocked at their module boundary
 * (pool.query, and getStripe()'s returned client); everything else here
 * (lib/billing/plans.ts's pure lookups) is the real code.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetStripe = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => mockGetStripe(),
}));

// Runtime-config resolves settings via the database pool in production;
// mocked here at the module boundary so it does not consume the mockQuery
// call sequence the getBillingHistory assertions below depend on. The
// shipped registry default keeps the resolved page size identical to the
// old hardcoded LIMIT 50.
vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return {
    getSetting: vi.fn(
      async (key: keyof typeof SETTINGS_REGISTRY) =>
        SETTINGS_REGISTRY[key].default,
    ),
  };
});

const {
  getUserSubscription,
  getUserPlan,
  updateUserSubscription,
  createStripeCustomer,
  createSubscriptionCheckout,
  createBillingPortalSession,
  cancelSubscription,
  recordBillingHistory,
  getBillingHistory,
  upsertSubscription,
} = await import("@/lib/billing/billing");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetStripe.mockReset();
});

/** Route pool.query by SQL shape so Promise.all-ordered calls don't matter. */
function mockUserAndGift(
  userRow: Record<string, unknown> | undefined,
  giftRow: Record<string, unknown> | undefined,
) {
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes("FROM gifted_subscriptions")) {
      return Promise.resolve({ rows: giftRow ? [giftRow] : [] });
    }
    if (sql.includes("FROM users WHERE id")) {
      return Promise.resolve({ rows: userRow ? [userRow] : [] });
    }
    if (sql.trim().startsWith("UPDATE users SET")) {
      return Promise.resolve({ rows: [] });
    }
    throw new Error(`unexpected query in test: ${sql}`);
  });
}

describe("getUserSubscription", () => {
  it("returns null when the user doesn't exist", async () => {
    mockUserAndGift(undefined, undefined);
    expect(await getUserSubscription(1)).toBeNull();
  });

  it("uses the user row when there's no gifted subscription, defaulting status to active", async () => {
    mockUserAndGift(
      {
        id: 1,
        plan: "core_supporter",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        subscription_status: null,
        current_period_end: null,
        cancel_at_period_end: false,
      },
      undefined,
    );

    const sub = await getUserSubscription(1);
    expect(sub?.plan).toBe("core_supporter");
    expect(sub?.subscriptionStatus).toBe("active");
  });

  it("prioritizes an active gifted subscription's plan and forces status to gifted", async () => {
    mockUserAndGift(
      {
        id: 1,
        plan: "free",
        stripe_customer_id: null,
        stripe_subscription_id: null,
        subscription_status: "past_due",
        current_period_end: null,
        cancel_at_period_end: false,
      },
      { plan: "elite_supporter", expires_at: new Date() },
    );

    const sub = await getUserSubscription(1);
    expect(sub?.plan).toBe("elite_supporter");
    expect(sub?.subscriptionStatus).toBe("gifted");
  });
});

describe("getUserPlan", () => {
  it("returns the free plan when the user has no subscription row", async () => {
    mockUserAndGift(undefined, undefined);
    expect((await getUserPlan(1)).id).toBe("free");
  });

  it("returns the gifted plan even if it wouldn't otherwise count as active", async () => {
    mockUserAndGift(
      { id: 1, plan: "free", subscription_status: "canceled" },
      { plan: "pro_supporter", expires_at: new Date() },
    );
    expect((await getUserPlan(1)).id).toBe("pro_supporter");
  });

  it("returns a non-free plan even when its status isn't active", async () => {
    mockUserAndGift(
      { id: 1, plan: "pro_supporter", subscription_status: "past_due" },
      undefined,
    );
    expect((await getUserPlan(1)).id).toBe("pro_supporter");
  });

  it("returns free when plan is free and status is active", async () => {
    mockUserAndGift(
      { id: 1, plan: "free", subscription_status: "active" },
      undefined,
    );
    expect((await getUserPlan(1)).id).toBe("free");
  });

  it("returns free when plan is free/falsy and status isn't active", async () => {
    mockUserAndGift(
      { id: 1, plan: null, subscription_status: "canceled" },
      undefined,
    );
    expect((await getUserPlan(1)).id).toBe("free");
  });
});

describe("updateUserSubscription", () => {
  it("builds SET clauses only for the provided fields", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await updateUserSubscription(7, {
      plan: "pro_supporter",
      cancelAtPeriodEnd: true,
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain("plan = $1");
    expect(sql).toContain("cancel_at_period_end = $2");
    expect(sql).toContain("updated_at = NOW()");
    expect(sql).toContain("WHERE id = $3");
    expect(sql).not.toContain("stripe_customer_id");
    expect(values).toEqual(["pro_supporter", true, 7]);
  });

  it("does not query at all when no fields are provided", async () => {
    await updateUserSubscription(7, {});
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("createStripeCustomer", () => {
  it("returns null and never queries when Stripe isn't configured", async () => {
    mockGetStripe.mockReturnValue(null);
    const result = await createStripeCustomer(7, "user@example.com");
    expect(result).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("creates the customer, persists the id, and returns it", async () => {
    const create = vi.fn().mockResolvedValue({ id: "cus_1" });
    mockGetStripe.mockReturnValue({ customers: { create } });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await createStripeCustomer(7, "user@example.com");

    expect(result).toBe("cus_1");
    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain("stripe_customer_id");
    expect(values).toEqual(["cus_1", 7]);
  });

  it("returns null when Stripe rejects the create call", async () => {
    const create = vi.fn().mockRejectedValue(new Error("stripe down"));
    mockGetStripe.mockReturnValue({ customers: { create } });

    const result = await createStripeCustomer(7, "user@example.com");
    expect(result).toBeNull();
  });
});

describe("createSubscriptionCheckout", () => {
  it("throws when Stripe isn't configured", async () => {
    mockGetStripe.mockReturnValue(null);
    await expect(
      createSubscriptionCheckout(
        7,
        "core_supporter",
        "u@x.com",
        "ok",
        "cancel",
      ),
    ).rejects.toThrow("Stripe is not configured");
  });

  it("throws Invalid plan for an unknown plan id", async () => {
    mockGetStripe.mockReturnValue({});
    await expect(
      createSubscriptionCheckout(7, "not_a_plan", "u@x.com", "ok", "cancel"),
    ).rejects.toThrow("Invalid plan");
  });

  it("throws Invalid plan for the free plan (zero price)", async () => {
    mockGetStripe.mockReturnValue({});
    await expect(
      createSubscriptionCheckout(7, "free", "u@x.com", "ok", "cancel"),
    ).rejects.toThrow("Invalid plan");
  });

  it("reuses an existing Stripe customer id without creating a new one", async () => {
    const customersCreate = vi.fn();
    const checkoutCreate = vi
      .fn()
      .mockResolvedValue({ url: "https://checkout.example/session" });
    mockGetStripe.mockReturnValue({
      customers: { create: customersCreate },
      checkout: { sessions: { create: checkoutCreate } },
    });
    mockUserAndGift({ id: 7, stripe_customer_id: "cus_existing" }, undefined);

    const url = await createSubscriptionCheckout(
      7,
      "core_supporter",
      "u@x.com",
      "https://ok",
      "https://cancel",
    );

    expect(url).toBe("https://checkout.example/session");
    expect(customersCreate).not.toHaveBeenCalled();
    const args = checkoutCreate.mock.calls[0][0];
    expect(args.customer).toBe("cus_existing");
    expect(args.customer_email).toBeUndefined();
  });

  it("creates a new Stripe customer when none exists, and checks out with its id", async () => {
    const customersCreate = vi.fn().mockResolvedValue({ id: "cus_new" });
    const checkoutCreate = vi
      .fn()
      .mockResolvedValue({ url: "https://checkout.example/session2" });
    mockGetStripe.mockReturnValue({
      customers: { create: customersCreate },
      checkout: { sessions: { create: checkoutCreate } },
    });
    mockUserAndGift({ id: 7, stripe_customer_id: null }, undefined);

    const url = await createSubscriptionCheckout(
      7,
      "core_supporter",
      "u@x.com",
      "https://ok",
      "https://cancel",
    );

    expect(url).toBe("https://checkout.example/session2");
    expect(customersCreate).toHaveBeenCalledTimes(1);
    const args = checkoutCreate.mock.calls[0][0];
    expect(args.customer).toBe("cus_new");
    expect(args.customer_email).toBeUndefined();
  });

  it("falls back to customer_email when Stripe customer creation fails", async () => {
    const customersCreate = vi.fn().mockRejectedValue(new Error("stripe down"));
    const checkoutCreate = vi
      .fn()
      .mockResolvedValue({ url: "https://checkout.example/session3" });
    mockGetStripe.mockReturnValue({
      customers: { create: customersCreate },
      checkout: { sessions: { create: checkoutCreate } },
    });
    mockUserAndGift({ id: 7, stripe_customer_id: null }, undefined);

    const url = await createSubscriptionCheckout(
      7,
      "core_supporter",
      "u@x.com",
      "https://ok",
      "https://cancel",
    );

    expect(url).toBe("https://checkout.example/session3");
    const args = checkoutCreate.mock.calls[0][0];
    expect(args.customer).toBeUndefined();
    expect(args.customer_email).toBe("u@x.com");
  });

  it("rethrows when Stripe rejects session creation", async () => {
    const checkoutCreate = vi.fn().mockRejectedValue(new Error("card error"));
    mockGetStripe.mockReturnValue({
      customers: { create: vi.fn() },
      checkout: { sessions: { create: checkoutCreate } },
    });
    mockUserAndGift({ id: 7, stripe_customer_id: "cus_existing" }, undefined);

    await expect(
      createSubscriptionCheckout(
        7,
        "core_supporter",
        "u@x.com",
        "https://ok",
        "https://cancel",
      ),
    ).rejects.toThrow("card error");
  });
});

describe("createBillingPortalSession", () => {
  it("throws when Stripe isn't configured", async () => {
    mockGetStripe.mockReturnValue(null);
    await expect(
      createBillingPortalSession(7, "https://return"),
    ).rejects.toThrow("Stripe is not configured");
  });

  it("throws when the user has no billing account", async () => {
    mockGetStripe.mockReturnValue({});
    mockUserAndGift({ id: 7, stripe_customer_id: null }, undefined);
    await expect(
      createBillingPortalSession(7, "https://return"),
    ).rejects.toThrow("No billing account found");
  });

  it("returns the portal session url", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ url: "https://billing.example/portal" });
    mockGetStripe.mockReturnValue({ billingPortal: { sessions: { create } } });
    mockUserAndGift({ id: 7, stripe_customer_id: "cus_1" }, undefined);

    const url = await createBillingPortalSession(7, "https://return");
    expect(url).toBe("https://billing.example/portal");
    expect(create).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://return",
    });
  });
});

describe("cancelSubscription", () => {
  it("throws when Stripe isn't configured", async () => {
    mockGetStripe.mockReturnValue(null);
    await expect(cancelSubscription(7)).rejects.toThrow(
      "Stripe is not configured",
    );
  });

  it("throws when there's no active subscription", async () => {
    mockGetStripe.mockReturnValue({});
    mockUserAndGift({ id: 7, stripe_subscription_id: null }, undefined);
    await expect(cancelSubscription(7)).rejects.toThrow(
      "No active subscription found",
    );
  });

  it("cancels at period end on Stripe and persists it", async () => {
    const update = vi.fn().mockResolvedValue({});
    mockGetStripe.mockReturnValue({ subscriptions: { update } });
    mockUserAndGift({ id: 7, stripe_subscription_id: "sub_1" }, undefined);

    await cancelSubscription(7);

    expect(update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });
    const updateCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).trim().startsWith("UPDATE users SET"),
    );
    expect(updateCall?.[1]).toEqual([true, 7]);
  });
});

describe("recordBillingHistory", () => {
  it("inserts with ON CONFLICT DO NOTHING and the right params", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await recordBillingHistory(7, "in_1", 500, "succeeded", "desc", "pdf-url");

    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (stripe_invoice_id) DO NOTHING");
    expect(values).toEqual([7, "in_1", 500, "succeeded", "desc", "pdf-url"]);
  });

  it("swallows a database error instead of throwing", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    await expect(
      recordBillingHistory(7, "in_1", 500, "succeeded"),
    ).resolves.toBeUndefined();
  });
});

describe("getBillingHistory", () => {
  it("maps rows to the camelCase shape", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          amount_cents: 500,
          currency: "usd",
          status: "succeeded",
          description: "Core Supporter",
          invoice_pdf_url: "https://pdf",
          created_at: new Date("2024-01-01"),
        },
      ],
    });

    const history = await getBillingHistory(7);
    expect(history).toEqual([
      {
        id: 1,
        amountCents: 500,
        currency: "usd",
        status: "succeeded",
        description: "Core Supporter",
        invoicePdfUrl: "https://pdf",
        createdAt: new Date("2024-01-01"),
      },
    ]);
  });

  it("returns an empty array on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    expect(await getBillingHistory(7)).toEqual([]);
  });
});

describe("upsertSubscription (backwards-compat alias)", () => {
  it("maps the status field to subscription_status", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await upsertSubscription(7, { status: "past_due" });

    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain("subscription_status = $1");
    expect(sql).not.toContain("plan = $");
    expect(values).toEqual(["past_due", 7]);
  });
});
