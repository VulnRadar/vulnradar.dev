/**
 * Route-level tests for GET /api/v3/admin/health (Admin > Operations >
 * Overview -- AUDIT-014 qols-02). The two behaviours worth pinning are the
 * ones a unit test of the pure verdict logic cannot reach: per-metric
 * permission gating (a specialist role must not receive counts for a tab it
 * cannot open), and the "one failing check must not take the page down"
 * guarantee, since the whole point of this screen is that it still renders
 * when something is broken.
 *
 * Auth is mocked at the getSession/db boundary, the same way
 * tests/app/api/v3/admin/queue-status/route.test.ts does it.
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

vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: vi.fn().mockResolvedValue(false),
}));

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn(),
}));

const { GET } = await import("@/app/api/v3/admin/health/route");

/** Dispatch on SQL text: the metric queries run in one Promise.all, so
 *  there is no fixed order to line mockResolvedValueOnce up against. An
 *  override that is an Error rejects instead of resolving. */
function respondByTable(overrides: Record<string, unknown> = {}) {
  const answer = (key: string, fallback: unknown) => {
    const value = key in overrides ? overrides[key] : fallback;
    return value instanceof Error
      ? Promise.reject(value)
      : Promise.resolve(value);
  };
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes("system_error_logs")) {
      return answer("errorLogs", { rows: [{ n: 2 }] });
    }
    if (sql.includes("email_logs")) {
      return answer("email", { rows: [{ failed: 0, total: 10 }] });
    }
    if (sql.includes("security_alerts")) {
      return answer("alerts", { rows: [{ n: 0, severe: 0 }] });
    }
    if (sql.includes("support_tickets")) {
      return answer("tickets", { rows: [{ awaiting: 1, open: 4 }] });
    }
    if (sql.includes("staff_invites")) {
      return answer("invites", { rows: [{ pending: 0, expired: 0 }] });
    }
    if (sql.includes("scan_history")) {
      return answer("queue", {
        rows: [{ status: "pending", count: 2, oldest_at: null }],
      });
    }
    return Promise.resolve({ rows: [] });
  });
}

function signInAs(role: string, userId = 7) {
  mockGetSession.mockResolvedValue({ userId });
  // The FIRST query requireStaff makes is the role lookup. totp_enabled:
  // true short-circuits the 2FA-enforcement check so it does not issue a
  // second settings query this suite does not care about.
  mockQuery.mockImplementationOnce(() =>
    Promise.resolve({ rows: [{ role, totp_enabled: true }] }),
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
});

describe("GET /api/v3/admin/health", () => {
  it("requires a staff session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("gives an admin every health metric", async () => {
    signInAs("admin");
    respondByTable();

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(json).sort()).toEqual(
      [
        "backup",
        "email",
        "errorLogs",
        "generatedAt",
        "scanQueue",
        "securityAlerts",
        "staffInvites",
        "supportTickets",
      ].sort(),
    );
    expect(json.supportTickets).toEqual({ awaitingStaff: 1, open: 4 });
  });

  it("omits metrics a support role cannot open the tab for", async () => {
    // support holds MANAGE_SUPPORT_TICKETS but not TRIGGER_MAINTENANCE or
    // VIEW_ERROR_LOGS, so the mail, backup, alert and error rows must not be
    // in the payload at all -- absent, not null, so the client renders no
    // row rather than an "unknown" one.
    signInAs("support");
    respondByTable();

    const json = await (await GET()).json();

    expect(json).toHaveProperty("supportTickets");
    expect(json).not.toHaveProperty("email");
    expect(json).not.toHaveProperty("backup");
    expect(json).not.toHaveProperty("securityAlerts");
    expect(json).not.toHaveProperty("errorLogs");
  });

  it("returns null for a metric whose query failed instead of failing the request", async () => {
    signInAs("admin");
    // A deployment that has never opened the staff tab may not have the
    // lazily-created staff_invites table yet.
    respondByTable({
      invites: new Error('relation "staff_invites" does not exist'),
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.staffInvites).toBeNull();
    expect(json.supportTickets).toEqual({ awaitingStaff: 1, open: 4 });
    consoleError.mockRestore();
  });

  it("reads the scan queue into the shape the overview expects", async () => {
    signInAs("admin");
    respondByTable({
      queue: {
        rows: [
          { status: "pending", count: 3, oldest_at: null },
          { status: "running", count: 1, oldest_at: null },
          { status: "completed", count: 40, oldest_at: null },
          { status: "failed", count: 5, oldest_at: null },
        ],
      },
    });

    const json = await (await GET()).json();

    expect(json.scanQueue).toMatchObject({
      pending: 3,
      running: 1,
      completedLast24h: 40,
      failedLast24h: 5,
    });
  });
});
