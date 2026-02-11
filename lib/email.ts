import nodemailer from "nodemailer"

const noreplyTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
})

// Logo URL - using hosted image for better email client compatibility
const LOGO_URL = "https://vulnradar.dev/favicon.png"

function layout(content: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VulnRadar</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #0a0e13; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #e5e7eb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #0a0e13; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
          <!-- Header with Logo -->
          <tr>
            <td style="padding: 0 0 20px 0; text-align: center;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <img src="${LOGO_URL}" alt="VulnRadar" width="48" height="48" style="display: block; margin: 0 auto;" />
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #f8fafc; letter-spacing: -0.3px;">VulnRadar</h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Divider -->
          <tr>
            <td style="padding: 0 0 24px 0;">
              <div style="height: 2px; background: linear-gradient(90deg, #2563eb, #3b82f6); border-radius: 999px;"></div>
            </td>
          </tr>
          
          <!-- Main Content Card -->
          <tr>
            <td style="background-color: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 32px 28px;">
              ${content}
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 28px 20px 0 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="text-align: center;">
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748b; line-height: 1.6;">
                      <a href="https://vulnradar.dev" style="color: #3b82f6; text-decoration: none;">vulnradar.dev</a>
                    </p>
                    <p style="margin: 0; font-size: 11px; color: #475569; line-height: 1.5;">
                      VulnRadar - Web Vulnerability Scanner<br />
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

interface SendEmailOptions {
    to: string
    subject: string
    text: string
    html: string
    replyTo?: string
    skipLayout?: boolean
}

export async function sendEmail({ to, subject, text, html, replyTo, skipLayout }: SendEmailOptions) {
    const defaultFrom = `"VulnRadar" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`
    const finalHtml = skipLayout ? html : layout(html)
    await noreplyTransporter.sendMail({ from: defaultFrom, to, subject, text, html: finalHtml, replyTo })
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
}

export function contactEmail(input: {
    name: string
    email: string
    subject: string
    message: string
    category: string
}) {
    const name = escapeHtml(input.name)
    const email = escapeHtml(input.email)
    const subject = escapeHtml(input.subject)
    const message = escapeHtml(input.message).replace(/\n/g, "<br />")
    const category = escapeHtml(input.category)

    return {
        subject: `[Contact] ${input.subject}`,
        text: [
            `Category: ${input.category}`,
            `Name: ${input.name}`,
            `Email: ${input.email}`,
            "",
            input.message,
        ].join("\n"),
        html: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
        <tr>
          <td>
            <span style="display: inline-block; padding: 6px 12px; border-radius: 6px; background-color: #1e293b; border: 1px solid #334155; color: #94a3b8; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 12px;">
              ${category}
            </span>
            <h1 style="margin: 8px 0 0 0; font-size: 20px; font-weight: 600; color: #f8fafc;">New Contact Request</h1>
          </td>
        </tr>
      </table>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; font-weight: 600;">Contact Details</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.8;">
          <tr>
            <td style="padding: 4px 0; width: 80px; color: #94a3b8;">Name</td>
            <td style="padding: 4px 0; color: #f1f5f9;">${name}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; width: 80px; color: #94a3b8;">Email</td>
            <td style="padding: 4px 0;"><a href="mailto:${email}" style="color: #3b82f6; text-decoration: none;">${email}</a></td>
          </tr>
          <tr>
            <td style="padding: 4px 0; width: 80px; color: #94a3b8;">Subject</td>
            <td style="padding: 4px 0; color: #f1f5f9;">${subject}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 16px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; font-weight: 600;">Message</p>
        <div style="font-size: 14px; color: #e2e8f0; line-height: 1.7;">
          ${message}
        </div>
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
        <tr>
          <td align="center">
            <a href="mailto:${email}" style="display: inline-block; padding: 12px 28px; background-color: #2563eb; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px;">
              Reply to ${name}
            </a>
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
        text: [
            `Hi ${input.name},`,
            "",
            `Thanks for contacting VulnRadar. We received your ${input.category.toLowerCase()} and our team will review it shortly.`,
            "",
            "If you need to add more details, just reply to this email.",
            "",
            "- VulnRadar Support",
        ].join("\n"),
        html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #f8fafc;">Message Received</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        Hi ${name}, thank you for reaching out.
      </p>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 4px 0;">
              <p style="margin: 0 0 4px 0; font-size: 12px; color: #64748b;">Request Type</p>
              <p style="margin: 0; font-size: 15px; color: #f8fafc; font-weight: 500;">${category}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 12px 0 4px 0; border-top: 1px solid #334155;">
              <p style="margin: 0 0 4px 0; font-size: 12px; color: #64748b;">Status</p>
              <p style="margin: 0; font-size: 15px; color: #10b981; font-weight: 500;">In Review</p>
            </td>
          </tr>
        </table>
      </div>

      <div style="background-color: #1e3a5f; border-left: 3px solid #3b82f6; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: #93c5fd; font-weight: 600;">What happens next?</p>
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">
          Our team will review your message and respond within 24-48 hours. If you need to add more context, reply to this email.
        </p>
      </div>

      <p style="margin: 0; font-size: 13px; color: #64748b; text-align: center;">
        Thank you for using VulnRadar.
      </p>
    `,
    }
}

export function passwordResetEmail(resetLink: string) {
    return {
        subject: "Reset your VulnRadar password",
        text: [
            "You requested a password reset for your VulnRadar account.",
            "",
            "Click here to reset your password:",
            resetLink,
            "",
            "This link expires in 1 hour.",
            "",
            "If you did not request this, you can safely ignore this email.",
        ].join("\n"),
        html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #f8fafc;">Reset Your Password</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        We received a request to reset your VulnRadar account password.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td align="center">
            <a href="${resetLink}" style="display: inline-block; padding: 14px 40px; background-color: #2563eb; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">
              Reset Password
            </a>
          </td>
        </tr>
      </table>

      <div style="background-color: #422006; border-left: 3px solid #f59e0b; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: #fbbf24; font-weight: 600;">Security Notice</p>
        <p style="margin: 0; font-size: 13px; color: #fef3c7; line-height: 1.6;">
          This link expires in 1 hour. If you did not request this reset, please ignore this email.
        </p>
      </div>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 14px 16px;">
        <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748b;">If the button doesn't work, copy this link:</p>
        <p style="margin: 0; font-size: 12px; color: #3b82f6; word-break: break-all; line-height: 1.5; font-family: monospace;">
          ${resetLink}
        </p>
      </div>
    `,
    }
}

export function passwordChangedEmail(hasTwoFactor: boolean) {
    return {
        subject: "Password Changed - VulnRadar",
        text: [
            "Your VulnRadar account password has been successfully reset.",
            "",
            hasTwoFactor
                ? "Note: Your account has two-factor authentication enabled. You will need to enter your 6-digit code when logging in."
                : "All active sessions have been logged out for security. You can now log in with your new password.",
            "",
            "If you did not make this change, please contact support immediately at support@vulnradar.dev",
            "",
            "- VulnRadar Security",
        ].join("\n"),
        html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #f8fafc;">Password Changed Successfully</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        Your VulnRadar account password has been reset.
      </p>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: #64748b;">Security Information</p>
        <p style="margin: 0; font-size: 14px; color: #e2e8f0; line-height: 1.6;">
          ${hasTwoFactor 
            ? 'Your account has two-factor authentication enabled. You will need your 6-digit authenticator code when logging in.'
            : 'All active sessions have been logged out. You can now log in with your new password.'
          }
        </p>
      </div>

      <div style="background-color: #450a0a; border-left: 3px solid #dc2626; border-radius: 6px; padding: 14px 16px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: #fca5a5; font-weight: 600;">Didn't request this?</p>
        <p style="margin: 0; font-size: 13px; color: #fecaca; line-height: 1.6;">
          If you did not reset your password, your account may be compromised. Contact support immediately at support@vulnradar.dev
        </p>
      </div>
    `,
    }
}

export function teamInviteEmail(teamName: string, inviteLink: string, invitedBy: string) {
    return {
        subject: `You've been invited to join ${teamName} on VulnRadar`,
        text: [
            `${invitedBy} has invited you to join the team "${teamName}" on VulnRadar.`,
            "",
            "Click here to accept the invitation:",
            inviteLink,
            "",
            "This invitation expires in 7 days.",
        ].join("\n"),
        html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #f8fafc;">Team Invitation</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        <strong style="color: #f8fafc;">${invitedBy}</strong> has invited you to join their team.
      </p>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 20px; margin-bottom: 24px; text-align: center;">
        <p style="margin: 0 0 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b;">Team Name</p>
        <h2 style="margin: 0; font-size: 22px; font-weight: 600; color: #f8fafc;">${teamName}</h2>
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td align="center">
            <a href="${inviteLink}" style="display: inline-block; padding: 14px 40px; background-color: #2563eb; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">
              Accept Invitation
            </a>
          </td>
        </tr>
      </table>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 10px 0; font-size: 13px; color: #94a3b8; font-weight: 600;">As a team member you can:</p>
        <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #cbd5e1; line-height: 1.8;">
          <li>Collaborate on vulnerability scans</li>
          <li>Share scan history and reports</li>
          <li>Access team-wide security insights</li>
        </ul>
      </div>

      <p style="margin: 0 0 16px 0; font-size: 13px; color: #64748b; text-align: center;">
        This invitation expires in 7 days.
      </p>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 14px 16px;">
        <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748b;">If the button doesn't work, copy this link:</p>
        <p style="margin: 0; font-size: 11px; color: #3b82f6; word-break: break-all; line-height: 1.5; font-family: monospace;">
          ${inviteLink}
        </p>
      </div>
    `,
    }
}

export function landingContactEmail(input: { email: string; message: string }) {
    const email = escapeHtml(input.email)
    const message = escapeHtml(input.message).replace(/\n/g, "<br />")

    return {
        subject: "[Landing Page] New Inquiry",
        text: [
            "New Landing Page Inquiry",
            "",
            `Email: ${input.email}`,
            "",
            "Message:",
            input.message,
        ].join("\n"),
        html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #f8fafc;">New Landing Page Inquiry</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        Someone reached out via the VulnRadar landing page.
      </p>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; font-weight: 600;">Contact Info</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.8;">
          <tr>
            <td style="padding: 4px 0; width: 80px; color: #94a3b8;">Email</td>
            <td style="padding: 4px 0;"><a href="mailto:${email}" style="color: #3b82f6; text-decoration: none;">${email}</a></td>
          </tr>
        </table>
      </div>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 16px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; font-weight: 600;">Message</p>
        <div style="font-size: 14px; color: #e2e8f0; line-height: 1.7;">
          ${message}
        </div>
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
        <tr>
          <td align="center">
            <a href="mailto:${email}" style="display: inline-block; padding: 12px 28px; background-color: #2563eb; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px;">
              Reply
            </a>
          </td>
        </tr>
      </table>
    `,
    }
}

export function landingContactConfirmationEmail(message: string) {
    const escapedMessage = escapeHtml(message).replace(/\n/g, "<br />")

    return {
        subject: "We received your message - VulnRadar",
        text: [
            "Thanks for reaching out!",
            "",
            "We've received your message and will get back to you within 24 hours.",
            "",
            "Your Message:",
            message,
            "",
            "In the meantime, feel free to explore our documentation or start scanning for free by creating an account.",
        ].join("\n"),
        html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #f8fafc;">Message Received</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        Thank you for reaching out. We will get back to you within 24 hours.
      </p>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; font-weight: 600;">Your Message</p>
        <div style="font-size: 14px; color: #e2e8f0; line-height: 1.7;">
          ${escapedMessage}
        </div>
      </div>

      <div style="background-color: #1e3a5f; border-left: 3px solid #3b82f6; border-radius: 6px; padding: 14px 16px;">
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">
          In the meantime, feel free to explore our <a href="https://vulnradar.dev/docs" style="color: #93c5fd; text-decoration: none;">documentation</a> or start scanning by <a href="https://vulnradar.dev/signup" style="color: #93c5fd; text-decoration: none;">creating an account</a>.
        </p>
      </div>
    `,
    }
}

// ─── Security Alert Emails for Profile Changes ───────────────────────────────

interface SecurityAlertDetails {
    ipAddress: string
    userAgent: string
}

function securityDetailsBlock(details: SecurityAlertDetails): string {
    return `
      <div style="background-color: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; font-weight: 600;">Session Details</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 13px; line-height: 1.8;">
          <tr>
            <td style="padding: 4px 0; width: 100px; color: #94a3b8;">IP Address</td>
            <td style="padding: 4px 0; color: #f1f5f9; font-family: monospace;">${escapeHtml(details.ipAddress)}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; width: 100px; color: #94a3b8;">Device</td>
            <td style="padding: 4px 0; color: #f1f5f9; font-size: 12px;">${escapeHtml(details.userAgent.length > 80 ? details.userAgent.substring(0, 80) + '...' : details.userAgent)}</td>
          </tr>
        </table>
      </div>
    `
}

function securityWarningBlock(): string {
    return `
      <div style="background-color: #450a0a; border-left: 3px solid #dc2626; border-radius: 6px; padding: 14px 16px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: #fca5a5; font-weight: 600;">Wasn't you?</p>
        <p style="margin: 0; font-size: 13px; color: #fecaca; line-height: 1.6;">
          If you did not make this change, your account may be compromised. Please reset your password immediately and contact support at support@vulnradar.dev
        </p>
      </div>
    `
}

export function profileNameChangedEmail(oldName: string, newName: string, details: SecurityAlertDetails) {
    return {
        subject: "Profile Name Changed - VulnRadar",
        text: [
            "Your VulnRadar profile name has been changed.",
            "",
            `Previous Name: ${oldName}`,
            `New Name: ${newName}`,
            "",
            `IP Address: ${details.ipAddress}`,
            `Device: ${details.userAgent}`,
            "",
            "If you did not make this change, please reset your password immediately.",
        ].join("\n"),
        html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #f8fafc;">Profile Name Changed</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        Your VulnRadar account name has been updated.
      </p>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.8;">
          <tr>
            <td style="padding: 4px 0; width: 120px; color: #94a3b8;">Previous Name</td>
            <td style="padding: 4px 0; color: #f1f5f9;">${escapeHtml(oldName)}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; width: 120px; color: #94a3b8;">New Name</td>
            <td style="padding: 4px 0; color: #10b981; font-weight: 500;">${escapeHtml(newName)}</td>
          </tr>
        </table>
      </div>

      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
    }
}

export function profileEmailChangedEmail(oldEmail: string, newEmail: string, details: SecurityAlertDetails) {
    return {
        subject: "Email Address Changed - VulnRadar",
        text: [
            "Your VulnRadar account email has been changed.",
            "",
            `Previous Email: ${oldEmail}`,
            `New Email: ${newEmail}`,
            "",
            `IP Address: ${details.ipAddress}`,
            `Device: ${details.userAgent}`,
            "",
            "If you did not make this change, please contact support immediately.",
        ].join("\n"),
        html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #f8fafc;">Email Address Changed</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        Your VulnRadar account email has been updated.
      </p>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.8;">
          <tr>
            <td style="padding: 4px 0; width: 120px; color: #94a3b8;">Previous Email</td>
            <td style="padding: 4px 0; color: #f1f5f9;">${escapeHtml(oldEmail)}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; width: 120px; color: #94a3b8;">New Email</td>
            <td style="padding: 4px 0; color: #10b981; font-weight: 500;">${escapeHtml(newEmail)}</td>
          </tr>
        </table>
      </div>

      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
    }
}

export function profilePasswordChangedEmail(details: SecurityAlertDetails) {
    return {
        subject: "Password Changed - VulnRadar",
        text: [
            "Your VulnRadar account password has been changed.",
            "",
            `IP Address: ${details.ipAddress}`,
            `Device: ${details.userAgent}`,
            "",
            "If you did not make this change, please reset your password immediately.",
        ].join("\n"),
        html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #f8fafc;">Password Changed</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        Your VulnRadar account password has been successfully updated.
      </p>

      <div style="background-color: #1e3a5f; border-left: 3px solid #3b82f6; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">
          For security, you may want to review your active sessions in your profile settings.
        </p>
      </div>

      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
    }
}

export function twoFactorEnabledEmail(details: SecurityAlertDetails) {
    return {
        subject: "Two-Factor Authentication Enabled - VulnRadar",
        text: [
            "Two-factor authentication has been enabled on your VulnRadar account.",
            "",
            "Your account is now more secure. You will need to enter a code from your authenticator app when logging in.",
            "",
            `IP Address: ${details.ipAddress}`,
            `Device: ${details.userAgent}`,
            "",
            "If you did not enable 2FA, please contact support immediately.",
        ].join("\n"),
        html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #f8fafc;">Two-Factor Authentication Enabled</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        Two-factor authentication has been enabled on your account.
      </p>

      <div style="background-color: #052e16; border-left: 3px solid #22c55e; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: #86efac; font-weight: 600;">Enhanced Security Active</p>
        <p style="margin: 0; font-size: 13px; color: #bbf7d0; line-height: 1.6;">
          Your account is now protected with two-factor authentication. You'll need your authenticator app to log in.
        </p>
      </div>

      <div style="background-color: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748b;">Remember to:</p>
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
        subject: "Two-Factor Authentication Disabled - VulnRadar",
        text: [
            "Two-factor authentication has been disabled on your VulnRadar account.",
            "",
            "Your account no longer requires a 2FA code to log in.",
            "",
            `IP Address: ${details.ipAddress}`,
            `Device: ${details.userAgent}`,
            "",
            "If you did not disable 2FA, please re-enable it and reset your password immediately.",
        ].join("\n"),
        html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #f8fafc;">Two-Factor Authentication Disabled</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        Two-factor authentication has been removed from your account.
      </p>

      <div style="background-color: #422006; border-left: 3px solid #f59e0b; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: #fbbf24; font-weight: 600;">Security Reduced</p>
        <p style="margin: 0; font-size: 13px; color: #fef3c7; line-height: 1.6;">
          Your account is no longer protected with two-factor authentication. Consider re-enabling it for better security.
        </p>
      </div>

      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
    }
}

export function backupCodesRegeneratedEmail(details: SecurityAlertDetails) {
    return {
        subject: "Backup Codes Regenerated - VulnRadar",
        text: [
            "Your VulnRadar two-factor authentication backup codes have been regenerated.",
            "",
            "All previous backup codes are now invalid. Please store your new codes securely.",
            "",
            `IP Address: ${details.ipAddress}`,
            `Device: ${details.userAgent}`,
            "",
            "If you did not regenerate your backup codes, please contact support immediately.",
        ].join("\n"),
        html: `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #f8fafc;">Backup Codes Regenerated</h1>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        Your two-factor authentication backup codes have been regenerated.
      </p>

      <div style="background-color: #422006; border-left: 3px solid #f59e0b; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: #fbbf24; font-weight: 600;">Previous Codes Invalidated</p>
        <p style="margin: 0; font-size: 13px; color: #fef3c7; line-height: 1.6;">
          All previous backup codes are now invalid. Make sure to store your new codes in a secure location.
        </p>
      </div>

      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
    }
}

