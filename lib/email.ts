import nodemailer from "nodemailer"
import { APP_NAME, APP_URL, SUPPORT_EMAIL, LOGO_URL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } from "@/lib/constants"

const COLORS = {
  BG_DARK: "#0a0e13",
  BG_CARD: "#0f172a",
  BG_SECTION: "#1e293b",
  BG_INFO: "#1e3a5f",
  BG_SUCCESS: "#052e16",
  BG_WARNING: "#422006",
  BG_DANGER: "#450a0a",
  BORDER: "#1e293b",
  BORDER_SECTION: "#334155",
  TEXT_PRIMARY: "#f8fafc",
  TEXT_SECONDARY: "#94a3b8",
  TEXT_MUTED: "#64748b",
  TEXT_DARK: "#475569",
  ACCENT_BLUE: "#2563eb",
  ACCENT_BLUE_LIGHT: "#3b82f6",
  ACCENT_BLUE_PALE: "#93c5fd",
  ACCENT_GREEN: "#22c55e",
  ACCENT_GREEN_LIGHT: "#86efac",
  ACCENT_GREEN_PALE: "#bbf7d0",
  ACCENT_GREEN_TEXT: "#10b981",
  ACCENT_YELLOW: "#f59e0b",
  ACCENT_YELLOW_LIGHT: "#fbbf24",
  ACCENT_YELLOW_PALE: "#fef3c7",
  ACCENT_RED: "#dc2626",
  ACCENT_RED_LIGHT: "#fca5a5",
  ACCENT_RED_PALE: "#fecaca",
  WHITE: "#ffffff",
} as const

// Only create transporter if SMTP is configured
const transporter = SMTP_HOST && SMTP_USER && SMTP_PASS
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null

interface SendEmailOptions {
  to: string
  subject: string
  text: string
  html: string
  replyTo?: string
  skipLayout?: boolean
}

interface SecurityAlertDetails {
  ipAddress: string
  userAgent: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${APP_NAME}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${COLORS.BG_DARK}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #e5e7eb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${COLORS.BG_DARK}; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 0 0 20px 0; text-align: center;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <img src="${LOGO_URL}" alt="${APP_NAME}" width="48" height="48" style="display: block; margin: 0 auto;" />
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: ${COLORS.TEXT_PRIMARY}; letter-spacing: -0.3px;">${APP_NAME}</h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 0 24px 0;">
              <div style="height: 2px; background: linear-gradient(90deg, ${COLORS.ACCENT_BLUE}, ${COLORS.ACCENT_BLUE_LIGHT}); border-radius: 999px;"></div>
            </td>
          </tr>
          <tr>
            <td style="background-color: ${COLORS.BG_CARD}; border: 1px solid ${COLORS.BORDER}; border-radius: 12px; padding: 32px 28px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 20px 0 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="text-align: center;">
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED}; line-height: 1.6;">
                      <a href="${APP_URL}" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">${new URL(APP_URL).hostname}</a>
                    </p>
                    <p style="margin: 0; font-size: 11px; color: ${COLORS.TEXT_DARK}; line-height: 1.5;">
                      ${APP_NAME} - Web Vulnerability Scanner<br />
                      This is an automated message. Please do not reply directly.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function securityDetailsBlock(details: SecurityAlertDetails): string {
  return `
    <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
      <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED}; font-weight: 600;">Session Details</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 13px; line-height: 1.8;">
        <tr>
          <td style="padding: 4px 0; width: 100px; color: ${COLORS.TEXT_SECONDARY};">IP Address</td>
          <td style="padding: 4px 0; color: #f1f5f9; font-family: monospace;">${escapeHtml(details.ipAddress)}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; width: 100px; color: ${COLORS.TEXT_SECONDARY};">Device</td>
          <td style="padding: 4px 0; color: #f1f5f9; font-size: 12px;">${escapeHtml(details.userAgent.length > 80 ? details.userAgent.substring(0, 80) + "..." : details.userAgent)}</td>
        </tr>
      </table>
    </div>
  `
}

function securityWarningBlock(): string {
  return `
    <div style="background-color: ${COLORS.BG_DANGER}; border-left: 3px solid ${COLORS.ACCENT_RED}; border-radius: 6px; padding: 14px 16px;">
      <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_RED_LIGHT}; font-weight: 600;">Wasn't you?</p>
      <p style="margin: 0; font-size: 13px; color: ${COLORS.ACCENT_RED_PALE}; line-height: 1.6;">
        If you did not make this change, your account may be compromised. Please reset your password immediately and contact support at ${SUPPORT_EMAIL}
      </p>
    </div>
  `
}

export async function sendEmail({ to, subject, text, html, replyTo, skipLayout }: SendEmailOptions) {
  // Check if SMTP is configured
  if (!transporter) {
    console.warn("SMTP not configured. Email not sent:")
    console.warn(`  To: ${to}`)
    console.warn(`  Subject: ${subject}`)
    console.warn(`  Text: ${text.substring(0, 200)}...`)

    // In development, just log and return successfully
    if (process.env.NODE_ENV !== "production") {
      console.warn("  (Skipping email send in development - SMTP not configured)")
      return
    }

    throw new Error("Email service not configured")
  }

  const from = `"${APP_NAME}" <${SMTP_FROM}>`
  const finalHtml = skipLayout ? html : layout(html)
  await transporter.sendMail({ from, to, subject, text, html: finalHtml, replyTo })
}

