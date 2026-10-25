import pool from "@/lib/database/db";
import { sendEmail } from "@/lib/email/email";
import { getSetting } from "@/lib/config/runtime-config";
import {
  ALL_COLUMNS,
  DEFAULT_PREFERENCES,
  NOTIFICATION_COLUMNS,
  isSecurityNotification,
  type NotificationColumn,
  type NotificationPrefs,
  type NotificationType,
} from "@/lib/notifications/columns";

/**
 * The column list itself lives in lib/notifications/columns.ts, which has no
 * database import and so can be read by the profile screen, the unsubscribe
 * page and the admin broadcast route as well. It is re-exported here because
 * most server code already imports it from this module.
 */
export {
  ALL_COLUMNS,
  ALWAYS_ON_COLUMNS,
  DEFAULT_PREFERENCES,
  NOTIFICATION_COLUMNS,
  isNotificationColumn,
} from "@/lib/notifications/columns";
export type {
  NotificationColumn,
  NotificationPrefs,
  NotificationType,
} from "@/lib/notifications/columns";

export async function getNotificationPreferences(
  userId: number,
): Promise<NotificationPrefs> {
  const result = await pool.query(
    `SELECT ${ALL_COLUMNS.join(", ")} FROM notification_preferences WHERE user_id = $1`,
    [userId],
  );
  if (result.rows.length === 0) return { ...DEFAULT_PREFERENCES };
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
    /** Which template this is. Every builder in lib/email/email.ts sets it. */
    template?: string;
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

  // A security notice carries no unsubscribe token, so it gets neither the
  // footer link nor a one-click List-Unsubscribe header (see
  // isSecurityNotification). The token is not even read for one.
  const wantsToken = !isSecurityNotification(type);
  const [shouldSend, tokenResult] = await Promise.all([
    shouldSendNotification(userId, type),
    wantsToken
      ? pool.query<{ unsubscribe_token: string | null }>(
          "SELECT unsubscribe_token FROM users WHERE id = $1",
          [userId],
        )
      : Promise.resolve(null),
  ]);
  if (!shouldSend) return;

  const unsubscribeToken = tokenResult?.rows[0]?.unsubscribe_token ?? undefined;

  await sendEmail({
    to: userEmail,
    ...emailContent,
    unsubscribeToken,
    // The one-click header turns off this message's own category and nothing
    // else. Without a token there is nothing to scope, so none is passed.
    unsubscribeColumn: unsubscribeToken
      ? NOTIFICATION_COLUMNS[type]
      : undefined,
  });
}
