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
vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: () => mockRequireAdmin(),
}));

const mockPerformCleanup = vi.fn();
vi.mock("@/lib/database/cleanup", () => ({
  performDatabaseCleanup: (...args: unknown[]) => mockPerformCleanup(...args),
}));

const { POST } = await import("@/app/api/v3/admin/cleanup/route");

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockPerformCleanup.mockReset();
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
});
