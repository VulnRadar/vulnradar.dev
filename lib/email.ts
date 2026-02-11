import nodemailer from "nodemailer"

const CONFIG = {
  APP_NAME: "VulnRadar",
  APP_URL: "https://vulnradar.dev",
  LOGO_URL: "https://vulnradar.dev/favicon.png",
  SUPPORT_EMAIL: "support@vulnradar.dev",
  SMTP: {
    HOST: process.env.SMTP_HOST,
    PORT: Number(process.env.SMTP_PORT) || 587,
    USER: process.env.SMTP_USER,
    PASS: process.env.SMTP_PASS,
    FROM: process.env.SMTP_FROM || process.env.SMTP_USER,
  },
} as const

export const APP_URL = CONFIG.APP_URL

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
const transporter = CONFIG.SMTP.HOST && CONFIG.SMTP.USER && CONFIG.SMTP.PASS
  ? nodemailer.createTransport({
      host: CONFIG.SMTP.HOST,
      port: CONFIG.SMTP.PORT,
      secure: false,
      auth: {
        user: CONFIG.SMTP.USER,
        pass: CONFIG.SMTP.PASS,
      },
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
  <title>${CONFIG.APP_NAME}</title>
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
                    <img src="${CONFIG.LOGO_URL}" alt="${CONFIG.APP_NAME}" width="48" height="48" style="display: block; margin: 0 auto;" />
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: ${COLORS.TEXT_PRIMARY}; letter-spacing: -0.3px;">${CONFIG.APP_NAME}</h1>
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
                      <a href="${CONFIG.APP_URL}" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">vulnradar.dev</a>
                    </p>
                    <p style="margin: 0; font-size: 11px; color: ${COLORS.TEXT_DARK}; line-height: 1.5;">
                      ${CONFIG.APP_NAME} - Web Vulnerability Scanner<br />
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
        If you did not make this change, your account may be compromised. Please reset your password immediately and contact support at ${CONFIG.SUPPORT_EMAIL}
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

  const from = `"${CONFIG.APP_NAME}" <${CONFIG.SMTP.FROM}>`
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
    text: `Hi ${input.name},\n\nThanks for contacting ${CONFIG.APP_NAME}. We received your ${input.category.toLowerCase()} and our team will review it shortly.\n\nIf you need to add more details, just reply to this email.\n\n- ${CONFIG.APP_NAME} Support`,
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
      <p style="margin: 0; font-size: 13px; color: ${COLORS.TEXT_MUTED}; text-align: center;">Thank you for using ${CONFIG.APP_NAME}.</p>
    `,
  }
}

export function emailVerificationEmail(name: string, verifyLink: string) {
  const safeName = escapeHtml(name)
  return {
    subject: `Verify your email - ${CONFIG.APP_NAME}`,
    text: `Welcome to ${CONFIG.APP_NAME}, ${name}!\n\nPlease verify your email address by clicking the link below:\n${verifyLink}\n\nThis link expires in 24 hours.\n\nIf you did not create an account, you can safely ignore this email.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Welcome to ${CONFIG.APP_NAME}!</h1>
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
    subject: `Reset your ${CONFIG.APP_NAME} password`,
    text: `You requested a password reset for your ${CONFIG.APP_NAME} account.\n\nClick here to reset your password:\n${resetLink}\n\nThis link expires in 1 hour.\n\nIf you did not request this, you can safely ignore this email.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Reset Your Password</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">We received a request to reset your ${CONFIG.APP_NAME} account password.</p>
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
    subject: `Password Changed - ${CONFIG.APP_NAME}`,
    text: `Your ${CONFIG.APP_NAME} account password has been successfully reset.\n\n${securityInfo}\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not make this change, please contact support immediately at ${CONFIG.SUPPORT_EMAIL}\n\n- ${CONFIG.APP_NAME} Security`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Password Changed Successfully</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your ${CONFIG.APP_NAME} account password has been reset.</p>
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
    subject: `You've been invited to join ${teamName} on ${CONFIG.APP_NAME}`,
    text: `${invitedBy} has invited you to join the team "${teamName}" on ${CONFIG.APP_NAME}.\n\nClick here to accept the invitation:\n${inviteLink}\n\nThis invitation expires in 7 days.`,
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
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Someone reached out via the ${CONFIG.APP_NAME} landing page.</p>
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
    subject: `We received your message - ${CONFIG.APP_NAME}`,
    text: `Thanks for reaching out!\n\nWe've received your message and will get back to you within 24 hours.\n\nYour Message:\n${message}\n\nIn the meantime, feel free to explore our documentation or start scanning for free by creating an account.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Message Received</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Thank you for reaching out. We will get back to you within 24 hours.</p>
      <div style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.TEXT_MUTED}; font-weight: 600;">Your Message</p>
        <div style="font-size: 14px; color: #e2e8f0; line-height: 1.7;">${escapedMessage}</div>
      </div>
      <div style="background-color: ${COLORS.BG_INFO}; border-left: 3px solid ${COLORS.ACCENT_BLUE_LIGHT}; border-radius: 6px; padding: 14px 16px;">
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">In the meantime, feel free to explore our <a href="${CONFIG.APP_URL}/docs" style="color: ${COLORS.ACCENT_BLUE_PALE}; text-decoration: none;">documentation</a> or start scanning by <a href="${CONFIG.APP_URL}/signup" style="color: ${COLORS.ACCENT_BLUE_PALE}; text-decoration: none;">creating an account</a>.</p>
      </div>
    `,
  }
}

