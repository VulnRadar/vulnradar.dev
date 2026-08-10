import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the per-user in-app notification inbox (the bell), mocked at
 * the database boundary (same pattern as
 * tests/lib/notifications/notifications.test.ts).
 */

// listUnreadUserNotifications now also resolves PAGINATION_DEFAULT_PAGE_SIZE
// live via the settings resolver, which issues its own
// pool.query("SELECT key, value FROM system_settings") ahead of the SELECT
// below. That call is intercepted here (returning empty rows -> shipped
// default) so it doesn't consume a slot from mockBusinessQuery's
// mockResolvedValueOnce() queue or its call-count/positional assertions.
const mockBusinessQuery = vi.fn();
const mockQuery = vi.fn(async (sql: string, params?: unknown[]) => {
  if (sql.trim().startsWith("SELECT key, value FROM system_settings")) {
    return { rows: [] };
  }
  return mockBusinessQuery(sql, params);
});
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...(args as [string, unknown[]?])),
  },
}));

const {
  createUserNotification,
  listUnreadUserNotifications,
  markUserNotificationRead,
  markAllUserNotificationsRead,
  markTeamInviteNotificationsHandled,
} = await import("@/lib/notifications/user-notifications");

beforeEach(() => {
  mockQuery.mockClear();
  mockBusinessQuery.mockReset();
});

describe("createUserNotification", () => {
  it("inserts a row with the given fields", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await createUserNotification({
      userId: 42,
      type: "team_invite",
      title: "Team invite from Alice",
      message: 'Alice invited you to join "Acme" as a viewer.',
      relatedType: "team_invite",
      relatedId: 7,
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO user_notifications");
    expect(params).toEqual([
      42,
      "team_invite",
      "Team invite from Alice",
      'Alice invited you to join "Acme" as a viewer.',
      null,
      null,
      "team_invite",
      7,
    ]);
  });

  it("defaults optional fields to null", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await createUserNotification({
      userId: 1,
      type: "team_invite",
      title: "t",
      message: "m",
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([
      1,
      "team_invite",
      "t",
      "m",
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("listUnreadUserNotifications", () => {
  it("self-heals stale team_invite rows before selecting, then returns the unread list", async () => {
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] }); // self-heal UPDATE
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          type: "team_invite",
          title: "Team invite from Alice",
          message: 'Alice invited you to join "Acme" as a viewer.',
          action_label: null,
          action_url: null,
          related_type: "team_invite",
          related_id: 7,
          created_at: new Date().toISOString(),
        },
      ],
    });

    const result = await listUnreadUserNotifications(42);

    expect(mockBusinessQuery).toHaveBeenCalledTimes(2);
    expect(mockBusinessQuery.mock.calls[0][0]).toContain(
      "UPDATE user_notifications",
    );
    expect(mockBusinessQuery.mock.calls[0][1]).toEqual([42]);
    expect(mockBusinessQuery.mock.calls[1][0]).toContain(
      "SELECT id, type, title, message",
    );
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Team invite from Alice");
  });

  it("returns an empty list when there is nothing unread", async () => {
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] });
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] });

    const result = await listUnreadUserNotifications(42);
    expect(result).toEqual([]);
  });
});

describe("markUserNotificationRead", () => {
  it("returns true when a row was updated", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const result = await markUserNotificationRead(42, 1);
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [1, 42]);
  });

  it("returns false when nothing matched (wrong owner, missing row, or already read)", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const result = await markUserNotificationRead(42, 999);
    expect(result).toBe(false);
  });
});

describe("markAllUserNotificationsRead", () => {
  it("returns the number of rows marked read", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 3 });
    const count = await markAllUserNotificationsRead(42);
    expect(count).toBe(3);
  });

  it("returns 0 when there was nothing to mark", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const count = await markAllUserNotificationsRead(42);
    expect(count).toBe(0);
  });
});

describe("markTeamInviteNotificationsHandled", () => {
  it("marks every notification pointing at the given invite as read", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await markTeamInviteNotificationsHandled(7);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("related_type = 'team_invite'");
    expect(params).toEqual([7]);
  });
});
