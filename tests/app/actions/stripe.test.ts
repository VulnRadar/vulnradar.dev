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
const mockPaymentIntentsCreate = vi.fn();
const mockPaymentIntentsRetrieve = vi.fn();
const mockBillingPortalSessionsCreate = vi.fn();

const mockGetStripe = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => mockGetStripe(),
}));

const mockGetOrCreateStripePriceId = vi.fn();
vi.mock("@/lib/billing/stripe-catalog", () => ({
  getOrCreateStripePriceId: (...args: unknown[]) =>
    mockGetOrCreateStripePriceId(...args),
}));

const mockCreditAiCreditPurchase = vi.fn();
const mockGetAiCreditBalance = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  creditAiCreditPurchase: (...args: unknown[]) =>
    mockCreditAiCreditPurchase(...args),
  getAiCreditBalance: (...args: unknown[]) => mockGetAiCreditBalance(...args),
}));

const {
  createSubscription,
  confirmSubscription,
  createAiCreditPaymentIntent,
  confirmAiCreditPurchase,
  createBillingPortalSession,
} = await import("@/app/actions/stripe");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockSubscriptionsCreate.mockReset();
  mockSubscriptionsRetrieve.mockReset();
  mockSubscriptionsUpdate.mockReset();
  mockCustomersCreate.mockReset();
  mockCustomersRetrieve.mockReset();
  mockPaymentIntentsCreate.mockReset();
  mockPaymentIntentsRetrieve.mockReset();
  mockBillingPortalSessionsCreate.mockReset();
  mockGetOrCreateStripePriceId.mockReset();
  mockCreditAiCreditPurchase.mockReset();
  mockGetAiCreditBalance.mockReset();

  mockGetSession.mockResolvedValue({ userId: 7 });
  mockGetStripe.mockReturnValue({
    subscriptions: {
      create: mockSubscriptionsCreate,
      retrieve: mockSubscriptionsRetrieve,
      update: mockSubscriptionsUpdate,
    },
    customers: { create: mockCustomersCreate, retrieve: mockCustomersRetrieve },
    paymentIntents: {
      create: mockPaymentIntentsCreate,
      retrieve: mockPaymentIntentsRetrieve,
    },
    billingPortal: { sessions: { create: mockBillingPortalSessionsCreate } },
  });
  mockGetOrCreateStripePriceId.mockResolvedValue("price_new");
  mockCreditAiCreditPurchase.mockResolvedValue({ credited: true });
  mockGetAiCreditBalance.mockResolvedValue(0);
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

  it("rejects a staff account trying to buy a plan below their granted Pro Supporter floor", async () => {
    // Staff (lib/billing/staff-plan.ts) already hold a real, granted
    // pro_supporter floor on promotion -- checked server-side, not just
    // hidden in the pricing/checkout UI, since a staff member could
    // otherwise call this action directly and self-downgrade below it.
    mockGetSession.mockResolvedValueOnce({ userId: 7, role: "admin" });
    await expect(createSubscription("core_supporter_monthly")).rejects.toThrow(
      /staff/i,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("allows a staff account to buy Elite Supporter for real -- that's a genuine purchase on top of their floor", async () => {
    mockGetSession.mockResolvedValueOnce({ userId: 7, role: "admin" });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "staff@example.com",
          name: "Staff",
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

    await expect(
      createSubscription("elite_supporter_monthly"),
    ).resolves.toMatchObject({ kind: "new" });
  });

  it("moves a staff account to a plan at/below their floor in the DB, with no Stripe subscription", async () => {
    // The pricing-page bug: a staff member's granted floor is comped (no
    // Stripe customer/subscription), so a plan change to that floor or below
    // must update users.plan directly, never open a Stripe checkout that
    // would charge them for a tier their role already grants for free.
    mockGetSession.mockResolvedValueOnce({ userId: 7, role: "moderator" });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "staff@example.com",
          name: "Staff",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: null,
          subscription_status: null,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE users SET plan
    mockQuery.mockResolvedValueOnce({ rows: [{ pre_staff_plan: null }] }); // syncPreStaffPlan read

    await expect(createSubscription("pro_supporter_monthly")).resolves.toEqual({
      kind: "db_updated",
      plan: "pro_supporter",
    });
    // No Stripe subscription was created.
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
  });

  it("moves a super_admin down from Elite to Pro in the DB, with no Stripe charge", async () => {
    // The exact reported case: a super_admin (Elite floor) sees Pro as
    // "Downgrade to Pro"; clicking it must not create a paid subscription.
    mockGetSession.mockResolvedValueOnce({ userId: 7, role: "super_admin" });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "boss@example.com",
          name: "Boss",
          stripe_customer_id: null,
          stripe_subscription_id: null,
          subscription_status: null,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE users SET plan
    mockQuery.mockResolvedValueOnce({ rows: [{ pre_staff_plan: null }] }); // syncPreStaffPlan read

    await expect(createSubscription("pro_supporter_monthly")).resolves.toEqual({
      kind: "db_updated",
      plan: "pro_supporter",
    });
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
  });

  it("allows a plain user account through the staff check", async () => {
    mockGetSession.mockResolvedValueOnce({ userId: 7, role: "user" });
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

    await expect(
      createSubscription("core_supporter_monthly"),
    ).resolves.toMatchObject({ kind: "new" });
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
    expect(params).toEqual([
      "elite_supporter",
      "sub_1",
      "active",
      "cus_1",
      7,
      null,
    ]);
    const [badgeInsertSql] = mockQuery.mock.calls[2];
    expect(badgeInsertSql).toContain("user_badges");
  });

  it("records the recurring interval for a paid subscription (MRR amortization)", async () => {
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      metadata: { userId: "7", productId: "elite_supporter_yearly" },
      items: { data: [{ price: { recurring: { interval: "year" } } }] },
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE users
    mockQuery.mockResolvedValueOnce(badgeRow); // badge SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // badge INSERT

    await confirmSubscription("sub_1");

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("billing_interval = $6");
    expect(params).toEqual([
      "elite_supporter",
      "sub_1",
      "active",
      "cus_1",
      7,
      "year",
    ]);
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
    expect(params).toEqual(["free", "sub_1", "incomplete", "cus_1", 7, null]);
    const [badgeDeleteSql] = mockQuery.mock.calls[2];
    expect(badgeDeleteSql).toContain("DELETE FROM user_badges");
  });
});

describe("createAiCreditPaymentIntent", () => {
  it("rejects when there is no logged-in session", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    await expect(createAiCreditPaymentIntent("ai_credits_1m")).rejects.toThrow(
      /logged in/i,
    );
  });

  it("rejects an unknown tier id", async () => {
    await expect(
      createAiCreditPaymentIntent("not_a_real_tier"),
    ).rejects.toThrow(/not found/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("creates a real one-time PaymentIntent (mode: payment) with the tier's amount and metadata, never a Checkout Session", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "user@example.com",
          name: "User",
          stripe_customer_id: "cus_1",
        },
      ],
    });
    mockPaymentIntentsCreate.mockResolvedValue({
      id: "pi_new",
      client_secret: "pi_new_secret",
    });

    const result = await createAiCreditPaymentIntent("ai_credits_1m");

    expect(result).toEqual({
      clientSecret: "pi_new_secret",
      paymentIntentId: "pi_new",
    });
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1000,
        currency: "usd",
        customer: "cus_1",
        automatic_payment_methods: { enabled: true },
        metadata: expect.objectContaining({
          userId: "7",
          aiCreditTierId: "ai_credits_1m",
        }),
      }),
    );
  });

  it("creates a Stripe customer when the user has none yet", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { email: "new@example.com", name: "New", stripe_customer_id: null },
      ],
    });
    mockCustomersCreate.mockResolvedValueOnce({ id: "cus_new" });
    mockPaymentIntentsCreate.mockResolvedValue({
      id: "pi_new",
      client_secret: "secret",
    });

    await createAiCreditPaymentIntent("ai_credits_1m");

    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_new" }),
    );
  });

  it("re-creates the Stripe customer when the stored id no longer resolves", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "user@example.com",
          name: "User",
          stripe_customer_id: "cus_stale",
        },
      ],
    });
    mockCustomersRetrieve.mockRejectedValueOnce(
      Object.assign(new Error("No such customer: 'cus_stale'"), {
        code: "resource_missing",
      }),
    );
    mockCustomersCreate.mockResolvedValueOnce({ id: "cus_fresh" });
    mockPaymentIntentsCreate.mockResolvedValue({
      id: "pi_new",
      client_secret: "secret",
    });

    await createAiCreditPaymentIntent("ai_credits_1m");

    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_fresh" }),
    );
  });

  it("throws when the created PaymentIntent has no client secret", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: "user@example.com",
          name: "User",
          stripe_customer_id: "cus_1",
        },
      ],
    });
    mockPaymentIntentsCreate.mockResolvedValue({
      id: "pi_broken",
      client_secret: null,
    });

    await expect(createAiCreditPaymentIntent("ai_credits_1m")).rejects.toThrow(
      /payment intent/i,
    );
  });
});

