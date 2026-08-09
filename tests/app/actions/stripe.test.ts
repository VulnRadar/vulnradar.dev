import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * app/actions/stripe.ts's createSubscription() is mocked at the network/
 * database boundary: the pg pool and the Stripe SDK client returned by
 * getStripe(). Everything else (the plan lookup, the existing-subscription
 * branch) is the real code.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockSubscriptionsCreate = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();
const mockSubscriptionsUpdate = vi.fn();
const mockCustomersCreate = vi.fn();
const mockCustomersRetrieve = vi.fn();

const mockGetStripe = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => mockGetStripe(),
}));

const mockGetOrCreateStripePriceId = vi.fn();
vi.mock("@/lib/billing/stripe-catalog", () => ({
  getOrCreateStripePriceId: (...args: unknown[]) =>
    mockGetOrCreateStripePriceId(...args),
}));

const { createSubscription, confirmSubscription } =
  await import("@/app/actions/stripe");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockSubscriptionsCreate.mockReset();
  mockSubscriptionsRetrieve.mockReset();
  mockSubscriptionsUpdate.mockReset();
  mockCustomersCreate.mockReset();
  mockCustomersRetrieve.mockReset();
  mockGetOrCreateStripePriceId.mockReset();

  mockGetSession.mockResolvedValue({ userId: 7 });
  mockGetStripe.mockReturnValue({
    subscriptions: {
      create: mockSubscriptionsCreate,
      retrieve: mockSubscriptionsRetrieve,
      update: mockSubscriptionsUpdate,
    },
    customers: { create: mockCustomersCreate, retrieve: mockCustomersRetrieve },
  });
  mockGetOrCreateStripePriceId.mockResolvedValue("price_new");
  // Default: the stored stripe_customer_id (cus_1 in every fixture below)
  // still resolves, matching the common case. The one test that exercises
  // a stale id overrides this.
  mockCustomersRetrieve.mockResolvedValue({ id: "cus_1", deleted: false });
});

