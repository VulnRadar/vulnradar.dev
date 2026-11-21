import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash, createHmac } from "node:crypto";

const SERVER_KEY = "9".repeat(64);
process.env.AUTH_SECRET = SERVER_KEY;

/** What /billing/verify/send stores for a code: HMAC under the server key. */
const keyedDigest = (salt: string, code: string) =>
  createHmac("sha256", SERVER_KEY).update(`${salt}:${code}`).digest("hex");

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
  return sql.includes(
    "SELECT id, code_hash, salt FROM billing_verification_codes",
  );
}
function isDelete(sql: string) {
  return sql.startsWith("DELETE FROM billing_verification_codes");
}
// The code never goes to the database: it is compared in Node.
function sentTheCode(code: string) {
  return mockQuery.mock.calls.some((c) =>
    ((c[1] as unknown[] | undefined) ?? []).includes(code),
  );
}
function pendingRow(id: number, code: string, salt = `salt-${id}`) {
  return { id, salt, code_hash: keyedDigest(salt, code) };
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

  it("a well-formed but wrong code fails against the stored keyed digest", async () => {
    mockGetStripe.mockReturnValue({});
    mockQuery.mockImplementation(async (sql: string) => {
      if (isSaltRowQuery(sql)) return { rows: [pendingRow(7, "123456")] };
      return { rows: [] };
    });

    const res = await POST(postRequest({ code: "123457" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid or expired verification code");
    expect(mockQuery.mock.calls.some((c) => isDelete(String(c[0])))).toBe(
      false,
    );
    expect(sentTheCode("123457")).toBe(false);
  });

  // enc-13: a salted sha256 next to its salt is the code to anyone who can
  // read the row. A row stored that way no longer verifies, and neither does
  // the unsalted shape from before AUDIT-005.
  it.each([
    [
      "the salted sha256 the route used to store",
      (salt: string, code: string) =>
        createHash("sha256").update(`${salt}${code}`).digest("hex"),
      "salt-3",
    ],
    [
      "an unkeyed sha256 of '<salt>:<code>'",
      (salt: string, code: string) =>
        createHash("sha256").update(`${salt}:${code}`).digest("hex"),
      "salt-3",
    ],
    [
      "the legacy unsalted sha256 (salt: null)",
      (_salt: string, code: string) =>
        createHash("sha256").update(code).digest("hex"),
      null,
    ],
  ])("refuses %s", async (_label, digest, salt) => {
    mockGetStripe.mockReturnValue({});
    mockQuery.mockImplementation(async (sql: string) => {
      if (isSaltRowQuery(sql)) {
        return {
          rows: [{ id: 3, salt, code_hash: digest(salt ?? "", "111222") }],
        };
      }
      if (isDelete(sql)) return { rows: [{ id: 3 }] };
      return { rows: [] };
    });

    const res = await POST(postRequest({ code: "111222" }));
    expect(res.status).toBe(400);
    expect(mockQuery.mock.calls.some((c) => isUserLookup(String(c[0])))).toBe(
      false,
    );
  });

  it("only looks at codes that have not expired", async () => {
    mockGetStripe.mockReturnValue({});
    mockQuery.mockImplementation(async () => ({ rows: [] }));

    const res = await POST(postRequest({ code: "123456" }));

    expect(res.status).toBe(400);
    const [lookup] = mockQuery.mock.calls.find((c) =>
      isSaltRowQuery(String(c[0])),
    )!;
    expect(String(lookup)).toContain("expires_at > NOW()");
  });

  it("refuses a code a concurrent request already used", async () => {
    // The row matched, but the other request deleted it first.
    mockGetStripe.mockReturnValue({});
    mockQuery.mockImplementation(async (sql: string) => {
      if (isSaltRowQuery(sql)) return { rows: [pendingRow(4, "123456")] };
      if (isDelete(sql)) return { rows: [] };
      if (isUserLookup(sql))
        return {
          rows: [{ stripe_customer_id: "cus_1", stripe_subscription_id: null }],
        };
      return { rows: [] };
    });

    const res = await POST(postRequest({ code: "123456" }));
    expect(res.status).toBe(400);
    expect(mockQuery.mock.calls.some((c) => isUserLookup(String(c[0])))).toBe(
      false,
    );
  });

  it("deletes the code (single-use) and returns 404 when the user has no active subscription", async () => {
    mockGetStripe.mockReturnValue({});
    mockQuery.mockImplementation(async (sql: string) => {
      if (isSaltRowQuery(sql)) return { rows: [pendingRow(1, "123456")] };
      if (isDelete(sql)) return { rows: [{ id: 1 }] };
      if (isUserLookup(sql))
        return {
          rows: [{ stripe_customer_id: "cus_1", stripe_subscription_id: null }],
        };
      return { rows: [] };
    });

    const res = await POST(postRequest({ code: "123456" }));
    expect(res.status).toBe(404);
    const del = mockQuery.mock.calls.find((c) => isDelete(String(c[0])));
    expect(String(del![0])).toContain("WHERE id = $1 RETURNING id");
    expect(del![1]).toEqual([1]);
    expect(sentTheCode("123456")).toBe(false);
  });

  it("refuses the same code the second time", async () => {
    mockGetStripe.mockReturnValue({});
    const rows = [pendingRow(5, "123456")];
    mockQuery.mockImplementation(async (sql: string) => {
      if (isSaltRowQuery(sql)) return { rows: [...rows] };
      if (isDelete(sql))
        return { rows: rows.splice(0, 1).map(({ id }) => ({ id })) };
      if (isUserLookup(sql))
        return {
          rows: [{ stripe_customer_id: "cus_1", stripe_subscription_id: null }],
        };
      return { rows: [] };
    });

    const first = await POST(postRequest({ code: "123456" }));
    const second = await POST(postRequest({ code: "123456" }));

    expect(first.status).toBe(404);
    expect(second.status).toBe(400);
  });

  it("refuses a code stored under a different server key", async () => {
    mockGetStripe.mockReturnValue({});
    const salt = "salt-6";
    mockQuery.mockImplementation(async (sql: string) => {
      if (isSaltRowQuery(sql)) {
        return {
          rows: [
            {
              id: 6,
              salt,
              code_hash: createHmac("sha256", "8".repeat(64))
                .update(`${salt}:123456`)
                .digest("hex"),
            },
          ],
        };
      }
      if (isDelete(sql)) return { rows: [{ id: 6 }] };
      return { rows: [] };
    });

    const res = await POST(postRequest({ code: "123456" }));
    expect(res.status).toBe(400);
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
      if (isSaltRowQuery(sql)) return { rows: [pendingRow(2, "555555")] };
      if (isDelete(sql)) return { rows: [{ id: 2 }] };
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
