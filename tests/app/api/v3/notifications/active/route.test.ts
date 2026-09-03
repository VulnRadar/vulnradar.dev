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
});
