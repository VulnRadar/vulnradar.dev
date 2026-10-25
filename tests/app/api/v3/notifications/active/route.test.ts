import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for GET /api/v3/notifications/active, the endpoint
 * SiteNotificationsWrapper (components/shared/site-notifications.tsx) and
 * NotificationBell (components/shared/notification-center.tsx) both poll to
 * decide which admin-authored banner/modal/toast/bell notifications to show.
 *
 * Audience privilege is derived from the SERVER session, never from client
 * query params. The route used to bind `?authenticated=true&staff=true`
 * straight into the SQL audience gate, letting any caller self-elevate to
 * receive staff/admin-only broadcasts; these tests pin that the params are
 * ignored and that `isStaff` comes from the session role.
 *
 * "Staff Only" and "Admins Only" are different audiences in the admin panel,
 * so `isAdmin` is its own flag (the admin tier and above, the line
 * requireAdmin() draws). Both used to ride on isStaff, which put an
 * admin-targeted notice in front of every support, billing and ops account.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
const mockIsStaffRole = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
  isStaffRole: (role: string | null | undefined) => mockIsStaffRole(role),
}));

const { GET } = await import("@/app/api/v3/notifications/active/route");
const { currentRequestId } = await import("@/lib/database/request-context");

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockGetSession.mockReset();
  mockIsStaffRole.mockReset();
  mockIsStaffRole.mockReturnValue(false);
});

describe("GET /api/v3/notifications/active", () => {
  it("treats a request with no session as an unauthenticated guest", async () => {
    mockGetSession.mockResolvedValue(null);
    await GET();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(false); // isAuthenticated
    expect(params[2]).toBe(false); // isStaff
  });

  it("marks a signed-in non-staff user authenticated but not staff", async () => {
    mockGetSession.mockResolvedValue({ userId: 5, role: "user" });
    mockIsStaffRole.mockReturnValue(false);
    await GET();
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(true);
    expect(params[2]).toBe(false);
  });

  it("marks a signed-in staff user as staff (from the session role)", async () => {
    mockGetSession.mockResolvedValue({ userId: 9, role: "admin" });
    mockIsStaffRole.mockReturnValue(true);
    await GET();
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(true);
    expect(params[2]).toBe(true);
    expect(mockIsStaffRole).toHaveBeenCalledWith("admin");
  });

  it("never derives staff from a session-less caller even if isStaffRole is lax", async () => {
    // Security regression guard: a guest must never come back as staff.
    mockGetSession.mockResolvedValue(null);
    mockIsStaffRole.mockReturnValue(true);
    await GET();
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(false);
    expect(params[2]).toBe(false);
  });

  describe("the admin audience", () => {
    // The roles below the admin tier that isStaffRole() accepts: each one
    // used to receive a notification an admin had marked "Admins Only".
    const BELOW_ADMIN = [
      "support",
      "billing",
      "security_analyst",
      "content_manager",
      "ops",
      "moderator",
    ];

    it.each(BELOW_ADMIN)(
      "treats %s as staff but not as an admin",
      async (role) => {
        mockGetSession.mockResolvedValue({ userId: 3, role });
        mockIsStaffRole.mockReturnValue(true);
        await GET();
        const [, params] = mockQuery.mock.calls[0];
        expect(params[2]).toBe(true); // isStaff
        expect(params[3]).toBe(false); // isAdmin
      },
    );

    it.each(["admin", "super_admin"])("treats %s as an admin", async (role) => {
      mockGetSession.mockResolvedValue({ userId: 4, role });
      mockIsStaffRole.mockReturnValue(true);
      await GET();
      const [, params] = mockQuery.mock.calls[0];
      expect(params[2]).toBe(true);
      expect(params[3]).toBe(true);
    });

    it("never marks a plain user or a guest as an admin", async () => {
      mockGetSession.mockResolvedValue({ userId: 5, role: "user" });
      await GET();
      expect(mockQuery.mock.calls[0][1][3]).toBe(false);

      mockQuery.mockClear();
      mockGetSession.mockResolvedValue(null);
      await GET();
      expect(mockQuery.mock.calls[0][1][3]).toBe(false);
    });

    it("does not trust a role string it does not know", async () => {
      mockGetSession.mockResolvedValue({ userId: 6, role: "root" });
      await GET();
      expect(mockQuery.mock.calls[0][1][3]).toBe(false);
    });

    it("never derives admin from a session-less caller even if isStaffRole is lax", async () => {
      mockGetSession.mockResolvedValue(null);
      mockIsStaffRole.mockReturnValue(true);
      await GET();
      expect(mockQuery.mock.calls[0][1][3]).toBe(false);
    });

    it("gates 'staff' on the staff flag and 'admin' on the admin flag", async () => {
      mockGetSession.mockResolvedValue(null);
      await GET();
      const sql = String(mockQuery.mock.calls[0][0]);
      expect(sql).toContain("audience = 'staff' AND $3");
      expect(sql).toContain("audience = 'admin' AND $4");
      // The old shape, where both audiences shared $3.
      expect(sql).not.toContain("audience = 'admin' AND $3");
    });
  });

  it("returns the rows from the query under a notifications key", async () => {
    mockGetSession.mockResolvedValue(null);
    mockQuery.mockResolvedValue({
      rows: [{ id: 1, type: "banner", audience: "all" }],
    });
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    // Named envelope, matching every other collection route. A bare array had
    // nowhere to carry a total or a cursor without breaking callers.
    expect(Array.isArray(json.notifications)).toBe(true);
    expect(json.notifications).toHaveLength(1);
  });

  it("returns 500 and does not throw when the database errors", async () => {
    mockGetSession.mockResolvedValue(null);
    mockQuery.mockRejectedValue(new Error("connection lost"));
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("runs inside a request context so its log rows carry a request id", async () => {
    mockGetSession.mockResolvedValue(null);
    let seen: string | null = null;
    mockQuery.mockImplementation(async () => {
      seen = currentRequestId();
      return { rows: [] };
    });
    await GET();
    expect(seen).toEqual(expect.any(String));
  });

  it("logs a database failure with the Error itself, so the stack is kept", async () => {
    mockGetSession.mockResolvedValue(null);
    const failure = new Error("connection lost");
    mockQuery.mockRejectedValue(failure);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await GET();
      const call = spy.mock.calls.find((args) =>
        String(args[0]).startsWith("[notifications]"),
      );
      expect(call).toBeDefined();
      expect(call).toContain(failure);
    } finally {
      spy.mockRestore();
    }
  });
});
