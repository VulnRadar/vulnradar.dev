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
vi.mock("@/lib/database/cleanup", () => ({
  performDatabaseCleanup: (...args: unknown[]) => mockPerformCleanup(...args),
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
