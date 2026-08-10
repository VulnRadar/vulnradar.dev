import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for POST /api/v3/billing/subscription/reactivate. The
 * pg pool and the Stripe SDK client (getStripe()) are mocked at the
 * network/database boundary.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockGetStripe = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => mockGetStripe(),
}));

const { POST } =
  await import("@/app/api/v3/billing/subscription/reactivate/route");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetStripe.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
});

describe("POST /api/v3/billing/subscription/reactivate", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 503 when Stripe is not configured", async () => {
    mockGetStripe.mockReturnValue(null);
    const res = await POST();
    expect(res.status).toBe(503);
  });

  it("returns 404 when the user has no subscription", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { update: vi.fn() } });
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", stripe_subscription_id: null }],
    });

    const res = await POST();
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("No subscription found");
    // Already free -- no correction UPDATE should fire.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("downgrades a stuck-on-paid account to free when there's no subscription ID to reactivate, even though it still 404s", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { update: vi.fn() } });
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "pro_supporter", stripe_subscription_id: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST();
    expect(res.status).toBe(404);

    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain("plan = 'free'");
    expect(updateCall[0]).toContain("subscription_status = NULL");
    expect(updateCall[1]).toEqual([42]);
  });

  it("removes cancel_at_period_end and marks the user active again", async () => {
    const update = vi.fn().mockResolvedValue({});
    mockGetStripe.mockReturnValue({ subscriptions: { update } });
    mockQuery.mockResolvedValueOnce({
      rows: [{ stripe_subscription_id: "sub_1" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST();

    expect(update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: false,
    });
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("subscription_status = 'active'"),
      [42],
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.message).toBe("Subscription reactivated successfully");
  });

  it("returns 500 when an unexpected error is thrown", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { update: vi.fn() } });
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));

    const res = await POST();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to reactivate subscription");
  });
});
