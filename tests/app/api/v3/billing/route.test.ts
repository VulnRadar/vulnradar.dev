import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for GET/POST /api/v3/billing. The pg pool and the
 * Stripe SDK client (getStripe()) are mocked at the network/database
 * boundary; everything else (daily-limit calculation, gifted-subscription
 * priority, action dispatch) runs for real.
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

const mockCheckAiUsageQuota = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  checkAiUsageQuota: (...args: unknown[]) => mockCheckAiUsageQuota(...args),
}));

const mockCheckGithubReviewQuota = vi.fn();
vi.mock("@/lib/billing/github-review-usage", () => ({
  checkGithubReviewQuota: (...args: unknown[]) =>
    mockCheckGithubReviewQuota(...args),
}));

const mockSendAdminAlert = vi.fn();
vi.mock("@/lib/admin/alert-webhook", () => ({
  sendAdminAlert: (...args: unknown[]) => mockSendAdminAlert(...args),
}));

const { GET, POST } = await import("@/app/api/v3/billing/route");
const { PLAN_LIMITS } = await import("@/lib/rate-limiting/daily-limits");
const { getPlanById } = await import("@/lib/billing/catalog");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetStripe.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockSendAdminAlert.mockReset();
  mockSendAdminAlert.mockResolvedValue({ delivered: false, reason: "test" });
  mockCheckAiUsageQuota.mockReset();
  mockCheckAiUsageQuota.mockResolvedValue({
    allowed: true,
    usingOwnAi: false,
    usedTokens: 0,
    limitTokens: 20_000,
    windowStart: new Date("2026-01-01T00:00:00.000Z"),
    windowHours: 5,
    creditBalance: 0,
  });
  mockCheckGithubReviewQuota.mockReset();
  mockCheckGithubReviewQuota.mockResolvedValue({
    allowed: true,
    usingOwnAi: false,
    usedTokens: 0,
    limitTokens: 200_000,
    windowStart: new Date("2026-01-01T00:00:00.000Z"),
    windowHours: 5,
  });
  // BILLING_ENABLED now resolves through lib/config/runtime-config's
  // getSetting(), which caches its DB read for 30s at module scope.
  // Invalidate so each test's pool mock is actually consulted.
  invalidateSettingsCache();
});

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/billing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Wires the pool mock to answer every query GET /api/v3/billing (and the
 * daily-limit helpers it calls into) can issue, keyed by a SQL substring
 * rather than call order, since the exact number/order of queries varies
 * by branch (gifted sub, stripe lookup, orphaned-subscription cleanup).
 */