export function contactEmail(input: { name: string; email: string; subject: string; message: string; category: string }) {
  const name = escapeHtml(input.name)
  const email = escapeHtml(input.email)
  const subject = escapeHtml(input.subject)
  const message = escapeHtml(input.message).replace(/\n/g, "<br />")
  const category = escapeHtml(input.category)

  return {
    subject: `[Contact] ${input.subject}`,
    text: `Category: ${input.category}\nName: ${input.name}\nEmail: ${input.email}\n\n${input.message}`,
    html: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
        <tr>
          <td>
            <span style="display: inline-block; padding: 6px 12px; border-radius: 6px; background-color: ${COLORS.BG_SECTION}; border: 1px solid ${COLORS.BORDER_SECTION}; color: ${COLORS.TEXT_SECONDARY}; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 12px;">
              ${category}
            </span>
            <h1 style="margin: 8px 0 0 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">New Contact Request</h1>
          </td>
        </tr>
      </table>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED}; font-weight: 600;">Contact Details</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.8;">
          <tr><td style="padding: 4px 0; width: 80px; color: ${COLORS.TEXT_SECONDARY};">Name</td><td style="padding: 4px 0; color: #f1f5f9;">${name}</td></tr>
          <tr><td style="padding: 4px 0; width: 80px; color: ${COLORS.TEXT_SECONDARY};">Email</td><td style="padding: 4px 0;"><a href="mailto:${email}" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">${email}</a></td></tr>
          <tr><td style="padding: 4px 0; width: 80px; color: ${COLORS.TEXT_SECONDARY};">Subject</td><td style="padding: 4px 0; color: #f1f5f9;">${subject}</td></tr>
        </table>
      </div>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED}; font-weight: 600;">Message</p>
        <div style="font-size: 14px; color: #e2e8f0; line-height: 1.7;">${message}</div>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
        <tr>
          <td align="center">
            <a href="mailto:${email}" style="display: inline-block; padding: 12px 28px; background-color: ${COLORS.ACCENT_BLUE}; color: ${COLORS.WHITE}; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px;">Reply to ${name}</a>
          </td>
        </tr>
      </table>
    `,
  }
}

export function contactConfirmationEmail(input: { name: string; category: string }) {
  const name = escapeHtml(input.name)
  const category = escapeHtml(input.category)

  return {
    subject: "We received your message",
    text: `Hi ${input.name},\n\nThanks for contacting ${APP_NAME}. We received your ${input.category.toLowerCase()} and our team will review it shortly.\n\nIf you need to add more details, just reply to this email.\n\n- ${APP_NAME} Support`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Message Received</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Hi ${name}, thank you for reaching out.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding: 4px 0;"><p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Request Type</p><p style="margin: 0; font-size: 15px; color: ${COLORS.TEXT_PRIMARY}; font-weight: 500;">${category}</p></td></tr>
          <tr><td style="padding: 12px 0 4px 0; border-top: 1px solid ${COLORS.BORDER_SECTION};"><p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Status</p><p style="margin: 0; font-size: 15px; color: ${COLORS.ACCENT_GREEN_TEXT}; font-weight: 500;">In Review</p></td></tr>
        </table>
      </div>
      <div style="background-color: ${COLORS.BG_INFO}; border-left: 3px solid ${COLORS.ACCENT_BLUE_LIGHT}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_BLUE_PALE}; font-weight: 600;">What happens next?</p>
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">Our team will review your message and respond within 24-48 hours. If you need to add more context, reply to this email.</p>
      </div>
      <p style="margin: 0; font-size: 13px; color: ${COLORS.TEXT_MUTED}; text-align: center;">Thank you for using ${APP_NAME}.</p>
    `,
  }
}

export function emailVerificationEmail(name: string, verifyLink: string) {
  const safeName = escapeHtml(name)
  return {
    subject: `Verify your email - ${APP_NAME}`,
    text: `Welcome to ${APP_NAME}, ${name}!\n\nPlease verify your email address by clicking the link below:\n${verifyLink}\n\nThis link expires in 24 hours.\n\nIf you did not create an account, you can safely ignore this email.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Welcome to ${APP_NAME}!</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Hi ${safeName}, thanks for signing up. Please verify your email address to get started.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td align="center">
            <a href="${verifyLink}" style="display: inline-block; padding: 14px 40px; background-color: ${COLORS.ACCENT_GREEN}; color: ${COLORS.WHITE}; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">Verify Email Address</a>
          </td>
        </tr>
      </table>
      <div style="background-color: ${COLORS.BG_INFO}; border-left: 3px solid ${COLORS.ACCENT_BLUE_LIGHT}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_BLUE_PALE}; font-weight: 600;">Why verify?</p>
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">Email verification helps us ensure your account is secure and allows you to receive important notifications about your scans.</p>
      </div>
      <div style="background-color: ${COLORS.BG_WARNING}; border-left: 3px solid ${COLORS.ACCENT_YELLOW}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_YELLOW_LIGHT}; font-weight: 600;">Link Expires</p>
        <p style="margin: 0; font-size: 13px; color: ${COLORS.ACCENT_YELLOW_PALE}; line-height: 1.6;">This verification link expires in 24 hours. If you need a new link, you can request one from the login page.</p>
      </div>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 14px 16px;">
        <p style="margin: 0 0 8px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">If the button doesn't work, copy this link:</p>
        <p style="margin: 0; font-size: 12px; color: ${COLORS.ACCENT_BLUE_LIGHT}; word-break: break-all; line-height: 1.5; font-family: monospace;">${verifyLink}</p>
      </div>
    `,
  }
}

export function passwordResetEmail(resetLink: string) {
  return {
    subject: `Reset your ${APP_NAME} password`,
    text: `You requested a password reset for your ${APP_NAME} account.\n\nClick here to reset your password:\n${resetLink}\n\nThis link expires in 1 hour.\n\nIf you did not request this, you can safely ignore this email.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Reset Your Password</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">We received a request to reset your ${APP_NAME} account password.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td align="center">
            <a href="${resetLink}" style="display: inline-block; padding: 14px 40px; background-color: ${COLORS.ACCENT_BLUE}; color: ${COLORS.WHITE}; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">Reset Password</a>
          </td>
        </tr>
      </table>
      <div style="background-color: ${COLORS.BG_WARNING}; border-left: 3px solid ${COLORS.ACCENT_YELLOW}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_YELLOW_LIGHT}; font-weight: 600;">Security Notice</p>
        <p style="margin: 0; font-size: 13px; color: ${COLORS.ACCENT_YELLOW_PALE}; line-height: 1.6;">This link expires in 1 hour. If you did not request this reset, please ignore this email.</p>
      </div>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 14px 16px;">
        <p style="margin: 0 0 8px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">If the button doesn't work, copy this link:</p>
        <p style="margin: 0; font-size: 12px; color: ${COLORS.ACCENT_BLUE_LIGHT}; word-break: break-all; line-height: 1.5; font-family: monospace;">${resetLink}</p>
      </div>
    `,
  }
}

export function passwordChangedEmail(hasTwoFactor: boolean, details: SecurityAlertDetails) {
  const securityInfo = hasTwoFactor
    ? "Your account has two-factor authentication enabled. You will need your 6-digit authenticator code when logging in."
    : "All active sessions have been logged out. You can now log in with your new password."

  return {
    subject: `Password Changed - ${APP_NAME}`,
    text: `Your ${APP_NAME} account password has been successfully reset.\n\n${securityInfo}\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not make this change, please contact support immediately at ${SUPPORT_EMAIL}\n\n- ${APP_NAME} Security`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Password Changed Successfully</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your ${APP_NAME} account password has been reset.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Security Information</p>
        <p style="margin: 0; font-size: 14px; color: #e2e8f0; line-height: 1.6;">${securityInfo}</p>
      </div>
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  }
}

export function teamInviteEmail(teamName: string, inviteLink: string, invitedBy: string) {
  return {
    subject: `You've been invited to join ${teamName} on ${APP_NAME}`,
    text: `${invitedBy} has invited you to join the team "${teamName}" on ${APP_NAME}.\n\nClick here to accept the invitation:\n${inviteLink}\n\nThis invitation expires in 7 days.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Team Invitation</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;"><strong style="color: ${COLORS.TEXT_PRIMARY};">${invitedBy}</strong> has invited you to join their team.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 20px; margin-bottom: 24px; text-align: center;">
        <p style="margin: 0 0 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED};">Team Name</p>
        <h2 style="margin: 0; font-size: 22px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">${teamName}</h2>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td align="center">
            <a href="${inviteLink}" style="display: inline-block; padding: 14px 40px; background-color: ${COLORS.ACCENT_BLUE}; color: ${COLORS.WHITE}; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">Accept Invitation</a>
          </td>
        </tr>
      </table>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 10px 0; font-size: 13px; color: ${COLORS.TEXT_SECONDARY}; font-weight: 600;">As a team member you can:</p>
        <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #cbd5e1; line-height: 1.8;">
          <li>Collaborate on vulnerability scans</li>
          <li>Share scan history and reports</li>
          <li>Access team-wide security insights</li>
        </ul>
      </div>
      <p style="margin: 0 0 16px 0; font-size: 13px; color: ${COLORS.TEXT_MUTED}; text-align: center;">This invitation expires in 7 days.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 14px 16px;">
        <p style="margin: 0 0 8px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">If the button doesn't work, copy this link:</p>
        <p style="margin: 0; font-size: 11px; color: ${COLORS.ACCENT_BLUE_LIGHT}; word-break: break-all; line-height: 1.5; font-family: monospace;">${inviteLink}</p>
      </div>
    `,
  }
}

