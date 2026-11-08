import pool from "@/lib/database/db";
import { sendEmail } from "@/lib/email/email";
import { getSetting } from "@/lib/config/runtime-config";
import {
  ALL_COLUMNS,
  ALWAYS_ON_COLUMNS,
  DEFAULT_PREFERENCES,
  NOTIFICATION_COLUMNS,
  isSecurityNotification,
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
  const column = NOTIFICATION_COLUMNS[type];
  // "Cannot be switched off" holds here as well as in the writers, so a row
  // saved before they enforced it cannot silence the alert.
  if (ALWAYS_ON_COLUMNS.has(column)) return true;
  const prefs = await getNotificationPreferences(userId);
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

/**
 * Resolves true when the mail was handed to the mailer, false when the
 * deployment, the user's preference or an unverified address held it back. A
 * caller choosing between two messages needs to know which one actually went.
 */
export async function sendNotificationEmail({
  userId,
  userEmail,
  type,
  emailContent,
}: SendNotificationEmailParams): Promise<boolean> {
  const isSecurity = isSecurityNotification(type);

  // features: deployment-wide kill switch, separate from the per-user
  // preference check below. Checked first so a self-hoster who disables
  // email notifications entirely doesn't pay for the preferences query.
  //
  // Security mail is outside it, as the setting's help text says. A deployment
  // that turned off optional mail still has to tell someone their password
  // changed.
  if (!isSecurity && !(await getSetting("FEATURE_EMAIL_NOTIFICATIONS"))) {
    return false;
  }

  // A security notice carries no unsubscribe token, so it gets neither the
  // footer link nor a one-click List-Unsubscribe header (see
  // isSecurityNotification). The token is not even read for one.
  const [shouldSend, accountResult] = await Promise.all([
    shouldSendNotification(userId, type),
    isSecurity
      ? Promise.resolve(null)
      : pool.query<{
          unsubscribe_token: string | null;
          email_verified_at: Date | null;
        }>(
          "SELECT unsubscribe_token, email_verified_at FROM users WHERE id = $1",
          [userId],
        ),
  ]);
  if (!shouldSend) return false;

  // Changing the account email clears email_verified_at, and until the new
  // address is confirmed it may be a typo or someone else's inbox. Scan
  // findings and API activity do not go there. Security notices still do: they
  // are the mail an account owner needs while the address is in question.
  if (accountResult && !accountResult.rows[0]?.email_verified_at) return false;

  const unsubscribeToken =
    accountResult?.rows[0]?.unsubscribe_token ?? undefined;

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
  return true;
}
