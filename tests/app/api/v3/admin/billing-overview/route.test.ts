/**
 * Route-level tests for GET /api/v3/admin/billing-overview (AUDIT-010
 * admin-feature-gap: aggregate billing/subscription reporting for admins).
 *
 * Auth goes through the shared requireAdmin() (lib/auth/authorization.ts),
 * which calls getSession() and a pool.query role lookup -- both mocked
 * here rather than requireAdmin itself, the same "mock at the
 * getSession/db boundary" approach tests/app/api/v3/admin/error-logs/
 * route.test.ts uses.
 *
 * pool.query is routed by distinguishing SQL substrings rather than by
 * call order, since the route fires several queries inside a single
 * Promise.all -- routing by shape keeps the test readable and immune to
 * reordering the array in route.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const { GET } = await import("@/app/api/v3/admin/billing-overview/route");

function withAdmin(userId = 7, role = "admin") {
  mockGetSession.mockResolvedValue({ userId });
  // totp_enabled: true so requireAdmin's 2FA enforcement check
  // (ENFORCE_STAFF_2FA, see lib/auth/authorization.ts) always passes here --
  // that gate is exercised by lib/auth/authorization's own test suite, not
  // this route's.
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: userId, role, totp_enabled: true }],
  });
}

type Row = Record<string, unknown>;

interface RouteRows {
  planStatus?: Row[];
  totalUsers?: number;
  stripeCustomers?: number;
  pastDueCount?: number;
  pastDueList?: Row[];
  failedEvents?: Row[];
  failedEventsCount?: number;
  /** Reject the processed_stripe_events queries instead of resolving them. */
  failEventsTable?: boolean;
}