export function landingContactEmail(input: { email: string; message: string }) {
  const email = escapeHtml(input.email)
  const message = escapeHtml(input.message).replace(/\n/g, "<br />")

  return {
    subject: "[Landing Page] New Inquiry",
    text: `New Landing Page Inquiry\n\nEmail: ${input.email}\n\nMessage:\n${input.message}`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">New Landing Page Inquiry</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Someone reached out via the ${APP_NAME} landing page.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED}; font-weight: 600;">Contact Info</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.8;">
          <tr><td style="padding: 4px 0; width: 80px; color: ${COLORS.TEXT_SECONDARY};">Email</td><td style="padding: 4px 0;"><a href="mailto:${email}" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">${email}</a></td></tr>
        </table>
      </div>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED}; font-weight: 600;">Message</p>
        <div style="font-size: 14px; color: #e2e8f0; line-height: 1.7;">${message}</div>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
        <tr>
          <td align="center">
            <a href="mailto:${email}" style="display: inline-block; padding: 12px 28px; background-color: ${COLORS.ACCENT_BLUE}; color: ${COLORS.WHITE}; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px;">Reply</a>
          </td>
        </tr>
      </table>
    `,
  }
}

export function landingContactConfirmationEmail(message: string) {
  const escapedMessage = escapeHtml(message).replace(/\n/g, "<br />")

  return {
    subject: `We received your message - ${APP_NAME}`,
    text: `Thanks for reaching out!\n\nWe've received your message and will get back to you within 24 hours.\n\nYour Message:\n${message}\n\nIn the meantime, feel free to explore our documentation or start scanning for free by creating an account.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Message Received</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Thank you for reaching out. We will get back to you within 24 hours.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED}; font-weight: 600;">Your Message</p>
        <div style="font-size: 14px; color: #e2e8f0; line-height: 1.7;">${escapedMessage}</div>
      </div>
      <div style="background-color: ${COLORS.BG_INFO}; border-left: 3px solid ${COLORS.ACCENT_BLUE_LIGHT}; border-radius: 6px; padding: 14px 16px;">
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">In the meantime, feel free to explore our <a href="${APP_URL}/docs" style="color: ${COLORS.ACCENT_BLUE_PALE}; text-decoration: none;">documentation</a> or start scanning by <a href="${APP_URL}/signup" style="color: ${COLORS.ACCENT_BLUE_PALE}; text-decoration: none;">creating an account</a>.</p>
      </div>
    `,
  }
}

export function profileNameChangedEmail(oldName: string, newName: string, details: SecurityAlertDetails) {
  return {
    subject: `Profile Name Changed - ${APP_NAME}`,
    text: `Your ${APP_NAME} profile name has been changed.\n\nPrevious Name: ${oldName}\nNew Name: ${newName}\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not make this change, please reset your password immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Profile Name Changed</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your ${APP_NAME} account name has been updated.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.8;">
          <tr><td style="padding: 4px 0; width: 120px; color: ${COLORS.TEXT_SECONDARY};">Previous Name</td><td style="padding: 4px 0; color: #f1f5f9;">${escapeHtml(oldName)}</td></tr>
          <tr><td style="padding: 4px 0; width: 120px; color: ${COLORS.TEXT_SECONDARY};">New Name</td><td style="padding: 4px 0; color: ${COLORS.ACCENT_GREEN_TEXT}; font-weight: 500;">${escapeHtml(newName)}</td></tr>
        </table>
      </div>
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  }
}

export function profileEmailChangedEmail(oldEmail: string, newEmail: string, details: SecurityAlertDetails) {
  return {
    subject: `Email Address Changed - ${APP_NAME}`,
    text: `Your ${APP_NAME} account email has been changed.\n\nPrevious Email: ${oldEmail}\nNew Email: ${newEmail}\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not make this change, please contact support immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Email Address Changed</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your ${APP_NAME} account email has been updated.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.8;">
          <tr><td style="padding: 4px 0; width: 120px; color: ${COLORS.TEXT_SECONDARY};">Previous Email</td><td style="padding: 4px 0; color: #f1f5f9;">${escapeHtml(oldEmail)}</td></tr>
          <tr><td style="padding: 4px 0; width: 120px; color: ${COLORS.TEXT_SECONDARY};">New Email</td><td style="padding: 4px 0; color: ${COLORS.ACCENT_GREEN_TEXT}; font-weight: 500;">${escapeHtml(newEmail)}</td></tr>
        </table>
      </div>
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  }
}

export function profilePasswordChangedEmail(details: SecurityAlertDetails) {
  return {
    subject: `Password Changed - ${APP_NAME}`,
    text: `Your ${APP_NAME} account password has been changed.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not make this change, please reset your password immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Password Changed</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your ${APP_NAME} account password has been successfully updated.</p>
      <div style="background-color: ${COLORS.BG_INFO}; border-left: 3px solid ${COLORS.ACCENT_BLUE_LIGHT}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">For security, you may want to review your active sessions in your profile settings.</p>
      </div>
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  }
}

export function twoFactorEnabledEmail(details: SecurityAlertDetails) {
  return {
    subject: `Two-Factor Authentication Enabled - ${APP_NAME}`,
    text: `Two-factor authentication has been enabled on your ${APP_NAME} account.\n\nYour account is now more secure. You will need to enter a code from your authenticator app when logging in.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not enable 2FA, please contact support immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Two-Factor Authentication Enabled</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Two-factor authentication has been enabled on your account.</p>
      <div style="background-color: ${COLORS.BG_SUCCESS}; border-left: 3px solid ${COLORS.ACCENT_GREEN}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_GREEN_LIGHT}; font-weight: 600;">Enhanced Security Active</p>
        <p style="margin: 0; font-size: 13px; color: ${COLORS.ACCENT_GREEN_PALE}; line-height: 1.6;">Your account is now protected with two-factor authentication. You'll need your authenticator app to log in.</p>
      </div>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="margin: 0 0 8px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Remember to:</p>
        <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #cbd5e1; line-height: 1.8;">
          <li>Store your backup codes in a safe place</li>
          <li>Keep your authenticator app accessible</li>
        </ul>
      </div>
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  }
}

export function twoFactorDisabledEmail(details: SecurityAlertDetails) {
  return {
    subject: `Two-Factor Authentication Disabled - ${APP_NAME}`,
    text: `Two-factor authentication has been disabled on your ${APP_NAME} account.\n\nYour account no longer requires a 2FA code to log in.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not disable 2FA, please re-enable it and reset your password immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Two-Factor Authentication Disabled</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Two-factor authentication has been removed from your account.</p>
      <div style="background-color: ${COLORS.BG_WARNING}; border-left: 3px solid ${COLORS.ACCENT_YELLOW}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_YELLOW_LIGHT}; font-weight: 600;">Security Reduced</p>
        <p style="margin: 0; font-size: 13px; color: ${COLORS.ACCENT_YELLOW_PALE}; line-height: 1.6;">Your account is no longer protected with two-factor authentication. Consider re-enabling it for better security.</p>
      </div>
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  }
}