function setupPoolForGet(opts: {
  user?: Record<string, unknown> | null;
  gift?: Record<string, unknown> | null;
  dailyPlanRow?: Record<string, unknown> | null;
  dailyCount?: string;
}) {
  const {
    user = null,
    gift = null,
    dailyPlanRow = { plan: "free", role: "user", gifted_plan: null },
    dailyCount = "0",
  } = opts;

  mockQuery.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (
      s.includes("FROM users WHERE id = $1") &&
      s.includes("stripe_customer_id")
    ) {
      return { rows: user ? [user] : [] };
    }
    if (
      s.includes(
        "SELECT plan, expires_at, created_at FROM gifted_subscriptions",
      )
    ) {
      return { rows: gift ? [gift] : [] };
    }
    if (
      s.includes("FROM users u") &&
      s.includes("LEFT JOIN gifted_subscriptions gs")
    ) {
      return { rows: dailyPlanRow ? [dailyPlanRow] : [] };
    }
    if (s.includes('SUM("count")')) {
      return { rows: [{ total: dailyCount }] };
    }
    if (s.includes("stripe_subscription_id = NULL")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

describe("GET /api/v3/billing", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 503 when Stripe is not configured", async () => {
    mockGetStripe.mockReturnValue(null);
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("Stripe is not configured");
  });

  it("returns 404 when the user row is missing", async () => {
    mockGetStripe.mockReturnValue({});
    setupPoolForGet({ user: null });
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns plan/usage info for a plain free user with no gift and no Stripe subscription", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { retrieve: vi.fn() } });
    setupPoolForGet({
      user: {
        plan: "free",
        subscription_status: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        role: "user",
      },
      gift: null,
      dailyPlanRow: { plan: "free", role: "user", gifted_plan: null },
      dailyCount: "5",
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.billingEnabled).toBe(true);
    expect(json.plan).toBe("free");
    expect(json.subscriptionStatus).toBeNull();
    expect(json.subscription).toBeNull();
    expect(json.giftedSubscription).toBeNull();
    expect(json.usage.used).toBe(5);
    expect(json.usage.limit).toBe(PLAN_LIMITS.free);
    expect(json.usage.remaining).toBe(PLAN_LIMITS.free - 5);
    expect(json.usage.unlimited).toBe(false);
  });

  /**
   * The Billing tab's headline is the plan's display name, and it used to
   * render `billingInfo.planName` -- a field this endpoint has never returned
   * (only the email-code-gated /billing/verify does). The top line of the
   * screen that charges people money was therefore an empty paragraph for
   * every account, paid or not.
   *
   * The component now derives the name from `plan` through the catalog. These
   * two assertions are the contract that makes that work: the endpoint returns
   * a plan id, and the id is one the catalog can name.
   */
  it.each(["free", "core_supporter", "pro_supporter", "elite_supporter"])(
    "returns a catalog-nameable plan id and no planName field (%s)",
    async (plan) => {
      mockGetStripe.mockReturnValue({ subscriptions: { retrieve: vi.fn() } });
      setupPoolForGet({
        user: {
          plan,
          subscription_status: null,
          stripe_customer_id: null,
          stripe_subscription_id: null,
          role: "user",
        },
        gift: null,
        dailyPlanRow: { plan, role: "user", gifted_plan: null },
        dailyCount: "0",
      });

      const json = await (await GET()).json();

      expect(json.plan).toBe(plan);
      expect(json).not.toHaveProperty("planName");
      const name = getPlanById(json.plan)?.name;
      expect(name).toBeTruthy();
      expect(name).not.toBe(json.plan);
    },
  );

  it("includes AI verification usage from checkAiUsageQuota, with resetsAt computed from windowStart + windowHours", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { retrieve: vi.fn() } });
    setupPoolForGet({
      user: {
        plan: "free",
        subscription_status: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        role: "user",
      },
    });
    mockCheckAiUsageQuota.mockResolvedValue({
      allowed: true,
      usingOwnAi: false,
      usedTokens: 8_500,
      limitTokens: 20_000,
      windowStart: new Date("2026-01-01T00:00:00.000Z"),
      windowHours: 5,
      creditBalance: 1_200,
    });

    const res = await GET();
    const json = await res.json();

    expect(mockCheckAiUsageQuota).toHaveBeenCalledWith(42);
    expect(json.aiUsage).toEqual({
      used: 8_500,
      limit: 20_000,
      resetsAt: "2026-01-01T05:00:00.000Z",
      windowHours: 5,
      unlimited: false,
      usingOwnAi: false,
      creditBalance: 1_200,
    });
  });

  it("reports AI usage as unlimited when limitTokens is -1 (billing disabled, staff, or own AI key)", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { retrieve: vi.fn() } });
    setupPoolForGet({
      user: {
        plan: "free",
        subscription_status: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        role: "user",
      },
    });
    mockCheckAiUsageQuota.mockResolvedValue({
      allowed: true,
      usingOwnAi: true,
      usedTokens: 0,
      limitTokens: -1,
      windowStart: new Date("2026-01-01T00:00:00.000Z"),
      windowHours: 5,
      creditBalance: 0,
    });

    const res = await GET();
    const json = await res.json();

    expect(json.aiUsage.unlimited).toBe(true);
    expect(json.aiUsage.usingOwnAi).toBe(true);
  });

  it("includes GitHub review usage from checkGithubReviewQuota, with resetsAt computed from windowStart + windowHours", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { retrieve: vi.fn() } });
    setupPoolForGet({
      user: {
        plan: "core_supporter",
        subscription_status: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        role: "user",
      },
      dailyPlanRow: { plan: "core_supporter", role: "user", gifted_plan: null },
    });
    mockCheckGithubReviewQuota.mockResolvedValue({
      allowed: true,
      usingOwnAi: false,
      usedTokens: 50_000,
      limitTokens: 200_000,
      windowStart: new Date("2026-01-01T00:00:00.000Z"),
      windowHours: 5,
    });

    const res = await GET();
    const json = await res.json();

    expect(mockCheckGithubReviewQuota).toHaveBeenCalledWith(42);
    expect(json.githubReviewUsage).toEqual({
      used: 50_000,
      limit: 200_000,
      resetsAt: "2026-01-01T05:00:00.000Z",
      windowHours: 5,
      unlimited: false,
      usingOwnAi: false,
    });
  });

  it("reports GitHub review usage as unlimited when limitTokens is -1 (billing disabled, staff, or own AI key)", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { retrieve: vi.fn() } });
    setupPoolForGet({
      user: {
        plan: "free",
        subscription_status: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        role: "user",
      },
    });
    mockCheckGithubReviewQuota.mockResolvedValue({
      allowed: true,
      usingOwnAi: true,
      usedTokens: 0,
      limitTokens: -1,
      windowStart: new Date("2026-01-01T00:00:00.000Z"),
      windowHours: 5,
    });

    const res = await GET();
    const json = await res.json();

    expect(json.githubReviewUsage.unlimited).toBe(true);
    expect(json.githubReviewUsage.usingOwnAi).toBe(true);
  });

  it("prioritizes an active gifted subscription over the user's own plan", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { retrieve: vi.fn() } });
    setupPoolForGet({
      user: {
        plan: "free",
        subscription_status: "active",
        stripe_customer_id: null,
        stripe_subscription_id: null,
        role: "user",
      },
      gift: {
        plan: "pro_supporter",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2025-01-01T00:00:00.000Z",
      },
      dailyPlanRow: {
        plan: "free",
        role: "user",
        gifted_plan: "pro_supporter",
      },
      dailyCount: "0",
    });

    const res = await GET();
    const json = await res.json();

    expect(json.plan).toBe("pro_supporter");
    expect(json.subscriptionStatus).toBe("gifted");
    expect(json.giftedSubscription.plan).toBe("pro_supporter");
  });

  it("populates subscription details from a live Stripe subscription", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      id: "sub_123",
      status: "active",
      cancel_at_period_end: false,
      cancel_at: null,
      items: {
        data: [
          {
            current_period_start: 1700000000,
            current_period_end: 1702592000,
            price: {
              unit_amount: 500,
              currency: "usd",
              recurring: { interval: "month", interval_count: 1 },
            },
          },
        ],
      },
      default_payment_method: {
        card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
      },
      latest_invoice: {
        amount_paid: 500,
        status: "paid",
        paid: true,
        created: 1700000000,
      },
    });
    mockGetStripe.mockReturnValue({ subscriptions: { retrieve } });
    setupPoolForGet({
      user: {
        plan: "core_supporter",
        subscription_status: "active",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_123",
        role: "user",
      },
      dailyPlanRow: { plan: "core_supporter", role: "user", gifted_plan: null },
    });

    const res = await GET();
    const json = await res.json();

    expect(retrieve).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        expand: expect.arrayContaining([
          "default_payment_method",
          "latest_invoice",
        ]),
      }),
    );
    expect(res.status).toBe(200);
    expect(json.subscription).not.toBeNull();
    expect(json.subscription.id).toBe("sub_123");
    expect(json.subscription.status).toBe("active");
    expect(json.subscription.cardBrand).toBe("visa");
    expect(json.subscription.cardLast4).toBe("4242");
  });

  it("clears an orphaned subscription id when Stripe reports resource_missing, downgrades to free in the same response, and still returns 200", async () => {
    const retrieve = vi.fn().mockRejectedValue({ code: "resource_missing" });
    mockGetStripe.mockReturnValue({ subscriptions: { retrieve } });
    setupPoolForGet({
      user: {
        plan: "core_supporter",
        subscription_status: "active",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_gone",
        role: "user",
      },
      dailyPlanRow: { plan: "core_supporter", role: "user", gifted_plan: null },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.subscription).toBeNull();
    // The whole point of the fix: a subscription Stripe no longer
    // recognizes (e.g. a dangling ID left behind by a database migration
    // from a different Stripe account/mode) must downgrade the user, not
    // just clear the dangling ID and leave them on their old paid plan
    // forever with no webhook ever able to fire for an ID Stripe doesn't
    // know about.
    expect(json.plan).toBe("free");

    const cleanupCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("stripe_subscription_id = NULL"),
    );
    expect(cleanupCall).toBeDefined();
    // billing: the fallback plan is now parameterized (not a literal
    // 'free') so a staff account falls back to pro_supporter instead --
    // see the matching staff test below.
    expect(cleanupCall?.[0]).toContain("plan = $1");
    expect(cleanupCall?.[0]).toContain("subscription_status = NULL");
    expect(cleanupCall?.[1]).toEqual(["free", 42]);
  });

  it("clears an orphaned subscription id for a staff account by downgrading to pro_supporter, not free", async () => {
    // billing: a staff account (lib/billing/staff-plan.ts) already holds a
    // real, granted pro_supporter floor -- a dangling subscription
    // reference clears back to that floor, not all the way to free.
    const retrieve = vi.fn().mockRejectedValue({ code: "resource_missing" });
    mockGetStripe.mockReturnValue({ subscriptions: { retrieve } });
    setupPoolForGet({
      user: {
        plan: "elite_supporter",
        subscription_status: "active",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_gone",
        role: "admin",
      },
      dailyPlanRow: { plan: "free", role: "admin", gifted_plan: null },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.plan).toBe("pro_supporter");

    const cleanupCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("stripe_subscription_id = NULL"),
    );
    expect(cleanupCall?.[1]).toEqual(["pro_supporter", 42]);
  });

  it("returns 500 when the database query fails unexpectedly", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { retrieve: vi.fn() } });
    mockQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM users WHERE id = $1")) {
        throw new Error("connection lost");
      }
      return { rows: [] };
    });

    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to fetch billing info");
  });
});