describe("createSubscription", () => {
  it("rejects when there is no logged-in session", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    await expect(createSubscription("core_supporter_monthly")).rejects.toThrow(
      /logged in/i,
    );
  });

  it("rejects an unknown product id", async () => {
    await expect(createSubscription("not_a_real_plan")).rejects.toThrow(
      /not found/i,
    );
  });

  it("creates a brand new subscription when the user has no existing one", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "user@example.com",
          name: "User",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: null,
          subscription_status: null,
        },
      ],
    });
    mockSubscriptionsCreate.mockResolvedValue({
      id: "sub_new",
      latest_invoice: {
        confirmation_secret: { client_secret: "secret_abc" },
      },
    });

    const result = await createSubscription("core_supporter_monthly");

    expect(result).toEqual({
      kind: "new",
      clientSecret: "secret_abc",
      subscriptionId: "sub_new",
    });
    expect(mockSubscriptionsCreate).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("reuses the catalog's Stripe price instead of creating a fresh product per checkout", async () => {
    // Regression test: createSubscription() used to call stripe.prices.create()
    // with an inline product_data on every single checkout attempt, which
    // Stripe treats as "create a brand new Product" each time -- every
    // checkout click left behind a throwaway Product in the dashboard.
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "user@example.com",
          name: "User",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: null,
          subscription_status: null,
        },
      ],
    });
    mockSubscriptionsCreate.mockResolvedValue({
      id: "sub_new",
      latest_invoice: {
        confirmation_secret: { client_secret: "secret_abc" },
      },
    });

    await createSubscription("core_supporter_monthly");

    expect(mockGetOrCreateStripePriceId).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "core_supporter_monthly" }),
    );
    expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ price: "price_new" }],
      }),
    );
  });

  it("expands latest_invoice.confirmation_secret, not just latest_invoice, when creating the subscription", async () => {
    // Regression test: `expand: ["latest_invoice"]` alone turns
    // latest_invoice into a full object but leaves confirmation_secret
    // undefined -- Stripe only populates it when the nested path is
    // expanded explicitly. That silently broke every checkout ("Failed to
    // create payment intent") despite Stripe creating the subscription and
    // PaymentIntent correctly server-side.
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "user@example.com",
          name: "User",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: null,
          subscription_status: null,
        },
      ],
    });
    mockSubscriptionsCreate.mockResolvedValue({
      id: "sub_new",
      latest_invoice: {
        confirmation_secret: { client_secret: "secret_abc" },
      },
    });

    await createSubscription("core_supporter_monthly");

    expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        expand: ["latest_invoice.confirmation_secret"],
      }),
    );
  });

  it("reports success when the subscription settled with nothing left to confirm", async () => {
    // A customer with a working default payment method already on file can
    // have the first invoice paid synchronously -- no confirmation_secret
    // to hand back, but the subscription is genuinely active, not failed.
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "user@example.com",
          name: "User",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: null,
          subscription_status: null,
        },
      ],
    });
    mockSubscriptionsCreate.mockResolvedValue({
      id: "sub_settled",
      status: "active",
      latest_invoice: { confirmation_secret: null },
    });

    const result = await createSubscription("core_supporter_monthly");

    expect(result).toEqual({
      kind: "switched",
      subscriptionId: "sub_settled",
    });
  });

  it("still throws when there is no client secret and the subscription is genuinely incomplete", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "user@example.com",
          name: "User",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: null,
          subscription_status: null,
        },
      ],
    });
    mockSubscriptionsCreate.mockResolvedValue({
      id: "sub_broken",
      status: "incomplete",
      latest_invoice: { confirmation_secret: null },
    });

    await expect(createSubscription("core_supporter_monthly")).rejects.toThrow(
      /payment intent/i,
    );
  });

  it("switches the existing active subscription in place instead of creating a second one", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "user@example.com",
          name: "User",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: "sub_existing",
          subscription_status: "active",
        },
      ],
    });
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: "sub_existing",
      status: "active",
      items: { data: [{ id: "si_existing" }] },
    });
    mockSubscriptionsUpdate.mockResolvedValue({ id: "sub_existing" });

    const result = await createSubscription("elite_supporter_monthly");

    expect(result).toEqual({
      kind: "switched",
      subscriptionId: "sub_existing",
    });
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith(
      "sub_existing",
      expect.objectContaining({
        items: [{ id: "si_existing", price: "price_new" }],
        proration_behavior: "create_prorations",
      }),
    );
  });

  it("falls back to creating a new subscription when the existing one is canceled", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "user@example.com",
          name: "User",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: "sub_old",
          subscription_status: "canceled",
        },
      ],
    });
    mockSubscriptionsCreate.mockResolvedValue({
      id: "sub_new",
      latest_invoice: {
        confirmation_secret: { client_secret: "secret_xyz" },
      },
    });

    const result = await createSubscription("core_supporter_monthly");

    expect(result.kind).toBe("new");
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mockSubscriptionsCreate).toHaveBeenCalledTimes(1);
  });

  it("re-creates the Stripe customer when the stored id no longer resolves", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "user@example.com",
          name: "User",
          stripe_customer_id: "cus_stale",
          stripe_subscription_id: null,
          subscription_status: null,
        },
      ],
    });
    // Stripe throws for a customer id it no longer recognizes -- account
    // reset, key swapped from live to test, or deleted in the dashboard.
    mockCustomersRetrieve.mockRejectedValueOnce(
      Object.assign(new Error("No such customer: 'cus_stale'"), {
        code: "resource_missing",
        param: "customer",
      }),
    );
    mockCustomersCreate.mockResolvedValueOnce({ id: "cus_fresh" });
    mockSubscriptionsCreate.mockResolvedValue({
      id: "sub_new",
      latest_invoice: {
        confirmation_secret: { client_secret: "secret_fresh" },
      },
    });

    const result = await createSubscription("core_supporter_monthly");

    expect(result.kind).toBe("new");
    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
    // The fresh id must actually be the one used for the subscription, and
    // persisted back to the row, not just created and discarded.
    expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_fresh" }),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users SET stripe_customer_id"),
      ["cus_fresh", 7],
    );
  });

  it("treats a soft-deleted Stripe customer the same as a missing one", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "user@example.com",
          name: "User",
          stripe_customer_id: "cus_deleted",
          stripe_subscription_id: null,
          subscription_status: null,
        },
      ],
    });
    mockCustomersRetrieve.mockResolvedValueOnce({
      id: "cus_deleted",
      deleted: true,
    });
    mockCustomersCreate.mockResolvedValueOnce({ id: "cus_fresh" });
    mockSubscriptionsCreate.mockResolvedValue({
      id: "sub_new",
      latest_invoice: {
        confirmation_secret: { client_secret: "secret_fresh" },
      },
    });

    const result = await createSubscription("core_supporter_monthly");

    expect(result.kind).toBe("new");
    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
  });
});

const badgeRow = { rows: [{ id: 9 }] };

describe("confirmSubscription", () => {
  it("rejects when there is no logged-in session", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    await expect(confirmSubscription("sub_1")).rejects.toThrow(/logged in/i);
  });

  it("rejects a subscription that belongs to a different account", async () => {
    // Authorization: createSubscription() always stamps the creating
    // user's id into metadata. Without this check, any logged-in user
    // could pass a stranger's subscription id and have their own account
    // upgraded off someone else's payment.
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      metadata: { userId: "999", productId: "elite_supporter_monthly" },
    });

    await expect(confirmSubscription("sub_1")).rejects.toThrow(
      /does not belong/i,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("writes the real plan and grants the badge for an active subscription", async () => {
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      metadata: { userId: "7", productId: "elite_supporter_monthly" },
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE users
    mockQuery.mockResolvedValueOnce(badgeRow); // badge SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // badge INSERT

    const result = await confirmSubscription("sub_1");

    expect(result).toEqual({ plan: "elite_supporter", active: true });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("plan = $1");
    expect(params).toEqual(["elite_supporter", "sub_1", "active", "cus_1", 7]);
    const [badgeInsertSql] = mockQuery.mock.calls[2];
    expect(badgeInsertSql).toContain("user_badges");
  });

  it("writes free and revokes the badge for a subscription that isn't paid yet", async () => {
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: "sub_1",
      status: "incomplete",
      customer: "cus_1",
      metadata: { userId: "7", productId: "elite_supporter_monthly" },
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE users
    mockQuery.mockResolvedValueOnce(badgeRow); // badge SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // badge DELETE

    const result = await confirmSubscription("sub_1");

    expect(result).toEqual({ plan: "free", active: false });
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["free", "sub_1", "incomplete", "cus_1", 7]);
    const [badgeDeleteSql] = mockQuery.mock.calls[2];
    expect(badgeDeleteSql).toContain("DELETE FROM user_badges");
  });
});