export function backupCodesRegeneratedEmail(details: SecurityAlertDetails) {
  return {
    subject: `Backup Codes Regenerated - ${APP_NAME}`,
    text: `Your ${APP_NAME} two-factor authentication backup codes have been regenerated.\n\nAll previous backup codes are now invalid. Please store your new codes securely.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not regenerate your backup codes, please contact support immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Backup Codes Regenerated</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your two-factor authentication backup codes have been regenerated.</p>
      <div style="background-color: ${COLORS.BG_WARNING}; border-left: 3px solid ${COLORS.ACCENT_YELLOW}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_YELLOW_LIGHT}; font-weight: 600;">Previous Codes Invalidated</p>
        <p style="margin: 0; font-size: 13px; color: ${COLORS.ACCENT_YELLOW_PALE}; line-height: 1.6;">All previous backup codes are now invalid. Make sure to store your new codes in a secure location.</p>
      </div>
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  }
}

// API Key emails
export function apiKeyCreatedEmail(keyName: string, keyPrefix: string, details: SecurityAlertDetails) {
  const safeName = escapeHtml(keyName)
  return {
    subject: `API Key Created - ${APP_NAME}`,
    text: `A new API key "${keyName}" has been created on your ${APP_NAME} account.\n\nKey Prefix: ${keyPrefix}...\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not create this API key, please revoke it immediately and contact support.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">API Key Created</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">A new API key has been created on your account.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Key Name</p>
        <p style="margin: 0 0 12px 0; font-size: 15px; color: ${COLORS.TEXT_PRIMARY}; font-weight: 500;">${safeName}</p>
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Key Prefix</p>
        <p style="margin: 0; font-size: 15px; color: ${COLORS.ACCENT_BLUE_LIGHT}; font-family: monospace;">${keyPrefix}...</p>
      </div>
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  }
}

export function apiKeyDeletedEmail(keyName: string, details: SecurityAlertDetails) {
  const safeName = escapeHtml(keyName)
  return {
    subject: `API Key Revoked - ${APP_NAME}`,
    text: `The API key "${keyName}" has been revoked from your ${APP_NAME} account.\n\nThis key can no longer be used for API access.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not revoke this API key, please contact support immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">API Key Revoked</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">An API key has been revoked from your account.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Key Name</p>
        <p style="margin: 0 0 12px 0; font-size: 15px; color: ${COLORS.TEXT_PRIMARY}; font-weight: 500;">${safeName}</p>
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Status</p>
        <p style="margin: 0; font-size: 15px; color: ${COLORS.ACCENT_RED}; font-weight: 500;">Revoked</p>
      </div>
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  }
}

// Webhook emails
export function webhookCreatedEmail(webhookName: string, webhookUrl: string, webhookType: string, details: SecurityAlertDetails) {
  const safeName = escapeHtml(webhookName)
  const safeType = escapeHtml(webhookType)
  return {
    subject: `Webhook Created - ${APP_NAME}`,
    text: `A new ${webhookType} webhook "${webhookName}" has been created on your ${APP_NAME} account.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not create this webhook, please delete it immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Webhook Created</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">A new webhook has been added to your account.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Webhook Name</p>
        <p style="margin: 0 0 12px 0; font-size: 15px; color: ${COLORS.TEXT_PRIMARY}; font-weight: 500;">${safeName}</p>
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Type</p>
        <p style="margin: 0; font-size: 15px; color: ${COLORS.ACCENT_BLUE_LIGHT}; font-weight: 500;">${safeType}</p>
      </div>
      ${securityDetailsBlock(details)}
      <div style="background-color: ${COLORS.BG_INFO}; border-left: 3px solid ${COLORS.ACCENT_BLUE_LIGHT}; border-radius: 6px; padding: 14px 16px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_BLUE_PALE}; font-weight: 600;">Didn't do this?</p>
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">If you did not create this webhook, please delete it from your profile settings immediately.</p>
      </div>
    `,
  }
}

export function webhookDeletedEmail(webhookName: string, details: SecurityAlertDetails) {
  const safeName = escapeHtml(webhookName)
  return {
    subject: `Webhook Deleted - ${APP_NAME}`,
    text: `The webhook "${webhookName}" has been deleted from your ${APP_NAME} account.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not delete this webhook, please contact support.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Webhook Deleted</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">A webhook has been removed from your account.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Webhook Name</p>
        <p style="margin: 0 0 12px 0; font-size: 15px; color: ${COLORS.TEXT_PRIMARY}; font-weight: 500;">${safeName}</p>
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Status</p>
        <p style="margin: 0; font-size: 15px; color: ${COLORS.ACCENT_RED}; font-weight: 500;">Deleted</p>
      </div>
      ${securityDetailsBlock(details)}
    `,
  }
}

// Scheduled scan emails
export function scheduleCreatedEmail(url: string, frequency: string, details: SecurityAlertDetails) {
  const safeUrl = escapeHtml(url)
  const safeFrequency = escapeHtml(frequency)
  return {
    subject: `Scheduled Scan Created - ${APP_NAME}`,
    text: `A new scheduled scan has been created for ${url} (${frequency}).\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not create this schedule, please delete it from your profile.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Scheduled Scan Created</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">A new scheduled scan has been added to your account.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">URL</p>
        <p style="margin: 0 0 12px 0; font-size: 15px; color: ${COLORS.ACCENT_BLUE_LIGHT}; word-break: break-all;">${safeUrl}</p>
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Frequency</p>
        <p style="margin: 0; font-size: 15px; color: ${COLORS.TEXT_PRIMARY}; font-weight: 500; text-transform: capitalize;">${safeFrequency}</p>
      </div>
      ${securityDetailsBlock(details)}
    `,
  }
}

export function scheduleDeletedEmail(url: string, details: SecurityAlertDetails) {
  const safeUrl = escapeHtml(url)
  return {
    subject: `Scheduled Scan Deleted - ${APP_NAME}`,
    text: `The scheduled scan for ${url} has been deleted from your ${APP_NAME} account.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Scheduled Scan Deleted</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">A scheduled scan has been removed from your account.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">URL</p>
        <p style="margin: 0 0 12px 0; font-size: 15px; color: ${COLORS.ACCENT_BLUE_LIGHT}; word-break: break-all;">${safeUrl}</p>
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Status</p>
        <p style="margin: 0; font-size: 15px; color: ${COLORS.ACCENT_RED}; font-weight: 500;">Deleted</p>
      </div>
      ${securityDetailsBlock(details)}
    `,
  }
}

// Data request emails
export function dataRequestCreatedEmail(requestType: string, details: SecurityAlertDetails) {
  const safeType = escapeHtml(requestType)
  const typeLabel = requestType === "export" ? "Data Export" : "Account Deletion"
  return {
    subject: `${typeLabel} Request Submitted - ${APP_NAME}`,
    text: `A ${typeLabel.toLowerCase()} request has been submitted for your ${APP_NAME} account.\n\nOur team will process your request within 30 days as required by privacy regulations.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not make this request, please contact support immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">${typeLabel} Request Submitted</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your ${typeLabel.toLowerCase()} request has been received.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Request Type</p>
        <p style="margin: 0 0 12px 0; font-size: 15px; color: ${COLORS.TEXT_PRIMARY}; font-weight: 500;">${typeLabel}</p>
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Status</p>
        <p style="margin: 0; font-size: 15px; color: ${COLORS.ACCENT_YELLOW}; font-weight: 500;">Pending Review</p>
      </div>
      <div style="background-color: ${COLORS.BG_INFO}; border-left: 3px solid ${COLORS.ACCENT_BLUE_LIGHT}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_BLUE_PALE}; font-weight: 600;">What happens next?</p>
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">Our team will process your request within 30 days as required by GDPR and other privacy regulations. You'll receive an email when it's complete.</p>
      </div>
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  }
}

