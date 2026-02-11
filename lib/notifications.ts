import pool from "./db"
import { sendEmail } from "./email"

export type NotificationType = "api_keys" | "webhooks" | "schedules" | "data_requests" | "security"

interface NotificationPreferences {
  email_api_keys: boolean
  email_webhooks: boolean
  email_schedules: boolean
  email_data_requests: boolean
  email_security: boolean
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  email_api_keys: true,
  email_webhooks: true,
  email_schedules: true,
  email_data_requests: true,
  email_security: true,
}

export async function getNotificationPreferences(userId: number): Promise<NotificationPreferences> {
  const result = await pool.query(
    `SELECT email_api_keys, email_webhooks, email_schedules, email_data_requests, email_security
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

  if (!shouldSend) {
    console.log(`Notification email skipped for user ${userId} (type: ${type}) - disabled in preferences`)
    return
  }

  await sendEmail({
    to: userEmail,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  })
}

