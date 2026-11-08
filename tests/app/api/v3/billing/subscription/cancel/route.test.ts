import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for POST /api/v3/billing/subscription/cancel. The pg
 * pool and the Stripe SDK client (getStripe()) are mocked at the
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

const { POST } = await import("@/app/api/v3/billing/subscription/cancel/route");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetStripe.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
});

function postRequest(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/v3/billing/subscription/cancel",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function rawRequest(body?: string): NextRequest {
  return new NextRequest(
    "http://localhost/api/v3/billing/subscription/cancel",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    },
  );
}

describe("POST /api/v3/billing/subscription/cancel", () => {
  it.each([
    ["an empty body", undefined],
    ["malformed JSON", "{immediate:"],
    ["a JSON null", "null"],
    ["a JSON array", "[true]"],
    ["a JSON string", '"immediate"'],
    ["a truthy string that says false", '{"immediate":"false"}'],
    ["a truthy number", '{"immediate":1}'],
  ])("answers 400 for %s and cancels nothing", async (_label, body) => {
    const update = vi.fn();
    mockGetStripe.mockReturnValue({ subscriptions: { update } });

    const res = await POST(rawRequest(body));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual(expect.any(String));
    expect(mockQuery).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  // What 3.9.1 accepted and did correctly stays accepted: only a value that
  // would have been misread as "end it now" is refused.
  it.each([
    ["an empty object", "{}"],
    ["a null flag", '{"immediate":null}'],
    ["a zero flag", '{"immediate":0}'],
    ["an empty string flag", '{"immediate":""}'],
  ])("still cancels at the period end for %s", async (_label, body) => {
    const update = vi.fn().mockResolvedValue({});
    mockGetStripe.mockReturnValue({ subscriptions: { update } });
    mockQuery.mockResolvedValueOnce({
      rows: [{ stripe_subscription_id: "sub_1" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(rawRequest(body));

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });
  });

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ immediate: false }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 503 when Stripe is not configured", async () => {
    mockGetStripe.mockReturnValue(null);
    const res = await POST(postRequest({ immediate: false }));
    expect(res.status).toBe(503);
  });

  it("returns 404 when the user has no active subscription", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { update: vi.fn() } });
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", stripe_subscription_id: null }],
    });

    const res = await POST(postRequest({ immediate: false }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("No active subscription found");
    // Already free -- no correction UPDATE should fire.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("downgrades a stuck-on-paid account to free when there's no subscription ID to cancel, even though it still 404s", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { update: vi.fn() } });
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "core_supporter", stripe_subscription_id: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest({ immediate: false }));
    expect(res.status).toBe(404);

    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain("plan = 'free'");
    expect(updateCall[0]).toContain("subscription_status = NULL");
    expect(updateCall[1]).toEqual([42]);
  });

  it("skips the free-downgrade correction for a staff account -- a granted plan with no subscription ID is intentional, not stale", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { update: vi.fn() } });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { plan: "pro_supporter", role: "admin", stripe_subscription_id: null },
      ],
    });

    const res = await POST(postRequest({ immediate: false }));
    expect(res.status).toBe(404);
    // Only the initial SELECT ran -- no correction UPDATE for a staff account.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("immediate=true sets cancel_at to now and immediately downgrades the user to free", async () => {
    const before = Math.floor(Date.now() / 1000);
    const update = vi.fn().mockResolvedValue({});
    mockGetStripe.mockReturnValue({ subscriptions: { update } });
    mockQuery.mockResolvedValueOnce({
      rows: [{ stripe_subscription_id: "sub_1" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest({ immediate: true }));
    const after = Math.floor(Date.now() / 1000);

    expect(update).toHaveBeenCalledTimes(1);
    const [subId, payload] = update.mock.calls[0];
    expect(subId).toBe("sub_1");
    expect(typeof payload.cancel_at).toBe("number");
    expect(payload.cancel_at).toBeGreaterThanOrEqual(before);
    expect(payload.cancel_at).toBeLessThanOrEqual(after);

    // billing: plan is now a CASE on role (staff falls back to
    // pro_supporter, their granted floor, instead of free) -- see the
    // matching staff test below.
    const [sql, params] = mockQuery.mock.calls[1];
    // The staff floor is derived from lib/billing/staff-plan.ts's own
    // constants, not a hand-written role triple: the old inline CASE listed
    // three of the seven staff roles and omitted super_admin entirely, so
    // four staff roles dropped to free and super_admin lost its
    // elite_supporter floor.
    expect(sql).toContain("WHEN role = 'super_admin' THEN 'elite_supporter'");
    expect(sql).toContain("WHEN role = ANY($2::text[]) THEN 'pro_supporter'");
    expect(sql).toContain("ELSE 'free' END");
    expect(sql).toContain("subscription_status = 'canceled'");
    expect(sql).toContain("stripe_subscription_id = NULL");
    expect(params[0]).toBe(42);
    expect(params[1]).toEqual(
      expect.arrayContaining([
        "admin",
        "moderator",
        "support",
        "billing",
        "security_analyst",
        "content_manager",
        "ops",
      ]),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.message).toBe("Subscription canceled immediately");
  });

  it("immediate=false (default) only flags cancel_at_period_end and does not clear the plan or subscription id", async () => {
    const update = vi.fn().mockResolvedValue({});
    mockGetStripe.mockReturnValue({ subscriptions: { update } });
    mockQuery.mockResolvedValueOnce({
      rows: [{ stripe_subscription_id: "sub_1" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest({ immediate: false }));

    expect(update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });

    const statusUpdateCall = mockQuery.mock.calls[1];
    // Cancel-at-period-end writes 'canceling' (pending, still has access), not
    // 'canceled' (the fully-terminated string the immediate branch uses).
    expect(statusUpdateCall[0]).toContain("subscription_status = 'canceling'");
    // This route's non-immediate path never touches `plan` or clears
    // stripe_subscription_id, unlike /api/v3/billing's "cancel" action
    // (which also leaves them alone) and unlike this same route's own
    // immediate=true branch above.
    expect(statusUpdateCall[0]).not.toContain("plan = 'free'");
    expect(statusUpdateCall[0]).not.toContain("stripe_subscription_id = NULL");
    expect(statusUpdateCall[1]).toEqual([42]);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe("Subscription will be canceled at period end");
  });

  it("returns 500 when an unexpected error is thrown", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { update: vi.fn() } });
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));

    const res = await POST(postRequest({ immediate: false }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to cancel subscription");
  });
});
