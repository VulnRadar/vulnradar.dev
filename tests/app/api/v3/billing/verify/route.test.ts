import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for POST /api/v3/billing/verify. This route gates
 * sensitive Stripe billing data behind a 6-digit email code, so the
 * central question these tests answer is: can the code check be
 * bypassed by anything the client supplies (shape, a bogus extra flag,
 * a well-formed-but-wrong code)? The pg pool, the rate limiter, and the
 * Stripe SDK client are mocked at the network/database boundary; the
 * route's own validation and DB-driven verification logic run for real.
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

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  RATE_LIMITS: { billingVerify: { maxAttempts: 5, windowSeconds: 300 } },
}));

const { POST } = await import("@/app/api/v3/billing/verify/route");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetStripe.mockReset();
  mockCheckRateLimit.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 4,
    retryAfterSeconds: 0,
  });
});

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/billing/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function isSaltRowQuery(sql: string) {
  return sql.includes("SELECT id, salt FROM billing_verification_codes");
}
function isSaltedCheck(sql: string) {
  return sql.includes("($2 || $3)::bytea");
}
function isUnsaltedCheck(sql: string) {
  return sql.includes("code_hash = encode(sha256($2::bytea)");
}
function isDelete(sql: string) {
  return sql.startsWith("DELETE FROM billing_verification_codes");
}
function isUserLookup(sql: string) {
  return sql.includes(
    "SELECT stripe_customer_id, stripe_subscription_id FROM users",
  );
}

describe("POST /api/v3/billing/verify", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ code: "123456" }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 503 when Stripe is not configured", async () => {
    mockGetStripe.mockReturnValue(null);
    const res = await POST(postRequest({ code: "123456" }));
    expect(res.status).toBe(503);
  });

  it("returns 429 and never touches the DB once the rate limit is hit", async () => {
    mockGetStripe.mockReturnValue({});
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 30,
    });

    const res = await POST(postRequest({ code: "123456" }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/too many attempts/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["too short", "123"],
    ["too long", "1234567"],
    ["not a string", 123456],
    ["null", null],
  ])(
    "rejects a malformed code (%s) before ever querying the DB",
    async (_label, code) => {
      mockGetStripe.mockReturnValue({});
      const res = await POST(postRequest({ code }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid verification code format");
      expect(mockQuery).not.toHaveBeenCalled();
    },
  );

  it("a bogus extra client flag (e.g. verified: true) cannot bypass the DB check", async () => {
    mockGetStripe.mockReturnValue({});
    mockQuery.mockImplementation(async (sql: string) => {
      if (isSaltRowQuery(sql)) return { rows: [] }; // no pending code for this user
      return { rows: [] };
    });

    const res = await POST(
      postRequest({ code: "123456", verified: true, admin: true }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid or expired verification code");
  });

  it("returns 400 when there is no pending code for the user", async () => {
    mockGetStripe.mockReturnValue({});
    mockQuery.mockImplementation(async (sql: string) => {
      if (isSaltRowQuery(sql)) return { rows: [] };
      return { rows: [] };
    });

    const res = await POST(postRequest({ code: "654321" }));
    expect(res.status).toBe(400);

    expect(mockQuery.mock.calls.some((c) => isDelete(String(c[0])))).toBe(
      false,
    );
    expect(mockQuery.mock.calls.some((c) => isUserLookup(String(c[0])))).toBe(
      false,
    );
  });

  it("a well-formed but wrong code fails against a salted stored hash", async () => {
    mockGetStripe.mockReturnValue({});
    mockQuery.mockImplementation(async (sql: string) => {
      if (isSaltRowQuery(sql)) {
        return { rows: [{ id: 7, salt: "abc123salt" }] };
      }
      if (isSaltedCheck(sql)) {
        return { rows: [] }; // hash mismatch: wrong code
      }
      return { rows: [] };
    });

    const res = await POST(postRequest({ code: "999999" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid or expired verification code");
  });

  it("uses the legacy unsalted hash query for a row with salt: null", async () => {
    mockGetStripe.mockReturnValue({});
    let usedUnsaltedQuery = false;
    mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      if (isSaltRowQuery(sql)) {
        return { rows: [{ id: 9, salt: null }] };
      }
      if (isUnsaltedCheck(sql)) {
        usedUnsaltedQuery = true;
        expect(params).toEqual([9, "111222"]);
        return { rows: [{ id: 9 }] };
      }
      if (isDelete(sql)) return { rows: [] };
      if (isUserLookup(sql))
        return {
          rows: [{ stripe_customer_id: "cus_1", stripe_subscription_id: null }],
        };
      return { rows: [] };
    });

    const res = await POST(postRequest({ code: "111222" }));
    expect(usedUnsaltedQuery).toBe(true);
    // No active subscription on this user, but the code itself was valid.
    expect(res.status).toBe(404);
  });

  it("deletes the code (single-use) and returns 404 when the user has no active subscription", async () => {
    mockGetStripe.mockReturnValue({});
    mockQuery.mockImplementation(async (sql: string) => {
      if (isSaltRowQuery(sql)) return { rows: [{ id: 1, salt: "salt" }] };
      if (isSaltedCheck(sql)) return { rows: [{ id: 1 }] };
      if (isDelete(sql)) return { rows: [] };
      if (isUserLookup(sql))
        return {
          rows: [{ stripe_customer_id: "cus_1", stripe_subscription_id: null }],
        };
      return { rows: [] };
    });

    const res = await POST(postRequest({ code: "123456" }));
    expect(res.status).toBe(404);
    expect(mockQuery.mock.calls.some((c) => isDelete(String(c[0])))).toBe(true);
  });

  it("returns sensitive subscription data on a fully valid code", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      id: "sub_9",
      status: "active",
      created: 1700000000,
      start_date: 1700000000,
      cancel_at_period_end: false,
      items: {
        data: [
          {
            current_period_start: 1700000000,
            current_period_end: 1702592000,
            plan: { amount: 500, interval: "month" },
          },
        ],
      },
      customer: { email: "user@example.com", name: "User" },
      default_payment_method: {
        id: "pm_1",
        card: { brand: "visa", last4: "4242" },
      },
      latest_invoice: { id: "in_1", amount_paid: 500, status: "paid" },
    });
    mockGetStripe.mockReturnValue({ subscriptions: { retrieve } });
    mockQuery.mockImplementation(async (sql: string) => {
      if (isSaltRowQuery(sql)) return { rows: [{ id: 2, salt: "salt2" }] };
      if (isSaltedCheck(sql)) return { rows: [{ id: 2 }] };
      if (isDelete(sql)) return { rows: [] };
      if (isUserLookup(sql))
        return {
          rows: [
            { stripe_customer_id: "cus_9", stripe_subscription_id: "sub_9" },
          ],
        };
      return { rows: [] };
    });

    const res = await POST(postRequest({ code: "555555" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.sensitiveData.subscriptionId).toBe("sub_9");
    expect(json.sensitiveData.status).toBe("active");
    expect(json.sensitiveData.customer.email).toBe("user@example.com");
    expect(json.sensitiveData.stripeCustomerId).toBe("cus_9");
    expect(retrieve).toHaveBeenCalledWith(
      "sub_9",
      expect.objectContaining({ expand: expect.any(Array) }),
    );
  });

  it("returns 500 when an unexpected error is thrown", async () => {
    mockGetStripe.mockReturnValue({});
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));

    const res = await POST(postRequest({ code: "123456" }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to verify code");
  });
});
