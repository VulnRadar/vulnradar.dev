import pool from "./db"
import { sendEmail } from "./email"

export type NotificationType =
  | "security"
  | "login_alerts"
  | "password_changes"
  | "two_factor_changes"
  | "session_alerts"
  | "scan_complete"
  | "scan_failures"
  | "severity_alerts"
  | "schedules"
  | "api_keys"
  | "api_usage_alerts"
  | "webhooks"
  | "webhook_failures"
  | "data_requests"
  | "account_changes"
  | "team_invites"
  | "product_updates"
  | "tips_guides"

const ALL_COLUMNS = [
  "email_security",
  "email_new_login",
  "email_password_change",
  "email_2fa_change",
  "email_session_revoked",
  "email_scan_complete",
  "email_critical_findings",
  "email_regression_alert",
  "email_api_keys",
  "email_api_limit_warning",
  "email_webhooks",
  "email_webhook_failure",
  "email_data_requests",
  "email_account_changes",
  "email_team_invite",
  "email_team_changes",
  "email_product_updates",
  "email_tips_guides",
] as const

export interface NotificationPreferences {
  email_security: boolean
  email_new_login: boolean
  email_password_change: boolean
  email_2fa_change: boolean
  email_session_revoked: boolean
  email_scan_complete: boolean
  email_critical_findings: boolean
  email_regression_alert: boolean
  email_api_keys: boolean
  email_api_limit_warning: boolean
  email_webhooks: boolean
  email_webhook_failure: boolean
  email_data_requests: boolean
  email_account_changes: boolean
  email_team_invite: boolean
  email_team_changes: boolean
  email_product_updates: boolean
  email_tips_guides: boolean
}

const DEFAULT_PREFERENCES: NotificationPreferences = Object.fromEntries(
  ALL_COLUMNS.map((c) => [c, true]),
) as unknown as NotificationPreferences

const TYPE_TO_COLUMN: Record<NotificationType, keyof NotificationPreferences> = {
  security: "email_security",
  login_alerts: "email_new_login",
  password_changes: "email_password_change",
  two_factor_changes: "email_2fa_change",
  session_alerts: "email_session_revoked",
  scan_complete: "email_scan_complete",
  scan_failures: "email_critical_findings",
  severity_alerts: "email_regression_alert",
  schedules: "email_scan_complete",
  api_keys: "email_api_keys",
  api_usage_alerts: "email_api_limit_warning",
  webhooks: "email_webhooks",
  webhook_failures: "email_webhook_failure",
  data_requests: "email_data_requests",
  account_changes: "email_account_changes",
  team_invites: "email_team_invite",
  product_updates: "email_product_updates",
  tips_guides: "email_tips_guides",
}

export async function getNotificationPreferences(userId: number): Promise<NotificationPreferences> {
  const result = await pool.query(
    `SELECT ${ALL_COLUMNS.join(", ")} FROM notification_preferences WHERE user_id = $1`,
    [userId],
  )
  if (result.rows.length === 0) return DEFAULT_PREFERENCES
  return result.rows[0]
}

export async function shouldSendNotification(userId: number, type: NotificationType): Promise<boolean> {
  const prefs = await getNotificationPreferences(userId)
  const column = TYPE_TO_COLUMN[type]
  return column ? prefs[column] : true
}

interface SendNotificationEmailParams {
  userId: number
  userEmail: string
  type: NotificationType
  emailContent: {
    subject: string
    text: string
    html: string
  }
}

export async function sendNotificationEmail({ userId, userEmail, type, emailContent }: SendNotificationEmailParams): Promise<void> {
  const shouldSend = await shouldSendNotification(userId, type)
  if (!shouldSend) return

  await sendEmail({
    to: userEmail,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  })
}
