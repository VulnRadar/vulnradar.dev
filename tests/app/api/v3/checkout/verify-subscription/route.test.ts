/**
 * Tests for GET /api/v3/checkout/verify-subscription.
 *
 * The database and session are mocked (network/DB boundary), and Stripe is
 * mocked at the getStripe() client boundary. The route's own auth gate,
 * fallback plan logic, and its inner try/catch around the Stripe
 * verification call run for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

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

const { GET } = await import("@/app/api/v3/checkout/verify-subscription/route");

function req(sessionId?: string) {
  const url = sessionId
    ? `http://localhost/api/v3/checkout/verify-subscription?session_id=${sessionId}`
    : "http://localhost/api/v3/checkout/verify-subscription";
  return new NextRequest(url, { method: "GET" });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockGetStripe.mockReset();
  mockGetStripe.mockReturnValue(null);
});

describe("GET /api/v3/checkout/verify-subscription", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when the user row is missing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(req());
    expect(res.status).toBe(404);
  });

  it("skips Stripe verification entirely when no session_id is given", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "pro_supporter", stripe_subscription_id: "sub_1" }],
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      data: {
        plan: "pro_supporter",
        subscriptionActive: true,
        sessionVerified: false,
      },
    });
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("defaults plan to free and subscriptionActive to false when the DB plan is null", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: null, stripe_subscription_id: null }],
    });

    const res = await GET(req());
    const json = await res.json();
    expect(json.data.plan).toBe("free");
    expect(json.data.subscriptionActive).toBe(false);
  });

  it("skips Stripe verification when the user has no stripe_subscription_id, even with session_id given", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", stripe_subscription_id: null }],
    });

    const res = await GET(req("cs_test_123"));
    const json = await res.json();
    expect(json.data.sessionVerified).toBe(false);
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("returns sessionVerified: false without throwing when Stripe is not configured", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "pro_supporter", stripe_subscription_id: "sub_1" }],
    });
    mockGetStripe.mockReturnValue(null);

    const res = await GET(req("cs_test_123"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sessionVerified).toBe(false);
  });

  it("verifies the checkout session when its subscription matches the user's", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "pro_supporter", stripe_subscription_id: "sub_1" }],
    });
    const mockRetrieve = vi.fn(async () => ({ subscription: "sub_1" }));
    mockGetStripe.mockReturnValue({
      checkout: { sessions: { retrieve: mockRetrieve } },
    });

    const res = await GET(req("cs_test_123"));
    const json = await res.json();
    expect(mockRetrieve).toHaveBeenCalledWith("cs_test_123");
    expect(json.data.sessionVerified).toBe(true);
  });

  it("does not verify when the checkout session's subscription does not match", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "pro_supporter", stripe_subscription_id: "sub_1" }],
    });
    mockGetStripe.mockReturnValue({
      checkout: {
        sessions: {
          retrieve: vi.fn(async () => ({ subscription: "sub_OTHER" })),
        },
      },
    });

    const res = await GET(req("cs_test_123"));
    const json = await res.json();
    expect(json.data.sessionVerified).toBe(false);
  });

  it("swallows a Stripe retrieval failure and still returns 200 with sessionVerified: false", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "pro_supporter", stripe_subscription_id: "sub_1" }],
    });
    mockGetStripe.mockReturnValue({
      checkout: {
        sessions: {
          retrieve: vi.fn(async () => {
            throw new Error("stripe is down");
          }),
        },
      },
    });

    const res = await GET(req("cs_test_123"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sessionVerified).toBe(false);
  });

  it("returns 500 when the main database query fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to verify subscription");
  });
});