// Security notification emails
export function newLoginEmail(location: string, ipAddress: string, details: SecurityAlertDetails) {
  return {
    subject: `New login to your ${APP_NAME} account`,
    text: `Your account was just accessed from:\n\nLocation: ${location}\nIP Address: ${ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, please secure your account immediately by changing your password.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">New Login Detected</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your ${APP_NAME} account was just accessed. Here are the details:</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px;">
          <tr><td style="padding: 8px 0; color: ${COLORS.TEXT_MUTED}; width: 120px;">Location</td><td style="padding: 8px 0; color: ${COLORS.TEXT_PRIMARY};">${escapeHtml(location)}</td></tr>
          <tr><td style="padding: 8px 0; color: ${COLORS.TEXT_MUTED}; border-top: 1px solid ${COLORS.BORDER};">IP Address</td><td style="padding: 8px 0; color: ${COLORS.TEXT_PRIMARY}; border-top: 1px solid ${COLORS.BORDER}; font-family: monospace;">${escapeHtml(ipAddress)}</td></tr>
          <tr><td style="padding: 8px 0; color: ${COLORS.TEXT_MUTED}; border-top: 1px solid ${COLORS.BORDER};">Device</td><td style="padding: 8px 0; color: ${COLORS.TEXT_PRIMARY}; border-top: 1px solid ${COLORS.BORDER};">${escapeHtml(details.userAgent)}</td></tr>
        </table>
      </div>
      <div style="background-color: ${COLORS.BG_INFO}; border-left: 3px solid ${COLORS.ACCENT_BLUE_LIGHT}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_BLUE_PALE}; font-weight: 600;">Recognize this login?</p>
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">If this was you, you can safely ignore this email. ${APP_NAME} sends this notification for your security.</p>
      </div>
      <div style="background-color: ${COLORS.BG_DANGER}; border-left: 3px solid ${COLORS.ACCENT_RED}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_RED_LIGHT}; font-weight: 600;">Don't recognize this?</p>
        <p style="margin: 0; font-size: 13px; color: #fecaca; line-height: 1.6;">Change your password immediately. If you suspect unauthorized access, contact our support team right away.</p>
      </div>
    `,
  }
}

export function failedLoginAttemptsEmail(attempts: number, ipAddress: string, details: SecurityAlertDetails) {
  return {
    subject: `Failed login attempts on your ${APP_NAME} account`,
    text: `We detected ${attempts} failed login attempts on your account.\n\nIP Address: ${ipAddress}\nDevice: ${details.userAgent}\n\nYour account has been temporarily protected. If this wasn't you, change your password immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Failed Login Attempts</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">We detected multiple failed login attempts on your account.</p>
      <div style="background-color: ${COLORS.BG_DANGER}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.ACCENT_RED_LIGHT}; text-transform: uppercase; font-weight: 600;">Failed Attempts</p>
            <p style="margin: 0; font-size: 28px; color: ${COLORS.ACCENT_RED_PALE}; font-weight: 700;">${attempts}x</p>
          </div>
          <div style="text-align: right;">
            <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.ACCENT_RED_LIGHT}; text-transform: uppercase; font-weight: 600;">Status</p>
            <p style="margin: 0; font-size: 14px; color: ${COLORS.ACCENT_RED_PALE}; font-weight: 600;">Protected</p>
          </div>
        </div>
      </div>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px;">
          <tr><td style="padding: 8px 0; color: ${COLORS.TEXT_MUTED}; width: 120px;">IP Address</td><td style="padding: 8px 0; color: ${COLORS.TEXT_PRIMARY}; font-family: monospace;">${escapeHtml(ipAddress)}</td></tr>
          <tr><td style="padding: 8px 0; color: ${COLORS.TEXT_MUTED}; border-top: 1px solid ${COLORS.BORDER};">Device</td><td style="padding: 8px 0; color: ${COLORS.TEXT_PRIMARY}; border-top: 1px solid ${COLORS.BORDER};">${escapeHtml(details.userAgent)}</td></tr>
        </table>
      </div>
      <div style="background-color: ${COLORS.BG_WARNING}; border-left: 3px solid ${COLORS.ACCENT_YELLOW}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_YELLOW_LIGHT}; font-weight: 600;">What to do</p>
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #fef3c7; line-height: 1.6;">If this was you, no action is needed. If you don't recognize these attempts, change your password and enable two-factor authentication immediately.</p>
      </div>
    `,
  }
}

export function rateLimitedEmail(ipAddress: string, details: SecurityAlertDetails) {
  return {
    subject: `API Rate Limit - ${APP_NAME}`,
    text: `Your ${APP_NAME} API key has been temporarily rate limited due to excessive requests.\n\nIP Address: ${ipAddress}\n\nYour account will resume normal operation shortly. If you believe this is an error, contact support.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">API Rate Limited</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your API key has been temporarily rate limited due to exceeding the request limit.</p>
      <div style="background-color: ${COLORS.BG_WARNING}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${COLORS.ACCENT_YELLOW_LIGHT}; text-transform: uppercase; font-weight: 600;">Status</p>
        <p style="margin: 0; font-size: 15px; color: ${COLORS.ACCENT_YELLOW_PALE}; font-weight: 500;">Rate Limited</p>
      </div>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 8px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED}; text-transform: uppercase; font-weight: 600;">Details</p>
        <p style="margin: 0 0 4px 0; font-size: 14px; color: ${COLORS.TEXT_PRIMARY};">IP Address: <span style="font-family: monospace;">${escapeHtml(ipAddress)}</span></p>
        <p style="margin: 0; font-size: 14px; color: ${COLORS.TEXT_PRIMARY};">Limit based on your subscription plan</p>
      </div>
      <div style="background-color: ${COLORS.BG_INFO}; border-left: 3px solid ${COLORS.ACCENT_BLUE_LIGHT}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_BLUE_PALE}; font-weight: 600;">What happens next</p>
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">Your rate limit will reset after 24 hours. Review your API usage in your dashboard to optimize your requests.</p>
      </div>
    `,
  }
}

