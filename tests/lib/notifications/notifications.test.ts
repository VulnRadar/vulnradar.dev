import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the notification-preference gating logic.
 *
 * lib/notifications/notifications.ts is the single source of truth: every
 * notification type maps to exactly one `notification_preferences` column,
 * and ALL_COLUMNS / NotificationPreferences are both derived from that one
 * map. We mock the pg pool (same pattern as
 * tests/lib/rate-limiting/rate-limit.test.ts) and lib/email/email's
 * sendEmail so the suite is hermetic and fast, while still exercising the
 * real gating logic in this file.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockSendEmail = vi.fn();
vi.mock("@/lib/email/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

const {
  NOTIFICATION_COLUMNS,
  ALL_COLUMNS,
  getNotificationPreferences,
  shouldSendNotification,
  sendNotificationEmail,
} = await import("@/lib/notifications/notifications");

beforeEach(() => {
  mockQuery.mockReset();
  mockSendEmail.mockReset();
});

describe("NOTIFICATION_COLUMNS", () => {
  it("maps team_changes to the email_team_changes column", () => {
    expect(NOTIFICATION_COLUMNS.team_changes).toBe("email_team_changes");
  });

  it("keeps team_changes distinct from team_invites", () => {
    expect(NOTIFICATION_COLUMNS.team_invites).toBe("email_team_invite");
    expect(NOTIFICATION_COLUMNS.team_changes).not.toBe(
      NOTIFICATION_COLUMNS.team_invites,
    );
  });

  it("includes email_team_changes in the derived ALL_COLUMNS list", () => {
    expect(ALL_COLUMNS).toContain("email_team_changes");
  });
});

describe("getNotificationPreferences", () => {
  it("defaults email_team_changes to true when no row exists yet", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const prefs = await getNotificationPreferences(1);

    expect(prefs.email_team_changes).toBe(true);
    // The SELECT should ask for the column now that it's part of ALL_COLUMNS.
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("email_team_changes");
  });

  it("returns the stored value for an existing preferences row", async () => {
    const row = Object.fromEntries(ALL_COLUMNS.map((c) => [c, true]));
    row.email_team_changes = false;
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const prefs = await getNotificationPreferences(1);

    expect(prefs.email_team_changes).toBe(false);
  });
});

describe("shouldSendNotification", () => {
  it("gates team_changes on the email_team_changes column", async () => {
    const row = Object.fromEntries(ALL_COLUMNS.map((c) => [c, true]));
    row.email_team_changes = false;
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await shouldSendNotification(1, "team_changes");

    expect(result).toBe(false);
  });

  it("allows team_changes when the column is true", async () => {
    const row = Object.fromEntries(ALL_COLUMNS.map((c) => [c, true]));
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await shouldSendNotification(1, "team_changes");

    expect(result).toBe(true);
  });
});

describe("sendNotificationEmail", () => {
  const emailContent = {
    subject: "Team membership changed",
    text: "text body",
    html: "<p>html body</p>",
  };

  it("does not send when the user opted out of team_changes", async () => {
    const row = Object.fromEntries(ALL_COLUMNS.map((c) => [c, true]));
    row.email_team_changes = false;
    mockQuery
      .mockResolvedValueOnce({ rows: [row] }) // getNotificationPreferences
      .mockResolvedValueOnce({ rows: [{ unsubscribe_token: "tok" }] }); // token lookup

    await sendNotificationEmail({
      userId: 1,
      userEmail: "user@example.com",
      type: "team_changes",
      emailContent,
    });

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends when the user has team_changes enabled", async () => {
    const row = Object.fromEntries(ALL_COLUMNS.map((c) => [c, true]));
    mockQuery
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ unsubscribe_token: "tok" }] });

    await sendNotificationEmail({
      userId: 1,
      userEmail: "user@example.com",
      type: "team_changes",
      emailContent,
    });

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        subject: emailContent.subject,
        unsubscribeToken: "tok",
      }),
    );
  });
});
