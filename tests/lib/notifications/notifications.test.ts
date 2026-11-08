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
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");

const VERIFIED_ACCOUNT = {
  unsubscribe_token: "tok",
  email_verified_at: new Date("2026-01-01T00:00:00.000Z"),
};

beforeEach(() => {
  mockQuery.mockReset();
  mockSendEmail.mockReset();
  // sendNotificationEmail resolves FEATURE_EMAIL_NOTIFICATIONS via the real
  // settings resolver (lib/config/runtime-config.ts), which is not mocked in
  // this file -- it issues its own pool.query("SELECT key, value FROM
  // system_settings") ahead of the two queries below. Cache invalidated per
  // test so each test's queued mock responses aren't shadowed by a snapshot
  // left over from a previous test.
  invalidateSettingsCache();
});

describe("NOTIFICATION_COLUMNS", () => {
  it("maps team_changes to the email_team_changes column", () => {
    expect(NOTIFICATION_COLUMNS.team_changes).toBe("email_team_changes");
  });

  it("maps posture_digest to the email_posture_digest column", () => {
    expect(NOTIFICATION_COLUMNS.posture_digest).toBe("email_posture_digest");
    expect(ALL_COLUMNS).toContain("email_posture_digest");
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

  it("starts an account with no row on the schema defaults: everything on except Tips & Guides", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const prefs = await getNotificationPreferences(1);

    // The schema says `email_tips_guides ... DEFAULT false`. Every copy of the
    // defaults said true, so a user with no row was shown as subscribed to
    // tips and sent them.
    expect(prefs.email_tips_guides).toBe(false);
    expect(prefs.email_product_updates).toBe(true);
    expect(prefs.email_security).toBe(true);
  });

  it("hands back a copy, so a caller cannot change the defaults for everyone", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const first = await getNotificationPreferences(1);
    first.email_tips_guides = true;
    const second = await getNotificationPreferences(2);

    expect(second.email_tips_guides).toBe(false);
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
      .mockResolvedValueOnce({ rows: [] }) // FEATURE_EMAIL_NOTIFICATIONS settings lookup (empty -> shipped default, enabled)
      .mockResolvedValueOnce({ rows: [row] }) // getNotificationPreferences
      .mockResolvedValueOnce({ rows: [VERIFIED_ACCOUNT] }); // token lookup

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
      .mockResolvedValueOnce({ rows: [] }) // FEATURE_EMAIL_NOTIFICATIONS settings lookup
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [VERIFIED_ACCOUNT] });

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
        // The one-click header is scoped to this message's own category.
        unsubscribeColumn: "email_team_changes",
      }),
    );
  });

  it("sends a security notice with no unsubscribe token, and never reads it", async () => {
    // A mail client's Unsubscribe button on a "new sign-in" notice used to
    // switch off the sign-in, password and two-factor warnings together.
    const row = Object.fromEntries(ALL_COLUMNS.map((c) => [c, true]));
    mockQuery.mockResolvedValueOnce({ rows: [row] }); // getNotificationPreferences

    await sendNotificationEmail({
      userId: 1,
      userEmail: "user@example.com",
      type: "login_alerts",
      emailContent,
    });

    const sent = mockSendEmail.mock.calls[0][0];
    expect(sent.unsubscribeToken).toBeUndefined();
    expect(sent.unsubscribeColumn).toBeUndefined();
    const sql = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => s.includes("unsubscribe_token"))).toBe(false);
  });

  it("still honours a security preference the user switched off", async () => {
    const row = Object.fromEntries(ALL_COLUMNS.map((c) => [c, true]));
    row.email_new_login = false;
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    await sendNotificationEmail({
      userId: 1,
      userEmail: "user@example.com",
      type: "login_alerts",
      emailContent,
    });

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("passes the template through, so a spread builder result is traced to its row", async () => {
    const row = Object.fromEntries(ALL_COLUMNS.map((c) => [c, true]));
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [VERIFIED_ACCOUNT] });

    await sendNotificationEmail({
      userId: 1,
      userEmail: "user@example.com",
      type: "scan_complete",
      emailContent: { ...emailContent, template: "scanComplete" },
    });

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ template: "scanComplete" }),
    );
  });

  /**
   * Settings-wiring regression: FEATURE_EMAIL_NOTIFICATIONS is a
   * registry-backed deployment-wide kill switch. It used to resolve into a
   * dead FEATURES.EMAIL_NOTIFICATIONS object nothing ever read, so an
   * admin disabling email notifications in /admin had zero effect --
   * notifications kept sending regardless of per-user preferences. This
   * proves the live (mocked) setting short-circuits before even the
   * per-user preference check runs.
   */
  it("does not send, and never queries preferences, when FEATURE_EMAIL_NOTIFICATIONS is disabled", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ key: "FEATURE_EMAIL_NOTIFICATIONS", value: "false" }],
    });

    await sendNotificationEmail({
      userId: 1,
      userEmail: "user@example.com",
      type: "team_changes",
      emailContent,
    });

    expect(mockSendEmail).not.toHaveBeenCalled();
    // Only the one settings-table query ran; the function returned before
    // ever touching notification_preferences or the unsubscribe token.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  describe("with FEATURE_EMAIL_NOTIFICATIONS switched off", () => {
    function killSwitchOff(prefs: Record<string, boolean> = {}) {
      const row = Object.fromEntries(ALL_COLUMNS.map((c) => [c, true]));
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes("system_settings")) {
          return {
            rows: [{ key: "FEATURE_EMAIL_NOTIFICATIONS", value: "false" }],
          };
        }
        if (sql.includes("notification_preferences")) {
          return { rows: [{ ...row, ...prefs }] };
        }
        return { rows: [VERIFIED_ACCOUNT] };
      });
    }

    const send = (type: Parameters<typeof shouldSendNotification>[1]) =>
      sendNotificationEmail({
        userId: 1,
        userEmail: "user@example.com",
        type,
        emailContent,
      });

    it("still sends login_alerts, and does not send scan_complete", async () => {
      killSwitchOff();

      await expect(send("login_alerts")).resolves.toBe(true);
      expect(mockSendEmail).toHaveBeenCalledTimes(1);

      mockSendEmail.mockClear();
      await expect(send("scan_complete")).resolves.toBe(false);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("sends every security type past it", async () => {
      killSwitchOff();
      const types = [
        "security",
        "login_alerts",
        "password_changes",
        "two_factor_changes",
        "session_alerts",
        "account_changes",
      ] as const;

      for (const type of types) {
        await expect(send(type)).resolves.toBe(true);
      }
      expect(mockSendEmail).toHaveBeenCalledTimes(types.length);
    });

    it("still honours the per-user switch on a security type", async () => {
      killSwitchOff({ email_password_change: false });

      await expect(send("password_changes")).resolves.toBe(false);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("sends email_security even from a row that says false", async () => {
      killSwitchOff({ email_security: false });

      await expect(send("security")).resolves.toBe(true);
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe("while the account address is unverified", () => {
    function unverified() {
      const row = Object.fromEntries(ALL_COLUMNS.map((c) => [c, true]));
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes("system_settings")) return { rows: [] };
        if (sql.includes("notification_preferences")) return { rows: [row] };
        return {
          rows: [{ unsubscribe_token: "tok", email_verified_at: null }],
        };
      });
    }

    it("holds back everything that is not a security notice", async () => {
      unverified();

      await expect(
        sendNotificationEmail({
          userId: 1,
          userEmail: "new-address@example.com",
          type: "severity_alerts",
          emailContent,
        }),
      ).resolves.toBe(false);

      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("still delivers a security notice", async () => {
      unverified();

      await expect(
        sendNotificationEmail({
          userId: 1,
          userEmail: "new-address@example.com",
          type: "password_changes",
          emailContent,
        }),
      ).resolves.toBe(true);

      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    [true, 1],
    [false, 0],
  ])(
    "gates critical_findings on email_critical_findings (%s)",
    async (enabled, sends) => {
      const row = Object.fromEntries(ALL_COLUMNS.map((c) => [c, true]));
      row.email_critical_findings = enabled;
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [VERIFIED_ACCOUNT] });

      await sendNotificationEmail({
        userId: 1,
        userEmail: "user@example.com",
        type: "critical_findings",
        emailContent,
      });

      expect(mockSendEmail).toHaveBeenCalledTimes(sends);
      if (sends === 1) {
        expect(mockSendEmail.mock.calls[0][0].unsubscribeColumn).toBe(
          "email_critical_findings",
        );
      }
    },
  );

  it("resolves false when the user's preference held the mail back", async () => {
    const row = Object.fromEntries(ALL_COLUMNS.map((c) => [c, true]));
    row.email_regression_alert = false;
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [VERIFIED_ACCOUNT] });

    await expect(
      sendNotificationEmail({
        userId: 1,
        userEmail: "user@example.com",
        type: "severity_alerts",
        emailContent,
      }),
    ).resolves.toBe(false);
  });
});