export function apiKeyRotationEmail(keyName: string, newKeyCreatedAt: string, details: SecurityAlertDetails) {
  return {
    subject: `API Key Rotated - ${APP_NAME}`,
    text: `An API key has been rotated on your ${APP_NAME} account.\n\nKey: ${keyName}\nCreated: ${newKeyCreatedAt}\n\nIf you did not perform this action, secure your account immediately.\n\nIP Address: ${details.ipAddress}`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">API Key Rotated</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">A new API key has been created for your account.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px;">
          <tr><td style="padding: 8px 0; color: ${COLORS.TEXT_MUTED}; width: 120px;">Key Name</td><td style="padding: 8px 0; color: ${COLORS.TEXT_PRIMARY};">${escapeHtml(keyName)}</td></tr>
          <tr><td style="padding: 8px 0; color: ${COLORS.TEXT_MUTED}; border-top: 1px solid ${COLORS.BORDER};">Created</td><td style="padding: 8px 0; color: ${COLORS.TEXT_PRIMARY}; border-top: 1px solid ${COLORS.BORDER};">${escapeHtml(newKeyCreatedAt)}</td></tr>
          <tr><td style="padding: 8px 0; color: ${COLORS.TEXT_MUTED}; border-top: 1px solid ${COLORS.BORDER};">IP Address</td><td style="padding: 8px 0; color: ${COLORS.TEXT_PRIMARY}; border-top: 1px solid ${COLORS.BORDER}; font-family: monospace;">${escapeHtml(details.ipAddress)}</td></tr>
        </table>
      </div>
      <div style="background-color: ${COLORS.BG_INFO}; border-left: 3px solid ${COLORS.ACCENT_BLUE_LIGHT}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_BLUE_PALE}; font-weight: 600;">Is this you?</p>
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">If you authorized this key rotation, no action is needed. If not, contact our support team immediately.</p>
      </div>
    `,
  }
}

export function email2FACodeEmail(code: string) {
  return {
    subject: `${code} - Your ${APP_NAME} Login Code`,
    text: `Your ${APP_NAME} verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you did not request this code, someone may be trying to access your account. Please secure your account immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Your Login Code</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Enter this code to complete your sign-in.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 24px; margin-bottom: 20px; text-align: center;">
        <p style="margin: 0 0 8px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED}; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Verification Code</p>
        <p style="margin: 0; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: ${COLORS.ACCENT_BLUE_LIGHT}; font-family: monospace;">${escapeHtml(code)}</p>
      </div>
      <div style="background-color: ${COLORS.BG_WARNING}; border-left: 3px solid ${COLORS.ACCENT_YELLOW}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_YELLOW_LIGHT}; font-weight: 600;">Expires in 10 minutes</p>
        <p style="margin: 0; font-size: 13px; color: ${COLORS.ACCENT_YELLOW_PALE}; line-height: 1.6;">Do not share this code with anyone. ${APP_NAME} will never ask you for this code outside of the login page.</p>
      </div>
      ${securityWarningBlock()}
    `,
  }
}

export function email2FAEnabledEmail(details: SecurityAlertDetails) {
  return {
    subject: `Email 2FA Enabled - ${APP_NAME}`,
    text: `Email-based two-factor authentication has been enabled on your ${APP_NAME} account.\n\nYou will receive a verification code via email each time you log in.\n\nIP Address: ${details.ipAddress}`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Email 2FA Enabled</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Email-based two-factor authentication is now active on your account. You will receive a verification code via email each time you sign in.</p>
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  }
}

export function email2FADisabledEmail(details: SecurityAlertDetails) {
  return {
    subject: `Email 2FA Disabled - ${APP_NAME}`,
    text: `Email-based two-factor authentication has been disabled on your ${APP_NAME} account.\n\nIP Address: ${details.ipAddress}`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Email 2FA Disabled</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Email-based two-factor authentication has been removed from your account. Your account is now less secure.</p>
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  }
}

// Admin notification to user (manual message)
export interface AdminNotificationInput {
  userName: string
  adminName: string
  title: string
  message: string
  type?: "info" | "warning" | "success" | "alert"
  timestamp: Date
}

export function adminNotificationEmail(input: AdminNotificationInput) {
  const userName = escapeHtml(input.userName)
  const adminName = escapeHtml(input.adminName)
  const title = escapeHtml(input.title)
  const message = escapeHtml(input.message).replace(/\n/g, "<br>")
  const timestamp = input.timestamp.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  // Color scheme based on type
  const typeColors = {
    info: { bg: COLORS.BG_INFO, border: COLORS.ACCENT_BLUE_LIGHT, text: COLORS.ACCENT_BLUE_PALE, icon: "ℹ️" },
    warning: { bg: COLORS.BG_WARNING, border: COLORS.ACCENT_YELLOW, text: COLORS.ACCENT_YELLOW_PALE, icon: "⚠️" },
    success: { bg: COLORS.BG_SUCCESS, border: COLORS.ACCENT_GREEN, text: COLORS.ACCENT_GREEN_PALE, icon: "✓" },
    alert: { bg: COLORS.BG_DANGER, border: COLORS.ACCENT_RED, text: COLORS.ACCENT_RED_PALE, icon: "!" },
  }
  const colors = typeColors[input.type || "info"]

  return {
    subject: `${title} - ${APP_NAME}`,
    text: `Hi ${input.userName},\n\nYou have received a notification from ${APP_NAME} administration.\n\n${input.title}\n\n${input.message}\n\n---\nSent by: ${input.adminName}\nTimestamp: ${timestamp}\n\nIf you have questions, contact support at ${SUPPORT_EMAIL}`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Message from ${APP_NAME}</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Hi ${userName}, you have received a notification from administration.</p>
      
      <div style="background-color: ${colors.bg}; border-left: 3px solid ${colors.border}; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <p style="margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: ${colors.text};">${title}</p>
        <p style="margin: 0; font-size: 14px; color: ${COLORS.TEXT_PRIMARY}; line-height: 1.7;">${message}</p>
      </div>
      
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 13px; line-height: 1.8;">
          <tr>
            <td style="padding: 4px 0; width: 100px; color: ${COLORS.TEXT_SECONDARY};">From</td>
            <td style="padding: 4px 0; color: ${COLORS.TEXT_PRIMARY};">${adminName} (${APP_NAME} Team)</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; width: 100px; color: ${COLORS.TEXT_SECONDARY};">Sent</td>
            <td style="padding: 4px 0; color: ${COLORS.TEXT_PRIMARY};">${escapeHtml(timestamp)}</td>
          </tr>
        </table>
      </div>
      
      <div style="background-color: ${COLORS.BG_INFO}; border-left: 3px solid ${COLORS.ACCENT_BLUE_LIGHT}; border-radius: 6px; padding: 14px 16px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_BLUE_PALE}; font-weight: 600;">Need Help?</p>
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">
          If you have questions, please contact support at 
          <a href="mailto:${SUPPORT_EMAIL}" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">${SUPPORT_EMAIL}</a>
        </p>
      </div>
    `,
  }
}

