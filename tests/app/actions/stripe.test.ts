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

const mockPricesCreate = vi.fn();
const mockSubscriptionsCreate = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();
const mockSubscriptionsUpdate = vi.fn();
const mockCustomersCreate = vi.fn();

const mockGetStripe = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => mockGetStripe(),
}));

const { createSubscription } = await import("@/app/actions/stripe");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockPricesCreate.mockReset();
  mockSubscriptionsCreate.mockReset();
  mockSubscriptionsRetrieve.mockReset();
  mockSubscriptionsUpdate.mockReset();
  mockCustomersCreate.mockReset();

  mockGetSession.mockResolvedValue({ userId: 7 });
  mockGetStripe.mockReturnValue({
    prices: { create: mockPricesCreate },
    subscriptions: {
      create: mockSubscriptionsCreate,
      retrieve: mockSubscriptionsRetrieve,
      update: mockSubscriptionsUpdate,
    },
    customers: { create: mockCustomersCreate },
  });
  mockPricesCreate.mockResolvedValue({ id: "price_new" });
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
});
