import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for the per-user notification inbox API. The database
 * boundary (lib/notifications/user-notifications.ts) and session are
 * mocked; the route's own auth-gating and request-parsing logic run for
 * real.
 */

// This route only calls getSession() from @/lib/auth, so mock the module
// outright rather than pulling in the real one (importOriginal): the real
// module transitively loads lib/database/db.ts and lib/config/registry.ts,
// neither of which this suite needs to exercise.
const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockList = vi.fn();
const mockMarkOne = vi.fn();
const mockMarkAll = vi.fn();
vi.mock("@/lib/notifications/user-notifications", () => ({
  listUnreadUserNotifications: (...args: unknown[]) => mockList(...args),
  markUserNotificationRead: (...args: unknown[]) => mockMarkOne(...args),
  markAllUserNotificationsRead: (...args: unknown[]) => mockMarkAll(...args),
}));

const { GET, PATCH } = await import("@/app/api/v3/notifications/route");

beforeEach(() => {
  mockGetSession.mockReset();
  mockList.mockReset();
  mockMarkOne.mockReset();
  mockMarkAll.mockReset();
});

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/v3/notifications", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v3/notifications", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("returns the caller's unread notifications", async () => {
    mockGetSession.mockResolvedValue({ userId: 42 });
    mockList.mockResolvedValue([
      { id: 1, type: "team_invite", title: "t", message: "m" },
    ]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(42);
    expect(json.notifications).toHaveLength(1);
  });
});

describe("PATCH /api/v3/notifications", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ id: 1 }));
    expect(res.status).toBe(401);
  });

  it("marks a single notification read by id", async () => {
    mockGetSession.mockResolvedValue({ userId: 42 });
    mockMarkOne.mockResolvedValue(true);

    const res = await PATCH(patchRequest({ id: 1 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockMarkOne).toHaveBeenCalledWith(42, 1);
    expect(json.success).toBe(true);
  });

  it("returns 404 when the notification doesn't belong to the caller or doesn't exist", async () => {
    mockGetSession.mockResolvedValue({ userId: 42 });
    mockMarkOne.mockResolvedValue(false);

    const res = await PATCH(patchRequest({ id: 999 }));
    expect(res.status).toBe(404);
  });

  it("rejects a request with neither id nor markAllRead", async () => {
    mockGetSession.mockResolvedValue({ userId: 42 });
    const res = await PATCH(patchRequest({}));
    expect(res.status).toBe(400);
    expect(mockMarkOne).not.toHaveBeenCalled();
  });

  it("marks every unread notification read when markAllRead is set", async () => {
    mockGetSession.mockResolvedValue({ userId: 42 });
    mockMarkAll.mockResolvedValue(3);

    const res = await PATCH(patchRequest({ markAllRead: true }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockMarkAll).toHaveBeenCalledWith(42);
    expect(json.count).toBe(3);
    expect(mockMarkOne).not.toHaveBeenCalled();
  });
});