// Admin account change notification
export interface ScanCompleteSummary {
  critical: number
  high: number
  medium: number
  low: number
  info: number
  total: number
}

export function scanCompleteEmail(url: string, summary: ScanCompleteSummary, duration: number, scanHistoryId?: number) {
  const safeUrl = escapeHtml(url)
  const durationSecs = (duration / 1000).toFixed(1)
  const viewLink = scanHistoryId ? `${APP_URL}/history/${scanHistoryId}` : `${APP_URL}/history`
  
  const severityBadge = (label: string, count: number, bgColor: string, textColor: string) => count > 0 ? `
    <td style="padding: 0 4px;">
      <span style="display: inline-block; padding: 6px 12px; background-color: ${bgColor}; border-radius: 6px; font-size: 13px; font-weight: 600; color: ${textColor};">${count} ${label}</span>
    </td>
  ` : ""

  return {
    subject: `Scan Complete: ${summary.total} issue${summary.total !== 1 ? "s" : ""} found - ${APP_NAME}`,
    text: `Your scan of ${url} has completed.\n\nResults:\n- Critical: ${summary.critical}\n- High: ${summary.high}\n- Medium: ${summary.medium}\n- Low: ${summary.low}\n- Info: ${summary.info}\n- Total: ${summary.total}\n\nDuration: ${durationSecs}s\n\nView full report: ${viewLink}`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Scan Complete</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your vulnerability scan has finished.</p>
      
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED}; font-weight: 600;">Target URL</p>
        <p style="margin: 0; font-size: 14px; color: ${COLORS.ACCENT_BLUE_LIGHT}; word-break: break-all; font-family: monospace;">${safeUrl}</p>
      </div>
      
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED}; font-weight: 600;">Findings Summary</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom: 12px;">
          <tr>
            ${severityBadge("Critical", summary.critical, COLORS.BG_DANGER, COLORS.ACCENT_RED_LIGHT)}
            ${severityBadge("High", summary.high, "#7c2d12", COLORS.ACCENT_YELLOW_LIGHT)}
            ${severityBadge("Medium", summary.medium, COLORS.BG_WARNING, COLORS.ACCENT_YELLOW_PALE)}
            ${severityBadge("Low", summary.low, COLORS.BG_INFO, COLORS.ACCENT_BLUE_PALE)}
            ${severityBadge("Info", summary.info, COLORS.BG_SECTION, COLORS.TEXT_SECONDARY)}
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 13px; line-height: 1.8; border-top: 1px solid ${COLORS.BORDER_SECTION}; padding-top: 12px;">
          <tr>
            <td style="padding: 4px 0; color: ${COLORS.TEXT_SECONDARY};">Total Issues</td>
            <td style="padding: 4px 0; color: ${COLORS.TEXT_PRIMARY}; text-align: right; font-weight: 600;">${summary.total}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: ${COLORS.TEXT_SECONDARY};">Scan Duration</td>
            <td style="padding: 4px 0; color: ${COLORS.TEXT_PRIMARY}; text-align: right;">${durationSecs}s</td>
          </tr>
        </table>
      </div>
      
      ${summary.critical > 0 || summary.high > 0 ? `
      <div style="background-color: ${COLORS.BG_DANGER}; border-left: 3px solid ${COLORS.ACCENT_RED}; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_RED_LIGHT}; font-weight: 600;">Action Required</p>
        <p style="margin: 0; font-size: 13px; color: ${COLORS.ACCENT_RED_PALE}; line-height: 1.6;">Critical or high severity issues were detected. Review the findings and address them promptly.</p>
      </div>
      ` : ""}
      
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <a href="${viewLink}" style="display: inline-block; padding: 14px 40px; background-color: ${COLORS.ACCENT_BLUE}; color: ${COLORS.WHITE}; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">View Full Report</a>
          </td>
        </tr>
      </table>
    `,
  }
}

export function criticalFindingsEmail(url: string, criticalCount: number, highCount: number, scanHistoryId?: number) {
  const safeUrl = escapeHtml(url)
  const viewLink = scanHistoryId ? `${APP_URL}/history/${scanHistoryId}` : `${APP_URL}/history`

  return {
    subject: `ALERT: ${criticalCount} Critical + ${highCount} High severity issues found - ${APP_NAME}`,
    text: `URGENT: Critical vulnerabilities detected!\n\nURL: ${url}\nCritical Issues: ${criticalCount}\nHigh Issues: ${highCount}\n\nImmediate action recommended. View report: ${viewLink}`,
    html: `
      <div style="background-color: ${COLORS.BG_DANGER}; border-radius: 8px; padding: 20px; margin-bottom: 20px; text-align: center;">
        <p style="margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.ACCENT_RED_LIGHT}; font-weight: 700;">Security Alert</p>
        <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: ${COLORS.ACCENT_RED_PALE};">Critical Vulnerabilities Detected</h1>
      </div>
      
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED}; font-weight: 600;">Target URL</p>
        <p style="margin: 0; font-size: 14px; color: ${COLORS.ACCENT_BLUE_LIGHT}; word-break: break-all; font-family: monospace;">${safeUrl}</p>
      </div>
      
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
        <tr>
          <td width="50%" style="padding-right: 8px;">
            <div style="background-color: ${COLORS.BG_DANGER}; border-radius: 8px; padding: 16px; text-align: center;">
              <p style="margin: 0 0 4px 0; font-size: 32px; font-weight: 700; color: ${COLORS.ACCENT_RED_PALE};">${criticalCount}</p>
              <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.ACCENT_RED_LIGHT};">Critical</p>
            </div>
          </td>
          <td width="50%" style="padding-left: 8px;">
            <div style="background-color: #7c2d12; border-radius: 8px; padding: 16px; text-align: center;">
              <p style="margin: 0 0 4px 0; font-size: 32px; font-weight: 700; color: ${COLORS.ACCENT_YELLOW_PALE};">${highCount}</p>
              <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.ACCENT_YELLOW_LIGHT};">High</p>
            </div>
          </td>
        </tr>
      </table>
      
      <div style="background-color: ${COLORS.BG_DANGER}; border-left: 3px solid ${COLORS.ACCENT_RED}; border-radius: 6px; padding: 14px 16px; margin-bottom: 24px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_RED_LIGHT}; font-weight: 600;">Immediate Action Required</p>
        <p style="margin: 0; font-size: 13px; color: ${COLORS.ACCENT_RED_PALE}; line-height: 1.6;">These vulnerabilities pose significant security risks. Review and remediate them as soon as possible.</p>
      </div>
      
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <a href="${viewLink}" style="display: inline-block; padding: 14px 40px; background-color: ${COLORS.ACCENT_RED}; color: ${COLORS.WHITE}; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">View Security Report</a>
          </td>
        </tr>
      </table>
    `,
  }
}

export function scheduledScanCompleteEmail(scheduleName: string, url: string, summary: ScanCompleteSummary, duration: number, scanHistoryId?: number) {
  const safeName = escapeHtml(scheduleName)
  const safeUrl = escapeHtml(url)
  const durationSecs = (duration / 1000).toFixed(1)
  const viewLink = scanHistoryId ? `${APP_URL}/history/${scanHistoryId}` : `${APP_URL}/history`

  return {
    subject: `Scheduled Scan "${scheduleName}" Complete - ${APP_NAME}`,
    text: `Your scheduled scan "${scheduleName}" has completed.\n\nURL: ${url}\nResults: ${summary.total} issues (${summary.critical} critical, ${summary.high} high)\nDuration: ${durationSecs}s\n\nView report: ${viewLink}`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Scheduled Scan Complete</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your scheduled scan <strong style="color: ${COLORS.TEXT_PRIMARY};">"${safeName}"</strong> has finished.</p>
      
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED}; font-weight: 600;">Target URL</p>
        <p style="margin: 0; font-size: 14px; color: ${COLORS.ACCENT_BLUE_LIGHT}; word-break: break-all; font-family: monospace;">${safeUrl}</p>
      </div>
      
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED}; font-weight: 600;">Results</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 13px; line-height: 1.8;">
          <tr><td style="padding: 4px 0; color: ${COLORS.TEXT_SECONDARY};">Critical</td><td style="padding: 4px 0; color: ${summary.critical > 0 ? COLORS.ACCENT_RED_LIGHT : COLORS.TEXT_PRIMARY}; text-align: right; font-weight: 600;">${summary.critical}</td></tr>
          <tr><td style="padding: 4px 0; color: ${COLORS.TEXT_SECONDARY};">High</td><td style="padding: 4px 0; color: ${summary.high > 0 ? COLORS.ACCENT_YELLOW_LIGHT : COLORS.TEXT_PRIMARY}; text-align: right; font-weight: 600;">${summary.high}</td></tr>
          <tr><td style="padding: 4px 0; color: ${COLORS.TEXT_SECONDARY};">Medium</td><td style="padding: 4px 0; color: ${COLORS.TEXT_PRIMARY}; text-align: right;">${summary.medium}</td></tr>
          <tr><td style="padding: 4px 0; color: ${COLORS.TEXT_SECONDARY};">Low</td><td style="padding: 4px 0; color: ${COLORS.TEXT_PRIMARY}; text-align: right;">${summary.low}</td></tr>
          <tr><td style="padding: 4px 0; color: ${COLORS.TEXT_SECONDARY};">Info</td><td style="padding: 4px 0; color: ${COLORS.TEXT_PRIMARY}; text-align: right;">${summary.info}</td></tr>
          <tr style="border-top: 1px solid ${COLORS.BORDER_SECTION};"><td style="padding: 8px 0 4px 0; color: ${COLORS.TEXT_PRIMARY}; font-weight: 600;">Total</td><td style="padding: 8px 0 4px 0; color: ${COLORS.TEXT_PRIMARY}; text-align: right; font-weight: 600;">${summary.total}</td></tr>
        </table>
      </div>
      
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <a href="${viewLink}" style="display: inline-block; padding: 14px 40px; background-color: ${COLORS.ACCENT_BLUE}; color: ${COLORS.WHITE}; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">View Full Report</a>
          </td>
        </tr>
      </table>
    `,
  }
}

