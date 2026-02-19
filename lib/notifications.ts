import pool from "./db"
import { sendEmail } from "./email"

export type NotificationType = "api_keys" | "webhooks" | "schedules" | "data_requests" | "security" | "failed_login" | "new_login" | "rate_limit" | "api_key_rotation"

interface NotificationPreferences {
  email_api_keys: boolean
  email_webhooks: boolean
  email_schedules: boolean
  email_data_requests: boolean
  email_security: boolean
  email_failed_login: boolean
  email_new_login: boolean
  email_rate_limit: boolean
  email_api_key_rotation: boolean
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  email_api_keys: true,
  email_webhooks: true,
  email_schedules: true,
  email_data_requests: true,
  email_security: true,
  email_failed_login: true,
  email_new_login: true,
  email_rate_limit: true,
  email_api_key_rotation: true,
}

export async function getNotificationPreferences(userId: number): Promise<NotificationPreferences> {
  const result = await pool.query(
    `SELECT email_api_keys, email_webhooks, email_schedules, email_data_requests, email_security,
            email_failed_login, email_new_login, email_rate_limit, email_api_key_rotation
     FROM notification_preferences WHERE user_id = $1`,
    [userId]
  )

  if (result.rows.length === 0) {
    return DEFAULT_PREFERENCES
  }

  return result.rows[0]
}

export async function shouldSendNotification(userId: number, type: NotificationType): Promise<boolean> {
  const prefs = await getNotificationPreferences(userId)

  switch (type) {
    case "api_keys":
      return prefs.email_api_keys
    case "webhooks":
      return prefs.email_webhooks
    case "schedules":
      return prefs.email_schedules
    case "data_requests":
      return prefs.email_data_requests
    case "security":
      return prefs.email_security
    case "failed_login":
      return prefs.email_failed_login
    case "new_login":
      return prefs.email_new_login
    case "rate_limit":
      return prefs.email_rate_limit
    case "api_key_rotation":
      return prefs.email_api_key_rotation
    default:
      return true
  }
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

  // Debug log to help diagnose unexpected sends
  try {
    const prefs = await getNotificationPreferences(userId)
    console.log(`[Notifications] user=${userId} type=${type} prefs=${JSON.stringify(prefs)} shouldSend=${shouldSend}`)
  } catch (e) {
    console.log(`[Notifications] user=${userId} type=${type} failed to read prefs:`, e)
  }

  await sendEmail({
    to: userEmail,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  })
}
