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
  "email_login_alerts",
  "email_password_changes",
  "email_two_factor_changes",
  "email_session_alerts",
  "email_scan_complete",
  "email_scan_failures",
  "email_severity_alerts",
  "email_schedules",
  "email_api_keys",
  "email_api_usage_alerts",
  "email_webhooks",
  "email_webhook_failures",
  "email_data_requests",
  "email_account_changes",
  "email_team_invites",
  "email_product_updates",
  "email_tips_guides",
] as const

export interface NotificationPreferences {
  email_security: boolean
  email_login_alerts: boolean
  email_password_changes: boolean
  email_two_factor_changes: boolean
  email_session_alerts: boolean
  email_scan_complete: boolean
  email_scan_failures: boolean
  email_severity_alerts: boolean
  email_schedules: boolean
  email_api_keys: boolean
  email_api_usage_alerts: boolean
  email_webhooks: boolean
  email_webhook_failures: boolean
  email_data_requests: boolean
  email_account_changes: boolean
  email_team_invites: boolean
  email_product_updates: boolean
  email_tips_guides: boolean
}

const DEFAULT_PREFERENCES: NotificationPreferences = Object.fromEntries(
  ALL_COLUMNS.map((c) => [c, true]),
) as unknown as NotificationPreferences

const TYPE_TO_COLUMN: Record<NotificationType, keyof NotificationPreferences> = {
  security: "email_security",
  login_alerts: "email_login_alerts",
  password_changes: "email_password_changes",
  two_factor_changes: "email_two_factor_changes",
  session_alerts: "email_session_alerts",
  scan_complete: "email_scan_complete",
  scan_failures: "email_scan_failures",
  severity_alerts: "email_severity_alerts",
  schedules: "email_schedules",
  api_keys: "email_api_keys",
  api_usage_alerts: "email_api_usage_alerts",
  webhooks: "email_webhooks",
  webhook_failures: "email_webhook_failures",
  data_requests: "email_data_requests",
  account_changes: "email_account_changes",
  team_invites: "email_team_invites",
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
  console.log("[v0] Notification check - userId:", userId, "type:", type, "shouldSend:", shouldSend)
  if (!shouldSend) {
    console.log("[v0] Notification preference disabled, skipping email send")
    return
  }

  console.log("[v0] Sending notification email to:", userEmail)
  await sendEmail({
    to: userEmail,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  })
  console.log("[v0] Notification email sent successfully")
}
