/**
 * The email preference columns: what they are called, which ones cannot be
 * switched off, and what a user who has never saved a choice gets.
 *
 * This is the one declaration. It used to live in lib/notifications/
 * notifications.ts, which imports the database pool, so nothing that renders
 * in a browser could read it and eight places copied it instead: the profile
 * screen's NotificationPrefs and its DEFAULT_PREFS, the unsubscribe page's
 * PrefKey, the admin broadcast route's VALID_PREF_COLS, the 19-column INSERT
 * in both signup and the OAuth callback, and ALWAYS_ON in three files. The
 * copies drifted in the one place that matters. The schema says
 * `email_tips_guides ... DEFAULT false`, and every copy of the defaults said
 * true, so a user with no preferences row was shown as subscribed to tips and
 * guides and was included in a broadcast filtered on that preference. Bulk
 * mail to people who never opted in is the quickest way to a spam complaint.
 *
 * Nothing here imports the database or any server module, so a Client
 * Component, a route and the email sender can all use it.
 */

/**
 * Notification type -> notification_preferences column. Adding a notification
 * means adding a line here and, for a new column, the schema.
 */
export const NOTIFICATION_COLUMNS = {
  security: "email_security",
  login_alerts: "email_new_login",
  password_changes: "email_password_change",
  two_factor_changes: "email_2fa_change",
  session_alerts: "email_session_revoked",
  scan_complete: "email_scan_complete",
  critical_findings: "email_critical_findings",
  severity_alerts: "email_regression_alert",
  schedules: "email_schedules",
  posture_digest: "email_posture_digest",
  api_keys: "email_api_keys",
  api_usage_alerts: "email_api_limit_warning",
  webhooks: "email_webhooks",
  webhook_failures: "email_webhook_failure",
  data_requests: "email_data_requests",
  account_changes: "email_account_deletion",
  team_invites: "email_team_invite",
  team_changes: "email_team_changes",
  product_updates: "email_product_updates",
  tips_guides: "email_tips_guides",
} as const;

export type NotificationType = keyof typeof NOTIFICATION_COLUMNS;
export type NotificationColumn =
  (typeof NOTIFICATION_COLUMNS)[NotificationType];

export const ALL_COLUMNS: readonly NotificationColumn[] =
  Object.values(NOTIFICATION_COLUMNS);

/** One boolean per column. The profile screen and the unsubscribe page both
 *  type their state with this. */
export type NotificationPrefs = Record<NotificationColumn, boolean>;

/** Same shape under the name the unsubscribe page and the routes use. */
export type PrefKey = NotificationColumn;

export function isNotificationColumn(
  value: unknown,
): value is NotificationColumn {
  return (
    typeof value === "string" &&
    (ALL_COLUMNS as readonly string[]).includes(value)
  );
}

/**
 * Columns no writer will switch off.
 *
 * The profile route, the unsubscribe route and both screens used to carry a
 * copy each. A copy that forgot an entry is a control that reports "saved"
 * and does nothing, or the reverse, a route that lets a security alert be
 * disabled with one request.
 */
export const ALWAYS_ON_COLUMNS: ReadonlySet<NotificationColumn> =
  new Set<NotificationColumn>(["email_security"]);

/**
 * Columns that start OFF for an account that never chose.
 *
 * Mirrors `DEFAULT false` in lib/database/schema/01-core.mjs.
 * tests/lib/notifications/columns.test.ts reads the DDL and fails when this
 * list and the schema disagree, which is the check that was missing when the
 * copies drifted.
 */
const OFF_BY_DEFAULT: ReadonlySet<NotificationColumn> =
  new Set<NotificationColumn>(["email_tips_guides"]);

/**
 * What an account with no preferences row gets, which is what the row it is
 * given on first write will contain: every column on except the opt-in ones.
 */
export const DEFAULT_PREFERENCES: Readonly<NotificationPrefs> = Object.freeze(
  Object.fromEntries(
    ALL_COLUMNS.map((column) => [column, !OFF_BY_DEFAULT.has(column)]),
  ) as NotificationPrefs,
);

/**
 * SQL for "this user wants mail in this category", for a query that
 * LEFT JOINs notification_preferences.
 *
 * A user with no row has made no choice, and the choice they have not made is
 * the schema default, not "yes". The broadcast filter treated a missing row
 * as opted in for every column, so an audience filtered on Tips & Guides,
 * which is opt-in, included everyone who had never saved a preference. The
 * column name is one of the known columns, never caller text, which is the
 * only reason it can be interpolated.
 */
export function optedInCondition(
  column: NotificationColumn,
  alias = "np",
): string {
  return `COALESCE(${alias}.${column}, ${DEFAULT_PREFERENCES[column] ? "true" : "false"}) = true`;
}

/**
 * Types whose mail warns about a change to who can get into the account.
 *
 * These never carry an unsubscribe token, so they never get a one-click
 * List-Unsubscribe header. Gmail and Yahoo draw their "Unsubscribe" button on
 * any message that has the header, and people press it on everything that
 * looks like noise. Pressing it on a "new sign-in" notice used to switch off
 * the sign-in, password, two-factor, session and email-change warnings
 * together, which are the ones that exist to catch a takeover. A person who
 * really wants one of them off can still do it under Profile > Notifications.
 */
