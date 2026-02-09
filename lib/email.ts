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

function layout(content: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VulnRadar</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #e5e7eb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0b0f14; padding: 36px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 0 22px 14px; text-align: center;">
              <span style="display: inline-block; font-size: 22px; font-weight: 700; color: #f8fafc; font-family: 'Courier New', monospace; letter-spacing: 0.5px;">VulnRadar</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 22px;">
              <div style="height: 4px; background: linear-gradient(90deg, #2563eb, #22d3ee); border-radius: 999px;"></div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #0f172a; border: 1px solid #1f2937; border-radius: 16px; padding: 28px 26px; box-shadow: 0 12px 32px rgba(2, 6, 23, 0.5);">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding: 18px 22px 0; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 1.6;">
                VulnRadar &mdash; Web Vulnerability Scanner<br />
                <a href="https://vulnradar.dev" style="color: #94a3b8; text-decoration: underline;">vulnradar.dev</a>
              </p>
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
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 18px;">
        <tr>
          <td>
            <h1 style="margin: 0 0 6px; font-size: 20px; font-weight: 700; color: #f8fafc;">New contact request</h1>
            <p style="margin: 0; font-size: 13px; color: #94a3b8; line-height: 1.7;">
              Submitted via VulnRadar contact form. Reply directly to respond.
            </p>
          </td>
          <td align="right" style="vertical-align: top;">
            <span style="display: inline-block; padding: 6px 10px; border-radius: 999px; background-color: #0b1220; border: 1px solid #1f2937; color: #e2e8f0; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;">
              ${category}
            </span>
          </td>
        </tr>
      </table>
      <div style="border: 1px solid #1f2937; border-radius: 14px; padding: 16px; background-color: #0b1220; margin-bottom: 16px;">
        <p style="margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8;">Contact details</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; font-size: 13px; color: #e2e8f0; line-height: 1.6;">
          <tr><td style="padding: 4px 0; width: 110px; color: #94a3b8;">Name</td><td style="padding: 4px 0;">${name}</td></tr>
          <tr><td style="padding: 4px 0; width: 110px; color: #94a3b8;">Email</td><td style="padding: 4px 0;">${email}</td></tr>
          <tr><td style="padding: 4px 0; width: 110px; color: #94a3b8;">Subject</td><td style="padding: 4px 0;">${subject}</td></tr>
        </table>
      </div>
      <div style="border: 1px solid #1f2937; border-radius: 14px; padding: 16px; background-color: #0b1220;">
        <p style="margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8;">Message</p>
        <div style="font-size: 13px; color: #e2e8f0; line-height: 1.7;">
          ${message}
        </div>
      </div>
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
      <h1 style="margin: 0 0 6px; font-size: 20px; font-weight: 700; color: #f8fafc;">We received your message</h1>
      <p style="margin: 0 0 14px; font-size: 14px; color: #cbd5f5; line-height: 1.7;">
        Hi ${name}, thanks for reaching out to VulnRadar. We received your <strong style="color: #f8fafc;">${category}</strong> and our team will review it shortly.
      </p>
      <div style="border: 1px solid #1f2937; border-radius: 12px; padding: 14px; background-color: #0b1220; margin-bottom: 14px;">
        <p style="margin: 0; font-size: 13px; color: #e2e8f0; line-height: 1.7;">
          If you need to add more context or attachments, reply to this email and it will be added to your request.
        </p>
      </div>
      <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.6;">
        - VulnRadar Support
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
      <h1 style="margin: 0 0 6px; font-size: 20px; font-weight: 700; color: #f8fafc;">Reset your password</h1>
      <p style="margin: 0 0 20px; font-size: 14px; color: #cbd5f5; line-height: 1.7;">
        We received a request to reset your VulnRadar password. If this was you, use the button below to continue.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 18px;">
        <tr>
          <td style="background-color: #2563eb; border-radius: 10px;">
            <a href="${resetLink}" style="display: inline-block; padding: 12px 26px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none;">
              Reset Password
            </a>
          </td>
        </tr>
      </table>
      <p style="margin: 0 0 8px; font-size: 12px; color: #94a3b8; line-height: 1.6;">
        This link expires in 1 hour. If you did not request this, you can safely ignore this email.
      </p>
      <div style="font-size: 11px; color: #64748b; line-height: 1.6; word-break: break-all;">
        <span style="color: #94a3b8;">Link:</span> ${resetLink}
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
      <h1 style="margin: 0 0 6px; font-size: 20px; font-weight: 700; color: #f8fafc;">Team invitation</h1>
      <p style="margin: 0 0 16px; font-size: 14px; color: #cbd5f5; line-height: 1.7;">
        <strong style="color: #f8fafc;">${invitedBy}</strong> invited you to join <strong style="color: #f8fafc;">${teamName}</strong> on VulnRadar.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 16px;">
        <tr>
          <td style="background-color: #2563eb; border-radius: 10px;">
            <a href="${inviteLink}" style="display: inline-block; padding: 12px 26px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none;">
              Accept Invitation
            </a>
          </td>
        </tr>
      </table>
      <div style="border-top: 1px solid #1f2937; padding-top: 12px;">
        <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.6;">
          This invitation expires in 7 days.
        </p>
      </div>
    `,
    }
}
