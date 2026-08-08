import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for GET /api/v3/notifications/active, the endpoint
 * SiteNotificationsWrapper (components/shared/site-notifications.tsx) and
 * NotificationBell (components/shared/notification-center.tsx) both poll to
 * decide which admin-authored banner/modal/toast/bell notifications to show.
 *
 * This route trusts the `authenticated` and `staff` query params completely:
 * it does not look at the session itself, it just treats
 * `?authenticated=true` / `?staff=true` as fact and defaults both to false
 * when absent (see route.ts below). That means the two client callers are
 * fully responsible for passing them, and this codebase has twice shipped a
 * regression where the caller stopped doing that — silently breaking every
 * "Logged In Users" / "Staff Only" / "Admins Only" notification (they can
 * never match with the params defaulted false) while "Guests Only" notices
 * started showing to everyone, including logged-in users (NOT $2 is true
 * when $2 defaults false).
 *
 * These tests pin the query's audience-matching contract so that contract
 * regression is visible here even though the client-side omission itself
 * (a plain fetch() with no params) isn't something this Node-environment
 * suite can exercise directly.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { GET } = await import("@/app/api/v3/notifications/active/route");

function request(query: string): Request {
  return new Request(`http://localhost/api/v3/notifications/active${query}`);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe("GET /api/v3/notifications/active", () => {
  it("defaults both authenticated and staff to false when the params are omitted", async () => {
    await GET(request(""));
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(false); // isAuthenticated
    expect(params[2]).toBe(false); // isStaff
  });

  it("passes authenticated=true through when the caller sends it", async () => {
    await GET(request("?authenticated=true&staff=false"));
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(true);
    expect(params[2]).toBe(false);
  });

  it("passes staff=true through when the caller sends it", async () => {
    await GET(request("?authenticated=true&staff=true"));
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(true);
    expect(params[2]).toBe(true);
  });

  it("treats anything other than the literal string 'true' as false", async () => {
    await GET(request("?authenticated=1&staff=yes"));
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(false);
    expect(params[2]).toBe(false);
  });

  it("returns the rows from the query directly as a JSON array", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 1, type: "banner", audience: "all" }],
    });
    const res = await GET(request(""));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(json)).toBe(true);
    expect(json).toHaveLength(1);
  });

  it("returns 500 and does not throw when the database errors", async () => {
    mockQuery.mockRejectedValue(new Error("connection lost"));
    const res = await GET(request(""));
    expect(res.status).toBe(500);
  });
});