const SECURITY_NOTIFICATION_TYPES: ReadonlySet<NotificationType> =
  new Set<NotificationType>([
    "security",
    "login_alerts",
    "password_changes",
    "two_factor_changes",
    "session_alerts",
    "account_changes",
  ]);

export function isSecurityNotification(type: NotificationType): boolean {
  return SECURITY_NOTIFICATION_TYPES.has(type);
}

const SECURITY_COLUMNS: ReadonlySet<NotificationColumn> = new Set(
  Array.from(SECURITY_NOTIFICATION_TYPES, (type) => NOTIFICATION_COLUMNS[type]),
);

/**
 * The same set as columns, for code that holds a column rather than a type: a
 * one-click unsubscribe, and a broadcast sent under a category.
 *
 * Neither may point a mail client's button at one of these. The composer
 * offers "Login Alerts" and "Security Alerts" as audiences, and a broadcast
 * to that audience carries a List-Unsubscribe link like any other; scoped to
 * its own column it would turn off the sign-in warnings for whoever pressed
 * Unsubscribe on a newsletter.
 */
export function isSecurityColumn(column: NotificationColumn): boolean {
  return SECURITY_COLUMNS.has(column);
}

/**
 * What an unsubscribe token can read and change: everything except the
 * security columns.
 *
 * The token sits in the footer of mail and in the List-Unsubscribe header, so
 * anyone a message was forwarded to holds it, and it never expires. Switching
 * off the sign-in and password warnings is exactly what someone who has got
 * into an account wants, so those stay behind a signed-in session on Profile >
 * Notifications. The one-click branch already refused them; the switches and
 * "unsubscribe from all" did not.
 */
export const UNSUBSCRIBABLE_COLUMNS: readonly NotificationColumn[] =
  ALL_COLUMNS.filter((column) => !isSecurityColumn(column));

/**
 * The name and description of every preference, on every screen that lists
 * them.
 *
 * Profile and /unsubscribe each had their own wording, and they described
 * different products: one called email_regression_alert "Regression Alerts",
 * for "new issues in a previously clean scan", when it fires on a new critical
 * or high finding whether or not the last scan was clean. An admin filter may
 * label its audiences for admins, but a person choosing what to receive reads
 * this table.
 */
export const PREFERENCE_COPY: Readonly<
  Record<NotificationColumn, { label: string; description: string }>
> = {
  email_security: {
    label: "Security alerts",
    description:
      "Unusual activity on your account, and anything that looks like someone else getting in. This one cannot be switched off.",
  },
  email_new_login: {
    label: "New sign-ins",
    description: "A sign-in from a device or location we have not seen before.",
  },
  email_password_change: {
    label: "Password changes",
    description: "Your password changed, or a reset was requested for it.",
  },
  email_2fa_change: {
    label: "Two-step verification changes",
    description:
      "Two-step verification turned on, turned off, or switched method.",
  },
  email_session_revoked: {
    label: "Revoked sessions",
    description:
      "A signed-in session was ended, by you or by a sign-out everywhere.",
  },
  email_scan_complete: {
    label: "Scan finished",
    description: "Every scan, as soon as it has a result.",
  },
  email_critical_findings: {
    label: "Critical findings",
    description:
      "A finished scan found something rated critical. If that scan also sends the new critical or high findings alert, you only get the alert. Scheduled runs send this only for a new finding.",
  },
  email_regression_alert: {
    label: "New critical or high findings",
    description:
      "A critical or high finding on a target that did not have it on the last scan, including the first scan of a target.",
  },
  email_schedules: {
    label: "Scheduled scans",
    description: "Results from the scans you set to run on a schedule.",
  },
  email_posture_digest: {
    label: "Posture digest",
    description:
      "A periodic summary across every site you have scanned: new critical and high findings, and whether your open count is going up or down.",
  },
  email_api_keys: {
    label: "API key activity",
    description:
      "A key was created or revoked, or one of yours is close to expiring.",
  },
  email_api_limit_warning: {
    label: "Approaching API limits",
    description: "Your API usage is close to a rate limit or the daily quota.",
  },
  email_webhooks: {
    label: "Webhook changes",
    description: "A webhook was created, edited, or switched off.",
  },
  email_webhook_failure: {
    label: "Webhook failures",
    description: "Deliveries to one of your endpoints keep failing.",
  },
  email_data_requests: {
    label: "Data exports",
    description: "Your export is built and ready to download.",
  },
  email_account_deletion: {
    label: "Account deletion",
    description:
      "Deletion was requested on your account, and again when it runs.",
  },
  email_team_invite: {
    label: "Team invitations",
    description: "Someone invited you to join their team.",
  },
  email_team_changes: {
    label: "Team changes",
    description:
      "People joining or leaving a team you are in, and role changes.",
  },
  email_product_updates: {
    label: "Product updates",
    description: "New features, improvements, and release notes.",
  },
  email_tips_guides: {
    label: "Tips and guides",
    description: "Occasional tips on getting more out of VulnRadar.",
  },
};

/**
 * The column a broadcast with no category of its own is gated on, and the one
 * its one-click unsubscribe turns off. Product announcements are the only
 * thing a broadcast can be when nobody picked a more specific one.
 */
export const BROADCAST_FALLBACK_COLUMN: NotificationColumn =
  "email_product_updates";