export interface AdminChangeNotification {
  userName: string
  adminName: string
  changes: { field: string; oldValue: string; newValue: string }[]
  timestamp: Date
  ipAddress?: string
}

export function adminAccountChangeEmail(input: AdminChangeNotification) {
  const userName = escapeHtml(input.userName)
  const adminName = escapeHtml(input.adminName)
  const timestamp = input.timestamp.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  const changesHtml = input.changes
    .map(
      (c) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid ${COLORS.BORDER_SECTION}; color: ${COLORS.TEXT_SECONDARY}; font-size: 13px; width: 120px;">${escapeHtml(c.field)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid ${COLORS.BORDER_SECTION};">
          <span style="display: inline-block; padding: 3px 8px; background-color: ${COLORS.BG_DANGER}; border-radius: 4px; font-size: 12px; color: ${COLORS.ACCENT_RED_LIGHT}; text-decoration: line-through; margin-right: 8px;">${escapeHtml(c.oldValue || "—")}</span>
          <span style="color: ${COLORS.TEXT_MUTED};">→</span>
          <span style="display: inline-block; padding: 3px 8px; background-color: ${COLORS.BG_SUCCESS}; border-radius: 4px; font-size: 12px; color: ${COLORS.ACCENT_GREEN_LIGHT}; margin-left: 8px;">${escapeHtml(c.newValue || "—")}</span>
        </td>
      </tr>
    `
    )
    .join("")

  const changesText = input.changes
    .map((c) => `  - ${c.field}: "${c.oldValue || "—"}" → "${c.newValue || "—"}"`)
    .join("\n")

  return {
    subject: `Account Updated by Administrator - ${APP_NAME}`,
    text: `Hi ${input.userName},\n\nAn administrator (${input.adminName}) has made changes to your ${APP_NAME} account.\n\nChanges:\n${changesText}\n\nTimestamp: ${timestamp}\n\nIf you have questions about these changes, please contact support at ${SUPPORT_EMAIL}`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Account Updated</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Hi ${userName}, an administrator has made changes to your account.</p>
      
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED}; font-weight: 600;">Changes Made</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
          ${changesHtml}
        </table>
      </div>
      
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 13px; line-height: 1.8;">
          <tr>
            <td style="padding: 4px 0; width: 100px; color: ${COLORS.TEXT_SECONDARY};">Admin</td>
            <td style="padding: 4px 0; color: ${COLORS.TEXT_PRIMARY};">${adminName}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; width: 100px; color: ${COLORS.TEXT_SECONDARY};">Timestamp</td>
            <td style="padding: 4px 0; color: ${COLORS.TEXT_PRIMARY};">${escapeHtml(timestamp)}</td>
          </tr>
          ${
            input.ipAddress
              ? `<tr>
            <td style="padding: 4px 0; width: 100px; color: ${COLORS.TEXT_SECONDARY};">IP Address</td>
            <td style="padding: 4px 0; color: ${COLORS.TEXT_PRIMARY}; font-family: monospace;">${escapeHtml(input.ipAddress)}</td>
          </tr>`
              : ""
          }
        </table>
      </div>
      
      <div style="background-color: ${COLORS.BG_INFO}; border-left: 3px solid ${COLORS.ACCENT_BLUE_LIGHT}; border-radius: 6px; padding: 14px 16px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: ${COLORS.ACCENT_BLUE_PALE}; font-weight: 600;">Questions?</p>
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">
          If you have questions about these changes, please contact support at 
          <a href="mailto:${SUPPORT_EMAIL}" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">${SUPPORT_EMAIL}</a>
        </p>
      </div>
    `,
  }
}