describe("POST /api/v3/billing", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ action: "cancel" }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when Stripe is not configured", async () => {
    mockGetStripe.mockReturnValue(null);
    const res = await POST(postRequest({ action: "cancel" }));
    expect(res.status).toBe(503);
  });

  it("returns 400 for an unknown action", async () => {
    mockGetStripe.mockReturnValue({});
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await POST(postRequest({ action: "not-a-real-action" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid action");
  });

  describe("action: cancel", () => {
    it("cancels at period end using an existing stripe_subscription_id", async () => {
      const update = vi.fn().mockResolvedValue({
        cancel_at: 1700000500,
        current_period_end: 1702592000,
      });
      mockGetStripe.mockReturnValue({
        subscriptions: { update, list: vi.fn() },
      });
      mockQuery.mockResolvedValueOnce({
        rows: [
          { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" },
        ],
      }); // lookup
      mockQuery.mockResolvedValueOnce({ rows: [] }); // status update

      const res = await POST(postRequest({ action: "cancel" }));

      expect(update).toHaveBeenCalledWith("sub_1", {
        cancel_at_period_end: true,
      });
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("subscription_status = 'canceling'"),
        [42],
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it("finds and persists the subscription id via the customer id when missing on the user row", async () => {
      const list = vi.fn().mockResolvedValue({ data: [{ id: "sub_found" }] });
      const update = vi
        .fn()
        .mockResolvedValue({ cancel_at: null, current_period_end: 1702592000 });
      mockGetStripe.mockReturnValue({ subscriptions: { update, list } });
      mockQuery.mockResolvedValueOnce({
        rows: [{ stripe_subscription_id: null, stripe_customer_id: "cus_1" }],
      }); // lookup
      mockQuery.mockResolvedValueOnce({ rows: [] }); // persist discovered id
      mockQuery.mockResolvedValueOnce({ rows: [] }); // status update

      const res = await POST(postRequest({ action: "cancel" }));

      expect(list).toHaveBeenCalledWith({
        customer: "cus_1",
        status: "active",
        limit: 1,
      });
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("SET stripe_subscription_id = $1"),
        ["sub_found", 42],
      );
      expect(update).toHaveBeenCalledWith("sub_found", {
        cancel_at_period_end: true,
      });
      expect(res.status).toBe(200);
    });

    it("returns 400 when no subscription can be found at all", async () => {
      const list = vi.fn().mockResolvedValue({ data: [] });
      mockGetStripe.mockReturnValue({
        subscriptions: { update: vi.fn(), list },
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ stripe_subscription_id: null, stripe_customer_id: "cus_1" }],
      });

      const res = await POST(postRequest({ action: "cancel" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("No active subscription found");
    });
  });

  describe("action: cancel_immediately", () => {
    it("cancels now and downgrades the user to free", async () => {
      const cancel = vi.fn().mockResolvedValue({});
      mockGetStripe.mockReturnValue({
        subscriptions: { cancel, list: vi.fn() },
      });
      mockQuery.mockResolvedValueOnce({
        rows: [
          { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" },
        ],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await POST(postRequest({ action: "cancel_immediately" }));

      expect(cancel).toHaveBeenCalledWith("sub_1");
      // billing: plan is now a CASE on role (staff falls back to
      // pro_supporter, their granted floor, instead of free) -- see the
      // matching test below for the staff case.
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
      expect(json.message).toBe("Subscription canceled immediately");
    });

    it("returns 400 when there is no subscription to cancel", async () => {
      mockGetStripe.mockReturnValue({
        subscriptions: { cancel: vi.fn(), list: vi.fn() },
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ stripe_subscription_id: null, stripe_customer_id: null }],
      });

      const res = await POST(postRequest({ action: "cancel_immediately" }));
      expect(res.status).toBe(400);
    });
  });

  describe("action: reactivate", () => {
    it("returns 400 when the user has no subscription", async () => {
      mockGetStripe.mockReturnValue({ subscriptions: { update: vi.fn() } });
      mockQuery.mockResolvedValueOnce({
        rows: [{ stripe_subscription_id: null }],
      });

      const res = await POST(postRequest({ action: "reactivate" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("No subscription found");
    });

    it("removes cancel_at_period_end and marks the subscription active again", async () => {
      const update = vi.fn().mockResolvedValue({});
      mockGetStripe.mockReturnValue({ subscriptions: { update } });
      mockQuery.mockResolvedValueOnce({
        rows: [{ stripe_subscription_id: "sub_1" }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await POST(postRequest({ action: "reactivate" }));

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
      expect(json.message).toBe("Subscription reactivated");
    });
  });

  it("returns 500 when an unexpected error is thrown", async () => {
    mockGetStripe.mockReturnValue({ subscriptions: { update: vi.fn() } });
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));

    const res = await POST(postRequest({ action: "cancel" }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to process request");
  });
});

/**
 * GET /api/v3/billing changes a paid account's plan when Stripe says the stored
 * subscription does not exist. That is deliberate, and it is also the one place
 * a read endpoint rewrites a user's plan, so the only acceptable version of it
 * is one that leaves a trace an operator can find. It used to leave a
 * console.warn with no user and no subscription id, which the error-log capture
 * does not even record.
 */
describe("GET /api/v3/billing: an automatic downgrade is recorded and alerted", () => {
  const savedKey = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
    vi.restoreAllMocks();
  });

  function orphanedUser(over: Record<string, unknown> = {}) {
    return {
      plan: "core_supporter",
      subscription_status: "active",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_gone",
      role: "user",
      ...over,
    };
  }

  function arrange(
    stripeError: unknown,
    user: Record<string, unknown> = orphanedUser(),
  ) {
    const retrieve = vi.fn().mockRejectedValue(stripeError);
    mockGetStripe.mockReturnValue({ subscriptions: { retrieve } });
    setupPoolForGet({
      user,
      dailyPlanRow: { plan: "free", role: user.role, gifted_plan: null },
    });
  }

  it("logs at error level with the user, the plan lost, the dangling subscription and the key's mode", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_not_a_real_key";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    arrange({ code: "resource_missing" });

    const res = await GET();
    expect(res.status).toBe(200);

    const row = errSpy.mock.calls.find(
      (c) =>
        String(c[0]).startsWith("[billing]") &&
        JSON.stringify(c[1] ?? {}).includes("sub_gone"),
    );
    expect(row).toBeDefined();
    expect(row?.[1]).toEqual({
      userId: 42,
      previousPlan: "core_supporter",
      newPlan: "free",
      staleSubscriptionId: "sub_gone",
      stripeMode: "test",
    });
    // The key itself must never reach a log line.
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(
      "sk_test_not_a_real_key",
    );
  });

  it("keeps Stripe's own error on that row, so a key from the wrong environment is visible", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stripeErr = Object.assign(
      new Error(
        "No such subscription: 'sub_gone'; a similar object exists in test mode, but a live mode key was used",
      ),
      { code: "resource_missing" },
    );
    arrange(stripeErr);

    await GET();

    const row = errSpy.mock.calls.find((c) => c.includes(stripeErr));
    expect(row).toBeDefined();
  });

  it("alerts an operator, critical when the plan actually changed", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_not_a_real_key";
    vi.spyOn(console, "error").mockImplementation(() => {});
    arrange({ code: "resource_missing" });

    await GET();

    expect(mockSendAdminAlert).toHaveBeenCalledTimes(1);
    expect(mockSendAdminAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "billing_orphaned_subscription_downgrade",
        severity: "critical",
        context: {
          userId: 42,
          previousPlan: "core_supporter",
          newPlan: "free",
          staleSubscriptionId: "sub_gone",
          stripeMode: "live",
        },
      }),
    );
  });

  it("is only a warning when the account was already on its fallback plan and only a dangling id was cleared", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    arrange(
      { code: "resource_missing" },
      orphanedUser({ plan: "free", subscription_status: null }),
    );

    await GET();

    expect(mockSendAdminAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "warning" }),
    );
  });

  it("does not alert, or downgrade, when Stripe merely could not be reached", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    arrange(Object.assign(new Error("socket hang up"), { code: "ETIMEDOUT" }));

    const res = await GET();
    expect(res.status).toBe(200);

    expect(mockSendAdminAlert).not.toHaveBeenCalled();
    expect(
      mockQuery.mock.calls.some((c) =>
        String(c[0]).includes("stripe_subscription_id = NULL"),
      ),
    ).toBe(false);
    // Still a failure somebody should see, now carrying the account.
    const row = errSpy.mock.calls.find((c) =>
      String(c[0]).startsWith("[billing]"),
    );
    expect(row?.[1]).toEqual({ userId: 42, subscriptionId: "sub_gone" });
  });

  it("never claims a downgrade that did not happen: no alert when the UPDATE itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    arrange({ code: "resource_missing" });
    const base = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (String(sql).includes("stripe_subscription_id = NULL")) {
        throw new Error("deadlock detected");
      }
      return base(sql, params);
    });

    const res = await GET();

    expect(res.status).toBe(500);
    expect(mockSendAdminAlert).not.toHaveBeenCalled();
  });

  it("reports a subscription with no period data as ONE line carrying the ids and item count, not four", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const retrieve = vi.fn().mockResolvedValue({
      id: "sub_noperiod",
      status: "active",
      items: { data: [{}, {}] },
    });
    mockGetStripe.mockReturnValue({ subscriptions: { retrieve } });
    setupPoolForGet({
      user: orphanedUser({ stripe_subscription_id: "sub_noperiod" }),
      dailyPlanRow: { plan: "core_supporter", role: "user", gifted_plan: null },
    });

    const res = await GET();
    expect(res.status).toBe(200);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][1]).toEqual({
      userId: 42,
      subscriptionId: "sub_noperiod",
      items: 2,
    });
  });

  it("is wrapped, so a failure outside the route's own try still answers 500 JSON instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetSession.mockRejectedValue(new Error("session store down"));

    const res = await GET();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toHaveProperty("error");
  });

  it("wraps POST as well", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetSession.mockRejectedValue(new Error("session store down"));

    const res = await POST(postRequest({ action: "cancel" }));

    expect(res.status).toBe(500);
  });
});
