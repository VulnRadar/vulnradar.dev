/**
 * The Stripe side of deleting an account. pool and the Stripe SDK are the
 * boundaries mocked; the choice of what to cancel and when to refuse is the
 * real code.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetStripe = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => mockGetStripe(),
}));

const { cancelSubscriptionsBeforeDeletion } =
  await import("@/lib/billing/cancel-before-deletion");

const list = vi.fn();
const retrieve = vi.fn();
const cancel = vi.fn();
let errSpy: ReturnType<typeof vi.spyOn>;

function queueBilling(
  stripe_subscription_id: string | null,
  stripe_customer_id: string | null,
) {
  mockQuery.mockResolvedValueOnce({
    rows: [{ stripe_subscription_id, stripe_customer_id }],
  });
}

const billingLogs = () =>
  errSpy.mock.calls.filter((c: unknown[]) =>
    String(c[0]).startsWith("[billing]"),
  );

beforeEach(() => {
  mockQuery.mockReset();
  mockGetStripe.mockReset();
  list.mockReset().mockResolvedValue({ data: [] });
  retrieve.mockReset();
  cancel.mockReset().mockResolvedValue({});
  mockGetStripe.mockReturnValue({ subscriptions: { list, retrieve, cancel } });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
});

describe("cancelSubscriptionsBeforeDeletion", () => {
  it("has nothing to do on a deployment with no Stripe, and does not read the account", async () => {
    mockGetStripe.mockReturnValue(null);

    await expect(cancelSubscriptionsBeforeDeletion(7)).resolves.toBe(true);

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("has nothing to do for an account that never had a subscription", async () => {
    queueBilling(null, null);

    await expect(cancelSubscriptionsBeforeDeletion(7)).resolves.toBe(true);

    expect(list).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels the subscription on the account row", async () => {
    queueBilling("sub_1", null);
    retrieve.mockResolvedValue({ id: "sub_1", status: "active" });

    await expect(cancelSubscriptionsBeforeDeletion(7)).resolves.toBe(true);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("sub_1");
  });

  it("finds a subscription the row lost track of through the customer", async () => {
    queueBilling(null, "cus_1");
    list.mockResolvedValue({ data: [{ id: "sub_9", status: "past_due" }] });

    await expect(cancelSubscriptionsBeforeDeletion(7)).resolves.toBe(true);

    expect(list).toHaveBeenCalledWith({ customer: "cus_1", limit: 100 });
    expect(cancel).toHaveBeenCalledWith("sub_9");
  });

  it("cancels every live subscription on the customer once each, not only the stored one", async () => {
    queueBilling("sub_1", "cus_1");
    list.mockResolvedValue({
      data: [
        { id: "sub_1", status: "active" },
        { id: "sub_2", status: "trialing" },
        { id: "sub_3", status: "incomplete_expired" },
      ],
    });

    await expect(cancelSubscriptionsBeforeDeletion(7)).resolves.toBe(true);

    expect(retrieve).not.toHaveBeenCalled();
    expect(cancel.mock.calls.map((c) => c[0]).sort()).toEqual([
      "sub_1",
      "sub_2",
    ]);
  });

  it("does not cancel a subscription that has already ended, so a retry after a failed delete goes through", async () => {
    queueBilling("sub_1", null);
    retrieve.mockResolvedValue({ id: "sub_1", status: "canceled" });

    await expect(cancelSubscriptionsBeforeDeletion(7)).resolves.toBe(true);

    expect(cancel).not.toHaveBeenCalled();
    expect(billingLogs()).toHaveLength(0);
  });

  it("carries on past a stored subscription or customer Stripe has no record of", async () => {
    queueBilling("sub_gone", "cus_gone");
    list.mockRejectedValue({ code: "resource_missing" });
    retrieve.mockRejectedValue({ statusCode: 404 });

    await expect(cancelSubscriptionsBeforeDeletion(7)).resolves.toBe(true);

    expect(cancel).not.toHaveBeenCalled();
  });

  it("accepts a subscription that ended between the read and the cancel", async () => {
    queueBilling("sub_1", null);
    retrieve.mockResolvedValue({ id: "sub_1", status: "active" });
    cancel.mockRejectedValue({ code: "resource_missing" });

    await expect(cancelSubscriptionsBeforeDeletion(7)).resolves.toBe(true);
  });

  it("refuses and logs when the cancel fails", async () => {
    const boom = new Error("stripe is down");
    queueBilling("sub_1", null);
    retrieve.mockResolvedValue({ id: "sub_1", status: "active" });
    cancel.mockRejectedValue(boom);

    await expect(cancelSubscriptionsBeforeDeletion(7)).resolves.toBe(false);

    expect(billingLogs()).toHaveLength(1);
    expect(billingLogs()[0]).toContain(boom);
    expect(billingLogs()[0][1]).toEqual({ userId: 7 });
  });

  it("refuses when one of several cancels fails, even though another worked", async () => {
    queueBilling(null, "cus_1");
    list.mockResolvedValue({
      data: [
        { id: "sub_1", status: "active" },
        { id: "sub_2", status: "active" },
      ],
    });
    cancel.mockResolvedValueOnce({});
    cancel.mockRejectedValueOnce(new Error("rate limited"));

    await expect(cancelSubscriptionsBeforeDeletion(7)).resolves.toBe(false);
  });

  it("refuses when Stripe cannot say what is live, rather than reading it as nothing", async () => {
    queueBilling("sub_1", "cus_1");
    list.mockRejectedValue(new Error("timeout"));

    await expect(cancelSubscriptionsBeforeDeletion(7)).resolves.toBe(false);

    expect(cancel).not.toHaveBeenCalled();
  });

  it("refuses when the stored subscription cannot be read", async () => {
    queueBilling("sub_1", null);
    retrieve.mockRejectedValue(new Error("timeout"));

    await expect(cancelSubscriptionsBeforeDeletion(7)).resolves.toBe(false);

    expect(cancel).not.toHaveBeenCalled();
  });

  it("refuses when the account's billing ids cannot be read", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    await expect(cancelSubscriptionsBeforeDeletion(7)).resolves.toBe(false);

    expect(billingLogs()).toHaveLength(1);
  });
});
