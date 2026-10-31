/**
 * Route-level tests for POST /api/v3/admin/cleanup (on-demand trigger for the
 * periodic database cleanup job). Auth is now `requireAdmin()` (full admin +
 * ENFORCE_STAFF_2FA), tightened from the old support-tier floor because the
 * job permanently deletes scan history past retention, audit logs, sessions,
 * and tokens. `performDatabaseCleanup` (lib/database/cleanup.ts) is mocked as
 * a business-logic boundary.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRequireAdmin = vi.fn();
const mockLogAction = vi.fn();
vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: () => mockRequireAdmin(),
  logAction: (...args: unknown[]) => mockLogAction(...args),
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const mockPerformCleanup = vi.fn();
// The real class lives in lib/database/cleanup.ts, which this suite mocks away
// whole. Same shape: an AggregateError of the failed prunes that carries the
// stats of the ones that ran.
const { MockCleanupPassError } = vi.hoisted(() => {
  class MockCleanupPassError extends AggregateError {
    stats: Record<string, number>;
    constructor(
      errors: unknown[],
      message: string,
      stats: Record<string, number>,
    ) {
      super(errors, message);
      this.stats = stats;
    }
  }
  return { MockCleanupPassError };
});
vi.mock("@/lib/database/cleanup", () => ({
  performDatabaseCleanup: (...args: unknown[]) => mockPerformCleanup(...args),
  CleanupPassError: MockCleanupPassError,
}));

const { POST } = await import("@/app/api/v3/admin/cleanup/route");

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockPerformCleanup.mockReset();
  mockLogAction.mockReset();
  mockRequireAdmin.mockResolvedValue({ id: 1, role: "admin" });
});

describe("POST /api/v3/admin/cleanup", () => {
  it("rejects a non-admin caller (requireAdmin returns null)", async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(mockPerformCleanup).not.toHaveBeenCalled();
  });

  it("runs cleanup for an admin caller and returns its stats", async () => {
    mockPerformCleanup.mockResolvedValueOnce({ sessions: 3, rateLimits: 10 });
    const res = await POST();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.stats).toEqual({ sessions: 3, rateLimits: 10 });
    expect(mockPerformCleanup).toHaveBeenCalledTimes(1);
  });

  it("returns a graceful 500 when the cleanup job fails", async () => {
    mockPerformCleanup.mockRejectedValueOnce(new Error("cleanup exploded"));
    const res = await POST();
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    // It failed before it could delete anything, so there is nothing to record.
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  // A pass that ran to the end with some prunes failing has still deleted
  // everything the others reached. Answering 500 and writing nothing would
  // leave a run that emptied most of the tables with no trace of who asked.
  it("audit-logs a pass that finished with failed prunes, then still answers 500", async () => {
    mockPerformCleanup.mockRejectedValueOnce(
      new MockCleanupPassError(
        [new Error("api_usage timed out"), new Error("email_logs timed out")],
        "2 database cleanup prune(s) failed",
        { sessions: 3, oldScans: 0, oldRateLimits: 8 },
      ),
    );
    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(mockLogAction).toHaveBeenCalledTimes(1);
    const [adminId, targetUserId, action, details, ip] =
      mockLogAction.mock.calls[0];
    expect(adminId).toBe(1);
    expect(targetUserId).toBeNull();
    expect(action).toBe("database_cleanup_run");
    expect(details).toContain("2 prune(s) failed");
    expect(details).toContain("sessions: 3");
    expect(details).toContain("oldRateLimits: 8");
    expect(details).not.toContain("oldScans");
    // The error text stays in the server log, not in the audit row.
    expect(details).not.toContain("timed out");
    expect(ip).toBe("127.0.0.1");
  });

  it("says so when a pass with failed prunes removed nothing", async () => {
    mockPerformCleanup.mockRejectedValueOnce(
      new MockCleanupPassError([new Error("x")], "1 prune(s) failed", {
        sessions: 0,
      }),
    );
    await POST();
    expect(mockLogAction.mock.calls[0][3]).toContain("nothing removed");
  });

  it("still answers 500, not an audit error, when the audit write of a failed pass fails", async () => {
    mockPerformCleanup.mockRejectedValueOnce(
      new MockCleanupPassError([new Error("x")], "1 prune(s) failed", {
        sessions: 1,
      }),
    );
    mockLogAction.mockRejectedValueOnce(new Error("audit table missing"));
    const res = await POST();
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });

  it("audit-logs the run, naming the caller and the tables it emptied", async () => {
    mockPerformCleanup.mockResolvedValueOnce({
      sessions: 3,
      rateLimits: 10,
      oldScans: 0,
    });
    await POST();
    expect(mockLogAction).toHaveBeenCalledTimes(1);
    const [adminId, targetUserId, action, details, ip] =
      mockLogAction.mock.calls[0];
    expect(adminId).toBe(1);
    // Site-wide, not about one account.
    expect(targetUserId).toBeNull();
    expect(action).toBe("database_cleanup_run");
    expect(details).toContain("sessions: 3");
    expect(details).toContain("rateLimits: 10");
    // A zero count is noise in a details string, not a fact worth recording.
    expect(details).not.toContain("oldScans");
    expect(ip).toBe("127.0.0.1");
  });

  it("still reports success when the audit write fails", async () => {
    mockPerformCleanup.mockResolvedValueOnce({ sessions: 1 });
    mockLogAction.mockRejectedValueOnce(new Error("audit table missing"));
    const res = await POST();
    expect(res.status).toBe(200);
  });

  it("says so when the run removed nothing", async () => {
    mockPerformCleanup.mockResolvedValueOnce({ sessions: 0 });
    await POST();
    expect(mockLogAction.mock.calls[0][3]).toContain("nothing to remove");
  });
});
