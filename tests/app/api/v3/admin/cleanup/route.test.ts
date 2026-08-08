/**
 * Route-level tests for POST /api/v3/admin/cleanup (on-demand trigger for
 * the periodic database cleanup job). Auth is an inline getSession + role
 * lookup requiring staff hierarchy >= support. `performDatabaseCleanup`
 * (lib/database/cleanup.ts) is mocked as a business-logic boundary, the
 * same way tests/app/api/v3/teams/members/route.test.ts mocks
 * lib/notifications/user-notifications.
 *
 * FINDING (not fixed here — flagged per this task's instructions): unlike
 * every other admin route in this codebase, app/api/v3/admin/cleanup/route.ts
 * never imports or calls logAction/logAuditAction. This POST triggers a
 * destructive, deployment-wide bulk-delete (expired sessions, password
 * reset tokens, security alerts, scan history past its plan's retention
 * window, and even old admin_audit_log rows themselves — see
 * lib/database/cleanup.ts) and is reachable by a mere support-tier staff
 * member, yet leaves zero audit trail of who triggered it or when. There is
 * no `logAction` call in the source to spy on here, so this can't be
 * expressed as a runtime assertion within this file — it's a structural
 * absence. See the final report for this task for full detail.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockPerformCleanup = vi.fn();
vi.mock("@/lib/database/cleanup", () => ({
  performDatabaseCleanup: (...args: unknown[]) => mockPerformCleanup(...args),
}));

const { POST } = await import("@/app/api/v3/admin/cleanup/route");

function queueRole(role: string | null) {
  mockQuery.mockResolvedValueOnce({ rows: role ? [{ role }] : [] });
}

function postRequest(): NextRequest {
  return new NextRequest("http://localhost/api/v3/admin/cleanup", {
    method: "POST",
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockPerformCleanup.mockReset();
  mockGetSession.mockResolvedValue({ userId: 1 });
});

describe("POST /api/v3/admin/cleanup", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest());
    expect(res.status).toBe(401);
    expect(mockPerformCleanup).not.toHaveBeenCalled();
  });

  it("rejects a plain user (below support tier)", async () => {
    queueRole("user");
    const res = await POST(postRequest());
    expect(res.status).toBe(403);
    expect(mockPerformCleanup).not.toHaveBeenCalled();
  });

  it("runs cleanup for a support-tier caller and returns its stats", async () => {
    queueRole("support");
    mockPerformCleanup.mockResolvedValueOnce({ sessions: 3, rateLimits: 10 });
    const res = await POST(postRequest());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.stats).toEqual({ sessions: 3, rateLimits: 10 });
    expect(mockPerformCleanup).toHaveBeenCalledTimes(1);
  });

  it("returns a graceful 500 when the cleanup job fails", async () => {
    queueRole("admin");
    mockPerformCleanup.mockRejectedValueOnce(new Error("cleanup exploded"));
    const res = await POST(postRequest());
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
  });
});
