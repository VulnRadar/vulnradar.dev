/**
 * Route-level tests for GET /api/v3/admin/queue-status (Admin > System >
 * Scanner Queue -- AUDIT-010 admin-feature-gap). Auth goes through the
 * shared requireAdmin() (lib/auth/authorization.ts), which itself calls
 * getSession() and a pool.query role lookup -- both mocked here, the same
 * "mock at the getSession/db boundary" approach
 * tests/app/api/v3/admin/error-logs/route.test.ts uses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const { GET } = await import("@/app/api/v3/admin/queue-status/route");

function withAdmin(userId = 7, role = "admin") {
  mockGetSession.mockResolvedValue({ userId });
  // totp_enabled: true short-circuits requireAdmin's 2FA-enforcement
  // check (lib/auth/authorization.ts's passesTwoFactorEnforcement) so it
  // doesn't issue a second (system_settings) query this suite doesn't
  // care about -- this route's own admin-gating is what's under test.
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: userId, role, totp_enabled: true }],
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/v3/admin/queue-status", () => {
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

  it("returns zeroed counts and null ages when the queue is empty", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.counts).toEqual({
      pending: 0,
      running: 0,
      completedLast24h: 0,
      failedLast24h: 0,
    });
    expect(json.oldestPendingAgeMs).toBeNull();
    expect(json.oldestRunningAgeMs).toBeNull();
    expect(json.recentWindowHours).toBe(24);
    expect(json.generatedAt).toBe("2026-08-13T12:00:00.000Z");
  });

  it("maps grouped rows into counts and computes ages from oldest_at", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          status: "pending",
          count: 3,
          oldest_at: "2026-08-13T11:59:00.000Z", // 60s ago
        },
        {
          status: "running",
          count: 1,
          oldest_at: "2026-08-13T11:55:00.000Z", // 5min ago
        },
        { status: "completed", count: 40, oldest_at: null },
        { status: "failed", count: 2, oldest_at: null },
      ],
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.counts).toEqual({
      pending: 3,
      running: 1,
      completedLast24h: 40,
      failedLast24h: 2,
    });
    expect(json.oldestPendingAgeMs).toBe(60_000);
    expect(json.oldestRunningAgeMs).toBe(5 * 60_000);
  });

  it("scopes pending/running to all-time and completed/failed to the 24h window", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET();

    const [sql] = mockQuery.mock.calls[1] as [string];
    expect(sql).toContain("status IN ('pending', 'running')");
    expect(sql).toContain("status IN ('completed', 'failed')");
    expect(sql).toContain("NOW() - INTERVAL '24 hours'");
    expect(sql).toContain("GROUP BY status");
  });

  it("returns a graceful 500 when the query fails", async () => {
    withAdmin();
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
