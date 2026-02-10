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
<body style="margin: 0; padding: 0; background-color: #0a0e13; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #e5e7eb; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: linear-gradient(135deg, #0a0e13 0%, #0f1419 50%, #1a1f2e 100%); padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
          <!-- Header with Logo -->
          <tr>
            <td style="padding: 0 0 24px 0; text-align: center;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom: 16px;">
                    <img src="${LOGO_URL}" alt="VulnRadar" width="64" height="64" style="display: block; margin: 0 auto; border-radius: 16px; box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);" />
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #f8fafc; letter-spacing: -0.5px; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);">VulnRadar</h1>
                    <p style="margin: 4px 0 0 0; font-size: 13px; color: #94a3b8; letter-spacing: 0.5px; text-transform: uppercase; font-weight: 500;">Web Vulnerability Scanner</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Gradient Divider -->
          <tr>
            <td style="padding: 0 0 28px 0;">
              <div style="height: 3px; background: linear-gradient(90deg, transparent 0%, #2563eb 20%, #3b82f6 50%, #60a5fa 80%, transparent 100%); border-radius: 999px;"></div>
            </td>
          </tr>
          
          <!-- Main Content Card -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border: 1px solid rgba(96, 165, 250, 0.2); border-radius: 20px; padding: 36px 32px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05);">
              ${content}
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 32px 20px 0 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-bottom: 16px; text-align: center;">
                    <div style="border-top: 1px solid rgba(71, 85, 105, 0.3); padding-top: 20px;">
                      <p style="margin: 0 0 12px 0; font-size: 13px; color: #94a3b8; line-height: 1.6;">
                        <a href="https://vulnradar.dev" style="color: #60a5fa; text-decoration: none; font-weight: 600;">vulnradar.dev</a> · 
                        <a href="https://vulnradar.dev/docs" style="color: #94a3b8; text-decoration: none;">Docs</a> · 
                        <a href="https://vulnradar.dev/changelog" style="color: #94a3b8; text-decoration: none;">Changelog</a> · 
                        <a href="mailto:legal@vulnradar.dev" style="color: #94a3b8; text-decoration: none;">Legal</a>
                      </p>
                      <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 1.5;">
                        &copy; 2026 VulnRadar. All rights reserved.<br />
                        This email was sent to you as part of your VulnRadar account activity.
                      </p>
                    </div>
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

    // Category badge colors
    const categoryColors: Record<string, string> = {
        "Bug Report": "#ef4444",
        "Feature Request": "#3b82f6",
        "Security Issue": "#f59e0b",
        "General Help": "#10b981",
    }
    const badgeColor = categoryColors[input.category] || "#6366f1"

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
      <!-- Header with Category Badge -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td style="vertical-align: top;">
            <div style="display: inline-block; margin-bottom: 8px;">
              <span style="display: inline-block; padding: 8px 16px; border-radius: 8px; background: linear-gradient(135deg, ${badgeColor}, ${badgeColor}dd); color: #ffffff; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; box-shadow: 0 4px 12px ${badgeColor}40;">
                ${category}
              </span>
            </div>
            <h1 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 700; color: #f8fafc; line-height: 1.2;">New Contact Request</h1>
            <p style="margin: 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
              Submitted via contact form · Reply directly to respond
            </p>
          </td>
        </tr>
      </table>

      <!-- Contact Details Card -->
      <div style="background: linear-gradient(135deg, #0a0f1a 0%, #111827 100%); border: 1px solid rgba(96, 165, 250, 0.15); border-radius: 16px; padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-bottom: 12px;">
              <p style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #60a5fa; font-weight: 700;">Contact Information</p>
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 2;">
          <tr>
            <td style="padding: 8px 0; width: 120px; color: #94a3b8; font-weight: 500;">Name</td>
            <td style="padding: 8px 0; color: #f1f5f9; font-weight: 600;">${name}</td>
          </tr>
          <tr style="border-top: 1px solid rgba(71, 85, 105, 0.3);">
            <td style="padding: 8px 0; width: 120px; color: #94a3b8; font-weight: 500;">Email</td>
            <td style="padding: 8px 0;"><a href="mailto:${email}" style="color: #60a5fa; text-decoration: none; font-weight: 600;">${email}</a></td>
          </tr>
          <tr style="border-top: 1px solid rgba(71, 85, 105, 0.3);">
            <td style="padding: 8px 0; width: 120px; color: #94a3b8; font-weight: 500;">Subject</td>
            <td style="padding: 8px 0; color: #f1f5f9; font-weight: 600;">${subject}</td>
          </tr>
        </table>
      </div>

      <!-- Message Card -->
      <div style="background: linear-gradient(135deg, #0a0f1a 0%, #111827 100%); border: 1px solid rgba(96, 165, 250, 0.15); border-radius: 16px; padding: 20px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);">
        <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #60a5fa; font-weight: 700;">Message</p>
        <div style="font-size: 14px; color: #e2e8f0; line-height: 1.8; padding: 12px; background-color: rgba(15, 23, 42, 0.6); border-radius: 10px; border-left: 3px solid #3b82f6;">
          ${message}
        </div>
      </div>

      <!-- Quick Actions -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 28px; padding-top: 24px; border-top: 1px solid rgba(71, 85, 105, 0.3);">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background: linear-gradient(135deg, #2563eb, #3b82f6); border-radius: 10px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);">
                  <a href="mailto:${email}" style="display: inline-block; padding: 14px 32px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; letter-spacing: 0.3px;">
                    Reply to ${name}
                  </a>
                </td>
              </tr>
            </table>
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
      <!-- Success Icon -->
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 80px; height: 80px; background: linear-gradient(135deg, #10b981, #059669); border-radius: 50%; box-shadow: 0 8px 24px rgba(16, 185, 129, 0.4);">
          <svg width="80" height="80" viewBox="0 0 80 80" style="display: block;">
            <path d="M25 40 L35 50 L55 30" stroke="#ffffff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>

      <!-- Main Heading -->
      <h1 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 700; color: #f8fafc; text-align: center; line-height: 1.2;">Message Received!</h1>
      <p style="margin: 0 0 28px 0; font-size: 15px; color: #94a3b8; text-align: center; line-height: 1.6;">
        Thanks for reaching out, <strong style="color: #f8fafc;">${name}</strong>
      </p>

      <!-- Info Card -->
      <div style="background: linear-gradient(135deg, #0a0f1a 0%, #111827 100%); border: 1px solid rgba(96, 165, 250, 0.15); border-radius: 16px; padding: 24px; margin-bottom: 24px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 8px 0;">
              <p style="margin: 0 0 4px 0; font-size: 13px; color: #94a3b8; font-weight: 500;">Request Type</p>
              <p style="margin: 0; font-size: 16px; color: #f8fafc; font-weight: 600;">${category}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 0 8px 0; border-top: 1px solid rgba(71, 85, 105, 0.3);">
              <p style="margin: 0 0 4px 0; font-size: 13px; color: #94a3b8; font-weight: 500;">Status</p>
              <p style="margin: 0; font-size: 16px; color: #10b981; font-weight: 600;">
                <span style="display: inline-block; width: 8px; height: 8px; background-color: #10b981; border-radius: 50%; margin-right: 6px; box-shadow: 0 0 8px #10b981;"></span>
                In Review Queue
              </p>
            </td>
          </tr>
        </table>
      </div>

      <!-- What's Next -->
      <div style="background: rgba(59, 130, 246, 0.1); border-left: 3px solid #3b82f6; border-radius: 8px; padding: 18px 20px; margin-bottom: 24px;">
        <p style="margin: 0 0 8px 0; font-size: 14px; color: #60a5fa; font-weight: 700;">What happens next?</p>
        <p style="margin: 0; font-size: 14px; color: #cbd5e1; line-height: 1.7;">
          Our team will review your message and respond within <strong style="color: #f8fafc;">24-48 hours</strong>. If you need to add more context, just reply to this email.
        </p>
      </div>

      <!-- Footer Info -->
      <div style="text-align: center; padding-top: 20px; border-top: 1px solid rgba(71, 85, 105, 0.3);">
        <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.6;">
          Thanks for using VulnRadar<br />
          <span style="color: #94a3b8; font-weight: 600;">- The VulnRadar Team</span>
        </p>
      </div>
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
      <!-- Security Icon -->
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 80px; height: 80px; background: linear-gradient(135deg, #3b82f6, #2563eb); border-radius: 50%; box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);">
          <svg width="80" height="80" viewBox="0 0 80 80" style="display: block;">
            <rect x="30" y="35" width="20" height="25" rx="2" fill="none" stroke="#ffffff" stroke-width="3"/>
            <path d="M 32 35 V 28 Q 32 22 40 22 Q 48 22 48 28 V 35" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
            <circle cx="40" cy="47" r="3" fill="#ffffff"/>
          </svg>
        </div>
      </div>

      <!-- Main Heading -->
      <h1 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 700; color: #f8fafc; text-align: center; line-height: 1.2;">Reset Your Password</h1>
      <p style="margin: 0 0 28px 0; font-size: 15px; color: #94a3b8; text-align: center; line-height: 1.6;">
        We received a request to reset your VulnRadar password
      </p>

      <!-- CTA Button -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background: linear-gradient(135deg, #2563eb, #3b82f6); border-radius: 12px; box-shadow: 0 6px 20px rgba(37, 99, 235, 0.5);">
                  <a href="${resetLink}" style="display: inline-block; padding: 16px 48px; font-size: 16px; font-weight: 700; color: #ffffff; text-decoration: none; letter-spacing: 0.3px;">
                    Reset Password
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Security Info -->
      <div style="background: rgba(249, 115, 22, 0.1); border-left: 3px solid #f97316; border-radius: 8px; padding: 18px 20px; margin-bottom: 24px;">
        <p style="margin: 0 0 8px 0; font-size: 14px; color: #fb923c; font-weight: 700;">Security Notice</p>
        <p style="margin: 0; font-size: 14px; color: #cbd5e1; line-height: 1.7;">
          This password reset link will expire in <strong style="color: #f8fafc;">1 hour</strong> for your security. If you didn't request this reset, please ignore this email.
        </p>
      </div>

      <!-- Alternative Link -->
      <div style="background: linear-gradient(135deg, #0a0f1a 0%, #111827 100%); border: 1px solid rgba(96, 165, 250, 0.15); border-radius: 12px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 8px 0; font-size: 12px; color: #94a3b8; font-weight: 600;">If the button doesn't work, copy and paste this link:</p>
        <div style="padding: 10px; background-color: rgba(15, 23, 42, 0.6); border-radius: 6px; font-family: 'Courier New', monospace; font-size: 11px; color: #60a5fa; word-break: break-all; line-height: 1.5;">
          ${resetLink}
        </div>
      </div>

      <!-- Footer Info -->
      <div style="text-align: center; padding-top: 20px; border-top: 1px solid rgba(71, 85, 105, 0.3);">
        <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.6;">
          This is an automated security email from VulnRadar<br />
          <span style="color: #94a3b8; font-weight: 600;">For help, contact legal@vulnradar.dev</span>
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
      <!-- Team Icon -->
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 80px; height: 80px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); border-radius: 50%; box-shadow: 0 8px 24px rgba(139, 92, 246, 0.4);">
          <svg width="80" height="80" viewBox="0 0 80 80" style="display: block;">
            <circle cx="40" cy="28" r="8" fill="none" stroke="#ffffff" stroke-width="3"/>
            <path d="M 28 60 Q 28 44 40 44 Q 52 44 52 60" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
            <circle cx="58" cy="32" r="6" fill="none" stroke="#ffffff" stroke-width="2.5"/>
            <path d="M 54 58 Q 54 48 58 48 Q 64 48 64 58" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
            <circle cx="22" cy="32" r="6" fill="none" stroke="#ffffff" stroke-width="2.5"/>
            <path d="M 16 58 Q 16 48 22 48 Q 26 48 26 58" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
        </div>
      </div>

      <!-- Main Heading -->
      <h1 style="margin: 0 0 12px 0; font-size: 26px; font-weight: 700; color: #f8fafc; text-align: center; line-height: 1.2;">You're Invited!</h1>
      <p style="margin: 0 0 28px 0; font-size: 15px; color: #94a3b8; text-align: center; line-height: 1.6;">
        <strong style="color: #f8fafc;">${invitedBy}</strong> wants you to join their team
      </p>

      <!-- Team Info Card -->
      <div style="background: linear-gradient(135deg, #0a0f1a 0%, #111827 100%); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 16px; padding: 24px; margin-bottom: 28px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); text-align: center;">
        <div style="display: inline-block; padding: 10px 20px; background: rgba(139, 92, 246, 0.2); border: 1px solid rgba(139, 92, 246, 0.4); border-radius: 8px; margin-bottom: 16px;">
          <p style="margin: 0; font-size: 12px; color: #c4b5fd; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Team Name</p>
        </div>
        <h2 style="margin: 0; font-size: 24px; font-weight: 700; color: #f8fafc; line-height: 1.2;">${teamName}</h2>
      </div>

      <!-- CTA Button -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background: linear-gradient(135deg, #8b5cf6, #7c3aed); border-radius: 12px; box-shadow: 0 6px 20px rgba(139, 92, 246, 0.5);">
                  <a href="${inviteLink}" style="display: inline-block; padding: 16px 48px; font-size: 16px; font-weight: 700; color: #ffffff; text-decoration: none; letter-spacing: 0.3px;">
                    Accept Invitation
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Benefits Info -->
      <div style="background: rgba(59, 130, 246, 0.1); border-left: 3px solid #3b82f6; border-radius: 8px; padding: 18px 20px; margin-bottom: 24px;">
        <p style="margin: 0 0 12px 0; font-size: 14px; color: #60a5fa; font-weight: 700;">What you'll get:</p>
        <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: #cbd5e1; line-height: 2;">
          <li>Collaborate on vulnerability scans</li>
          <li>Share scan history and reports</li>
          <li>Team-wide security insights</li>
          <li>Centralized scan management</li>
        </ul>
      </div>

      <!-- Expiration Warning -->
      <div style="background: linear-gradient(135deg, #0a0f1a 0%, #111827 100%); border: 1px solid rgba(96, 165, 250, 0.15); border-radius: 12px; padding: 16px; margin-bottom: 20px; text-align: center;">
        <p style="margin: 0; font-size: 13px; color: #94a3b8;">
          This invitation expires in <strong style="color: #f8fafc; font-size: 15px;">7 days</strong>
        </p>
      </div>

      <!-- Alternative Link -->
      <div style="background: rgba(15, 23, 42, 0.6); border-radius: 8px; padding: 12px; margin-bottom: 20px;">
        <p style="margin: 0 0 8px 0; font-size: 11px; color: #94a3b8; font-weight: 600;">If the button doesn't work, copy this link:</p>
        <div style="font-family: 'Courier New', monospace; font-size: 10px; color: #60a5fa; word-break: break-all; line-height: 1.5;">
          ${inviteLink}
        </div>
      </div>

      <!-- Footer Info -->
      <div style="text-align: center; padding-top: 20px; border-top: 1px solid rgba(71, 85, 105, 0.3);">
        <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.6;">
          Join your team on VulnRadar<br />
          <span style="color: #94a3b8; font-weight: 600;">Start collaborating on security scans today</span>
        </p>
      </div>
    `,
    }
}
