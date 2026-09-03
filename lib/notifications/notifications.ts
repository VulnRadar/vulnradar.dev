import pool from "@/lib/database/db";
import { sendEmail } from "@/lib/email/email";
import { getSetting } from "@/lib/config/runtime-config";

/**
 * R4: Single source of truth for notification preferences.
 *
 * Previously: NotificationType (union), ALL_COLUMNS (array), and
 * TYPE_TO_COLUMN (record) were three manually-maintained declarations
 * that drifted independently when columns or types were added.
 *
 * Now: NOTIFICATION_COLUMNS is the one map; NotificationType is derived
 * from its keys, ALL_COLUMNS from its values, and the
 * NotificationPreferences interface from its value union. Adding a
 * new notification means editing one entry.
 */
export const NOTIFICATION_COLUMNS = {
  security: "email_security",
  login_alerts: "email_new_login",
  password_changes: "email_password_change",
  two_factor_changes: "email_2fa_change",
  session_alerts: "email_session_revoked",
  scan_complete: "email_scan_complete",
  scan_failures: "email_critical_findings",
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

/** Strongly-typed preferences row shape — each key is a NotificationColumn. */
export type NotificationPreferences = Record<NotificationColumn, boolean>;

const DEFAULT_PREFERENCES: NotificationPreferences = Object.fromEntries(
  ALL_COLUMNS.map((c) => [c, true]),
) as NotificationPreferences;

export async function getNotificationPreferences(
  userId: number,
): Promise<NotificationPreferences> {
  const result = await pool.query(
    `SELECT ${ALL_COLUMNS.join(", ")} FROM notification_preferences WHERE user_id = $1`,
    [userId],
  );
  if (result.rows.length === 0) return DEFAULT_PREFERENCES;
  return result.rows[0];
}

export async function shouldSendNotification(
  userId: number,
  type: NotificationType,
): Promise<boolean> {
  const prefs = await getNotificationPreferences(userId);
  const column = NOTIFICATION_COLUMNS[type];
  return prefs[column];
}

interface SendNotificationEmailParams {
  userId: number;
  userEmail: string;
  type: NotificationType;
  emailContent: {
    subject: string;
    text: string;
    html: string;
    /**
     * Inbox preview line. Optional so a caller can hand this whole object
     * straight from a template builder in lib/email/email.ts: every template
     * writes one, and sendEmail falls back to deriving it from `text` for
     * anything that does not.
     */
    preheader?: string;
  };
}

export async function sendNotificationEmail({
  userId,
  userEmail,
  type,
  emailContent,
}: SendNotificationEmailParams): Promise<void> {
  // features: deployment-wide kill switch, separate from the per-user
  // preference check below. Checked first so a self-hoster who disables
  // email notifications entirely doesn't pay for the preferences query.
  if (!(await getSetting("FEATURE_EMAIL_NOTIFICATIONS"))) return;

  const [shouldSend, tokenResult] = await Promise.all([
    shouldSendNotification(userId, type),
    pool.query<{ unsubscribe_token: string | null }>(
      "SELECT unsubscribe_token FROM users WHERE id = $1",
      [userId],
    ),
  ]);
  if (!shouldSend) return;

  const unsubscribeToken = tokenResult.rows[0]?.unsubscribe_token ?? undefined;

  await sendEmail({
    to: userEmail,
    ...emailContent,
    unsubscribeToken,
  });
}