describe("confirmAiCreditPurchase", () => {
  it("rejects when there is no logged-in session", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    await expect(confirmAiCreditPurchase("pi_1")).rejects.toThrow(/logged in/i);
  });

  it("rejects a PaymentIntent that belongs to a different account", async () => {
    // Authorization: createAiCreditPaymentIntent always stamps the
    // creating user's id into metadata. Without this check, any logged-in
    // user could pass a stranger's PaymentIntent id and have their own
    // account credited off someone else's payment.
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: "pi_1",
      status: "succeeded",
      metadata: { userId: "999", aiCreditTierId: "ai_credits_1m" },
    });

    await expect(confirmAiCreditPurchase("pi_1")).rejects.toThrow(
      /does not belong/i,
    );
    expect(mockCreditAiCreditPurchase).not.toHaveBeenCalled();
  });

  it("credits the balance and reports success for a succeeded PaymentIntent with a known tier", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: "pi_1",
      status: "succeeded",
      metadata: { userId: "7", aiCreditTierId: "ai_credits_1m" },
    });
    mockCreditAiCreditPurchase.mockResolvedValue({ credited: true });
    mockGetAiCreditBalance.mockResolvedValue(1_000_000);

    const result = await confirmAiCreditPurchase("pi_1");

    expect(result).toEqual({
      succeeded: true,
      tokens: 1_000_000,
      balance: 1_000_000,
    });
    expect(mockCreditAiCreditPurchase).toHaveBeenCalledWith(
      "pi_1",
      7,
      1_000_000,
    );
  });

  it("still reports success and the real balance when the webhook already won the crediting race", async () => {
    // creditAiCreditPurchase is idempotent -- this action can lose the race
    // to the payment_intent.succeeded webhook and get credited: false back,
    // but the purchase still succeeded and the UI should show that, not an
    // error.
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: "pi_1",
      status: "succeeded",
      metadata: { userId: "7", aiCreditTierId: "ai_credits_1m" },
    });
    mockCreditAiCreditPurchase.mockResolvedValue({ credited: false });
    mockGetAiCreditBalance.mockResolvedValue(1_000_000);

    const result = await confirmAiCreditPurchase("pi_1");

    expect(result).toEqual({
      succeeded: true,
      tokens: 1_000_000,
      balance: 1_000_000,
    });
  });

  it("does not credit and reports not-succeeded for a PaymentIntent that hasn't cleared yet", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: "pi_1",
      status: "processing",
      metadata: { userId: "7", aiCreditTierId: "ai_credits_1m" },
    });
    mockGetAiCreditBalance.mockResolvedValue(500);

    const result = await confirmAiCreditPurchase("pi_1");

    expect(result).toEqual({ succeeded: false, tokens: 0, balance: 500 });
    expect(mockCreditAiCreditPurchase).not.toHaveBeenCalled();
  });

  it("does not credit when the PaymentIntent succeeded but the tier id doesn't resolve", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: "pi_1",
      status: "succeeded",
      metadata: { userId: "7", aiCreditTierId: "not_a_real_tier" },
    });
    mockGetAiCreditBalance.mockResolvedValue(0);

    const result = await confirmAiCreditPurchase("pi_1");

    expect(result).toEqual({ succeeded: false, tokens: 0, balance: 0 });
    expect(mockCreditAiCreditPurchase).not.toHaveBeenCalled();
  });
});

describe("createBillingPortalSession", () => {
  it("throws when not logged in", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(createBillingPortalSession()).rejects.toThrow("logged in");
    expect(mockBillingPortalSessionsCreate).not.toHaveBeenCalled();
  });

  it("throws when Stripe is not configured", async () => {
    mockGetStripe.mockReturnValue(null);
    await expect(createBillingPortalSession()).rejects.toThrow(
      "not configured",
    );
  });

  it("throws when the user has no stored Stripe customer id (e.g. staff-granted or gifted plan)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ stripe_customer_id: null }] });
    await expect(createBillingPortalSession()).rejects.toThrow(
      "No billing account found",
    );
    expect(mockBillingPortalSessionsCreate).not.toHaveBeenCalled();
  });

  it("creates a portal session for the caller's own stored customer id and returns its URL", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ stripe_customer_id: "cus_7" }],
    });
    mockBillingPortalSessionsCreate.mockResolvedValue({
      url: "https://billing.stripe.com/session/test_123",
    });

    const result = await createBillingPortalSession();

    expect(result).toEqual({
      url: "https://billing.stripe.com/session/test_123",
    });
    expect(mockBillingPortalSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_7",
        return_url: expect.stringContaining("/profile?tab=billing"),
      }),
    );
  });
});