export function profileNameChangedEmail(oldName: string, newName: string, details: SecurityAlertDetails) {
  return {
    subject: `Profile Name Changed - ${CONFIG.APP_NAME}`,
    text: `Your ${CONFIG.APP_NAME} profile name has been changed.\n\nPrevious Name: ${oldName}\nNew Name: ${newName}\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not make this change, please reset your password immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Profile Name Changed</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your ${CONFIG.APP_NAME} account name has been updated.</p>
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
    subject: `Email Address Changed - ${CONFIG.APP_NAME}`,
    text: `Your ${CONFIG.APP_NAME} account email has been changed.\n\nPrevious Email: ${oldEmail}\nNew Email: ${newEmail}\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not make this change, please contact support immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Email Address Changed</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your ${CONFIG.APP_NAME} account email has been updated.</p>
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
    subject: `Password Changed - ${CONFIG.APP_NAME}`,
    text: `Your ${CONFIG.APP_NAME} account password has been changed.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not make this change, please reset your password immediately.`,
    html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: ${COLORS.TEXT_PRIMARY};">Password Changed</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.6;">Your ${CONFIG.APP_NAME} account password has been successfully updated.</p>
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
    subject: `Two-Factor Authentication Enabled - ${CONFIG.APP_NAME}`,
    text: `Two-factor authentication has been enabled on your ${CONFIG.APP_NAME} account.\n\nYour account is now more secure. You will need to enter a code from your authenticator app when logging in.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not enable 2FA, please contact support immediately.`,
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
    subject: `Two-Factor Authentication Disabled - ${CONFIG.APP_NAME}`,
    text: `Two-factor authentication has been disabled on your ${CONFIG.APP_NAME} account.\n\nYour account no longer requires a 2FA code to log in.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not disable 2FA, please re-enable it and reset your password immediately.`,
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
    subject: `Backup Codes Regenerated - ${CONFIG.APP_NAME}`,
    text: `Your ${CONFIG.APP_NAME} two-factor authentication backup codes have been regenerated.\n\nAll previous backup codes are now invalid. Please store your new codes securely.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not regenerate your backup codes, please contact support immediately.`,
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
    subject: `API Key Created - ${CONFIG.APP_NAME}`,
    text: `A new API key "${keyName}" has been created on your ${CONFIG.APP_NAME} account.\n\nKey Prefix: ${keyPrefix}...\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not create this API key, please revoke it immediately and contact support.`,
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
    subject: `API Key Revoked - ${CONFIG.APP_NAME}`,
    text: `The API key "${keyName}" has been revoked from your ${CONFIG.APP_NAME} account.\n\nThis key can no longer be used for API access.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not revoke this API key, please contact support immediately.`,
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
    subject: `Webhook Created - ${CONFIG.APP_NAME}`,
    text: `A new ${webhookType} webhook "${webhookName}" has been created on your ${CONFIG.APP_NAME} account.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not create this webhook, please delete it immediately.`,
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
    subject: `Webhook Deleted - ${CONFIG.APP_NAME}`,
    text: `The webhook "${webhookName}" has been deleted from your ${CONFIG.APP_NAME} account.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not delete this webhook, please contact support.`,
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
    subject: `Scheduled Scan Created - ${CONFIG.APP_NAME}`,
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
    subject: `Scheduled Scan Deleted - ${CONFIG.APP_NAME}`,
    text: `The scheduled scan for ${url} has been deleted from your ${CONFIG.APP_NAME} account.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}`,
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
    subject: `${typeLabel} Request Submitted - ${CONFIG.APP_NAME}`,
    text: `A ${typeLabel.toLowerCase()} request has been submitted for your ${CONFIG.APP_NAME} account.\n\nOur team will process your request within 30 days as required by privacy regulations.\n\nIP Address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you did not make this request, please contact support immediately.`,
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