function routeQueries(rows: RouteRows) {
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes("GROUP BY plan, subscription_status")) {
      return Promise.resolve({ rows: rows.planStatus ?? [] });
    }
    if (sql.includes("FROM processed_stripe_events")) {
      if (rows.failEventsTable) {
        return Promise.reject(new Error("relation does not exist"));
      }
      if (sql.includes("SELECT event_id")) {
        return Promise.resolve({ rows: rows.failedEvents ?? [] });
      }
      return Promise.resolve({
        rows: [{ count: rows.failedEventsCount ?? 0 }],
      });
    }
    if (sql.includes("SELECT id, email, name, plan, current_period_end")) {
      return Promise.resolve({ rows: rows.pastDueList ?? [] });
    }
    if (sql.includes("subscription_status = 'past_due'")) {
      return Promise.resolve({ rows: [{ count: rows.pastDueCount ?? 0 }] });
    }
    if (sql.includes("stripe_customer_id IS NOT NULL")) {
      return Promise.resolve({
        rows: [{ count: rows.stripeCustomers ?? 0 }],
      });
    }
    if (sql.includes("FROM users") && !sql.includes("WHERE")) {
      return Promise.resolve({ rows: [{ count: rows.totalUsers ?? 0 }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

/** Routes by setting key so overriding BILLING_ENABLED in one test doesn't
 *  accidentally also flip ENFORCE_STAFF_2FA (requireAdmin reads that one
 *  too) and lock the mocked admin out. */
function mockSettings(overrides: Record<string, unknown> = {}) {
  mockGetSetting.mockImplementation(async (key: string) => {
    if (key in overrides) return overrides[key];
    if (key === "ENFORCE_STAFF_2FA") return false;
    if (key === "BILLING_ENABLED") return true;
    return undefined;
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSetting.mockReset();
  mockSettings();
});

describe("GET /api/v3/admin/billing-overview", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a caller below admin (e.g. support)", async () => {
    mockGetSession.mockResolvedValue({ userId: 3 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, role: "support" }] });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("computes plan-mix headcount and MRR from active-status subscribers only", async () => {
    withAdmin();
    routeQueries({
      planStatus: [
        { plan: "free", subscription_status: null, count: 100 },
        // A real paying Core subscriber.
        { plan: "core_supporter", subscription_status: "active", count: 4 },
        // A staff comp on Pro (lib/billing/staff-plan.ts writes `plan`
        // directly but never touches subscription_status) -- must count
        // toward headcount, not toward paying/MRR.
        { plan: "pro_supporter", subscription_status: null, count: 1 },
        // A real paying Pro subscriber, still inside Stripe's past_due
        // grace window -- ACTIVE_SUBSCRIPTION_STATUSES treats this as
        // paying, matching the rest of the codebase.
        { plan: "pro_supporter", subscription_status: "past_due", count: 1 },
        // A canceled Elite subscriber whose plan hasn't rolled back to
        // free (shouldn't happen given the webhook's downgrade-on-cancel
        // behavior, but must not be double-counted as paying if it does).
        { plan: "elite_supporter", subscription_status: "canceled", count: 1 },
      ],
      totalUsers: 108,
      stripeCustomers: 6,
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.billingEnabled).toBe(true);
    expect(json.totals.totalUsers).toBe(108);
    expect(json.totals.stripeCustomers).toBe(6);
    // Paying: 4 core (active) + 1 pro (past_due). The comped pro and the
    // canceled elite are excluded.
    expect(json.totals.payingUsers).toBe(5);
    // 4 * 500 + 1 * 1000 = 3000 cents = $30.
    expect(json.totals.mrrCents).toBe(3000);

    const byId = Object.fromEntries(
      json.planMix.map((p: { planId: string }) => [p.planId, p]),
    );
    expect(byId.free.totalUsers).toBe(100);
    expect(byId.free.activeUsers).toBe(0);
    expect(byId.free.mrrCents).toBe(0);
    expect(byId.core_supporter).toMatchObject({
      totalUsers: 4,
      activeUsers: 4,
      mrrCents: 2000,
    });
    expect(byId.pro_supporter).toMatchObject({
      totalUsers: 2,
      activeUsers: 1,
      mrrCents: 1000,
    });
    expect(byId.elite_supporter).toMatchObject({
      totalUsers: 1,
      activeUsers: 0,
      mrrCents: 0,
    });
  });

  it("amortizes yearly subscribers instead of counting them at the monthly price", async () => {
    withAdmin();
    routeQueries({
      planStatus: [
        // A yearly Core subscriber. Billed 500 * 12 * 0.8 = 4800 cents up
        // front, so the monthly run-rate is 4800 / 12 = 400 cents, NOT the
        // full 500 monthly list price.
        {
          plan: "core_supporter",
          subscription_status: "active",
          billing_interval: "year",
          count: 1,
        },
        // A monthly Pro subscriber counts at the full monthly price.
        {
          plan: "pro_supporter",
          subscription_status: "active",
          billing_interval: "month",
          count: 1,
        },
        // A second yearly Pro subscriber, grouped separately by interval --
        // proves per-interval buckets within one plan are each amortized.
        {
          plan: "pro_supporter",
          subscription_status: "active",
          billing_interval: "year",
          count: 1,
        },
      ],
      totalUsers: 3,
      stripeCustomers: 3,
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(
      json.planMix.map((p: { planId: string }) => [p.planId, p]),
    );
    // 400 (core yearly, amortized).
    expect(byId.core_supporter).toMatchObject({
      activeUsers: 1,
      mrrCents: 400,
    });
    // 1000 (pro monthly) + 800 (pro yearly: 1000 * 12 * 0.8 / 12) = 1800.
    expect(byId.pro_supporter).toMatchObject({
      activeUsers: 2,
      mrrCents: 1800,
    });
    // 400 + 1800 = 2200. At the old monthly-price calc this would have been
    // 500 + 1000 + 1000 = 2500, overstating MRR by the annual discount.
    expect(json.totals.mrrCents).toBe(2200);
  });

  it("reflects BILLING_ENABLED from runtime config", async () => {
    withAdmin();
    mockSettings({ BILLING_ENABLED: false });
    routeQueries({});

    const res = await GET();
    const json = await res.json();

    expect(json.billingEnabled).toBe(false);
  });

  it("maps past-due accounts and recent failed-payment webhook events", async () => {
    withAdmin();
    routeQueries({
      pastDueCount: 1,
      pastDueList: [
        {
          id: 42,
          email: "late@example.com",
          name: "Late Payer",
          plan: "pro_supporter",
          current_period_end: "2026-08-01T00:00:00Z",
        },
      ],
      failedEventsCount: 3,
      failedEvents: [
        {
          event_id: "evt_1",
          event_type: "invoice.payment_failed",
          processed_at: "2026-08-10T00:00:00Z",
        },
      ],
    });

    const res = await GET();
    const json = await res.json();

    expect(json.totals.pastDueUsers).toBe(1);
    expect(json.failedPayments.pastDueUsers).toEqual([
      {
        id: 42,
        email: "late@example.com",
        name: "Late Payer",
        plan: "pro_supporter",
        currentPeriodEnd: "2026-08-01T00:00:00Z",
      },
    ]);
    expect(json.failedPayments.recentEventCount30d).toBe(3);
    expect(json.failedPayments.recentEvents).toEqual([
      {
        eventId: "evt_1",
        eventType: "invoice.payment_failed",
        processedAt: "2026-08-10T00:00:00Z",
      },
    ]);
  });

  it("defaults to an empty failed-payment event log if processed_stripe_events is missing", async () => {
    withAdmin();
    routeQueries({ failEventsTable: true });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.failedPayments.recentEvents).toEqual([]);
    expect(json.failedPayments.recentEventCount30d).toBe(0);
  });

  it("returns a graceful 500 when a required query fails", async () => {
    withAdmin();
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("GROUP BY plan, subscription_status")) {
        return Promise.reject(new Error("db exploded"));
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await GET();
    expect(res.status).toBe(500);
  });
});
