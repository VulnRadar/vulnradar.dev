import nodemailer from "nodemailer";
import {
  APP_NAME,
  APP_URL,
  SUPPORT_EMAIL,
  LOGO_URL,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
} from "@/lib/config/constants";
import { STAFF_INVITE_EXPIRY_DAYS } from "@/lib/config/constants";
import { BRAND } from "@/lib/config/brand";

// Named for the legacy call sites throughout this file. The values come from
// lib/config/brand.ts (the single brand source of truth for email) rather than
// being hardcoded here, so an email's colours can't drift from the product.
const COLORS = {
  BG_DARK: BRAND.bg,
  BG_CARD: BRAND.surface,
  BG_SECTION: BRAND.surfaceRaised,
  BG_INFO: BRAND.infoBg,
  BG_SUCCESS: BRAND.successBg,
  BG_WARNING: BRAND.warningBg,
  BG_DANGER: BRAND.dangerBg,
  BORDER: BRAND.border,
  BORDER_SECTION: BRAND.borderStrong,
  TEXT_PRIMARY: BRAND.text,
  TEXT_SECONDARY: BRAND.textMuted,
  TEXT_MUTED: BRAND.textFaint,
  TEXT_DARK: BRAND.textDim,
  ACCENT_BLUE: BRAND.primary,
  ACCENT_BLUE_LIGHT: BRAND.primaryLight,
  ACCENT_BLUE_PALE: BRAND.primaryPale,
  ACCENT_GREEN: BRAND.success,
  ACCENT_GREEN_LIGHT: BRAND.successLight,
  ACCENT_GREEN_PALE: BRAND.successPale,
  ACCENT_GREEN_TEXT: BRAND.successText,
  ACCENT_YELLOW: BRAND.warning,
  ACCENT_YELLOW_LIGHT: BRAND.warningLight,
  ACCENT_YELLOW_PALE: BRAND.warningPale,
  ACCENT_RED: BRAND.danger,
  ACCENT_RED_LIGHT: BRAND.dangerLight,
  ACCENT_RED_PALE: BRAND.dangerPale,
  WHITE: BRAND.onPrimary,
} as const;

// infra: pin SMTP to TLS. The transport used `secure: false` without
// `requireTLS: true`, which falls back to plaintext if the server
// strips STARTTLS. We pick the right mode per port:
//   - 465 → implicit TLS (secure: true)
//   - 587 → STARTTLS (requireTLS: true)
//   - 25  → STARTTLS required (plaintext port 25 should be blocked
//     at the network layer)
function buildSmtpTransport() {
  const port = Number(SMTP_PORT);
  // Use secure: true for port 465 (implicit TLS).
  if (port === 465) {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: true,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { minVersion: "TLSv1.2" },
    });
  }
  // Port 587 / 25: STARTTLS, refuse to fall back to plaintext.
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: false,
    requireTLS: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: "TLSv1.2" },
  });
}

// Only create transporter if SMTP is configured
const transporter =
  SMTP_HOST && SMTP_USER && SMTP_PASS ? buildSmtpTransport() : null;

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  skipLayout?: boolean;
  unsubscribeToken?: string;
}

interface SecurityAlertDetails {
  ipAddress: string;
  userAgent: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(content: string, unsubscribeToken?: string): string {
  const hostname = new URL(APP_URL).hostname;
  // Email clients don't resolve root-relative asset paths, so an absolute URL
  // is required for the logo to load at all.
  const logoSrc = /^https?:\/\//i.test(LOGO_URL)
    ? LOGO_URL
    : `${APP_URL}${LOGO_URL}`;
  const unsubscribeUrl = unsubscribeToken
    ? `${APP_URL}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`
    : null;

  const preferencesButton = unsubscribeUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto 18px auto;">
        <tr>
          <td bgcolor="${COLORS.BG_SECTION}" style="border-radius: 6px;">
            <a href="${unsubscribeUrl}" style="display: inline-block; padding: 8px 18px; background-color: ${COLORS.BG_SECTION}; border: 1px solid ${COLORS.BORDER_SECTION}; color: ${COLORS.TEXT_SECONDARY}; font-size: 12px; font-weight: 600; text-decoration: none; border-radius: 6px;">Manage email preferences</a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="dark light" />
  <meta name="supported-color-schemes" content="dark light" />
  <title>${APP_NAME}</title>
  <style>
    /* Progressive enhancement only; every element also carries inline styles. */
    @media only screen and (max-width: 600px) {
      .vr-shell { padding: 24px 12px !important; }
      .vr-card { padding: 26px 20px !important; }
    }
    a { color: ${COLORS.ACCENT_BLUE_LIGHT}; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${COLORS.BG_DARK}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: ${COLORS.TEXT_PRIMARY};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${COLORS.BG_DARK};">
    <tr>
      <td align="center" class="vr-shell" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
          <tr>
            <td align="center" style="padding: 0 0 22px 0;">
              <a href="${APP_URL}" style="text-decoration: none; color: ${COLORS.TEXT_PRIMARY};">
                <img src="${logoSrc}" alt="" width="30" height="30" style="display: inline-block; vertical-align: middle; border: 0;" />
                <span style="display: inline-block; vertical-align: middle; margin-left: 9px; font-size: 19px; font-weight: 700; letter-spacing: -0.2px; color: ${COLORS.TEXT_PRIMARY};">${APP_NAME}</span>
              </a>
            </td>
          </tr>
          <tr>
            <td class="vr-card" style="background-color: ${COLORS.BG_CARD}; border: 1px solid ${COLORS.BORDER}; border-top: 3px solid ${COLORS.ACCENT_BLUE}; border-radius: 12px; padding: 34px 32px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding: 26px 16px 0 16px; text-align: center;">
              ${preferencesButton}
              <p style="margin: 0 0 10px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED}; line-height: 1.6;">
                You're getting this because you have a ${APP_NAME} account. Choose what we send you in your account settings, or reach the team at <a href="mailto:${SUPPORT_EMAIL}" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">${SUPPORT_EMAIL}</a>.
              </p>
              <p style="margin: 0; font-size: 11px; color: ${COLORS.TEXT_DARK}; line-height: 1.5;">
                ${APP_NAME}, web vulnerability scanner &middot; <a href="${APP_URL}" style="color: ${COLORS.TEXT_DARK}; text-decoration: underline;">${hostname}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// NEW EMAIL PATTERN -- shared building blocks.
//
// The old templates all shared one tell: a rhetorical-question callout box
// ("Why verify?", "Didn't do this?") plus platitude copy and emoji. These
// helpers replace that with plain, specific pieces a template composes: a
// heading, a lead paragraph, a real CTA button, a copy-paste fallback link, a
// clean label/value detail block, and a prose note with an accent edge but no
// question label. Converting a template means dropping the question boxes and
// building it out of these instead. See emailVerificationEmail /
// passwordResetEmail / scanCompleteEmail below for the reference conversions.

function emailHeading(text: string): string {
  return `<h1 style="margin: 0 0 12px 0; font-size: 21px; line-height: 1.3; font-weight: 700; color: ${COLORS.TEXT_PRIMARY}; letter-spacing: -0.2px;">${text}</h1>`;
}

function emailLead(text: string): string {
  return `<p style="margin: 0 0 24px 0; font-size: 15px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.65;">${text}</p>`;
}

function emailParagraph(text: string): string {
  return `<p style="margin: 0 0 20px 0; font-size: 14px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.65;">${text}</p>`;
}

// Primary call to action. Left-aligned with the body copy on purpose: it reads
// like a next step in a sentence, not a centered marketing banner.
function emailButton(
  href: string,
  label: string,
  bg: string = COLORS.ACCENT_BLUE,
): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 4px 0 22px 0;">
      <tr>
        <td bgcolor="${bg}" style="border-radius: 8px;">
          <a href="${href}" style="display: inline-block; padding: 13px 30px; background-color: ${bg}; color: ${COLORS.WHITE}; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">${label}</a>
        </td>
      </tr>
    </table>`;
}

// The "if the button doesn't work" fallback, as plain prose plus the raw URL.
function emailFallbackLink(url: string): string {
  return `
    <p style="margin: 0 0 6px 0; font-size: 13px; color: ${COLORS.TEXT_MUTED}; line-height: 1.6;">Or paste this link into your browser:</p>
    <p style="margin: 0; font-size: 13px; color: ${COLORS.ACCENT_BLUE_LIGHT}; word-break: break-all; line-height: 1.6; font-family: 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace;">${url}</p>`;
}

// A quiet callout: an accent edge and prose, no bold question label. Use it for
// the genuinely useful aside (expiry, "you can ignore this"), not a platitude.
function emailNote(
  text: string,
  accent: string = COLORS.ACCENT_BLUE_LIGHT,
): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 20px 0;">
      <tr>
        <td style="background-color: ${COLORS.BG_SECTION}; border-left: 3px solid ${accent}; border-radius: 6px; padding: 12px 16px; font-size: 13px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.65;">${text}</td>
      </tr>
    </table>`;
}

interface EmailDetailRow {
  label: string;
  value: string;
  mono?: boolean;
  color?: string;
}

// A surface panel of label/value rows. Replaces the ad-hoc grey card + inline
// <table> each old template hand-rolled; callers pass already-escaped values.
function emailDetailPanel(rows: EmailDetailRow[]): string {
  const body = rows
    .map((r, i) => {
      const top =
        i === 0
          ? ""
          : `border-top: 1px solid ${COLORS.BORDER}; padding-top: 10px;`;
      const gap = i === 0 ? "0" : "10px";
      const mono = r.mono
        ? "font-family: 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace;"
        : "";
      return `
        <tr>
          <td style="padding: ${gap} 0 8px 0; ${top} color: ${COLORS.TEXT_MUTED}; font-size: 13px; width: 130px; vertical-align: top;">${r.label}</td>
          <td style="padding: ${gap} 0 8px 0; ${top} color: ${r.color ?? COLORS.TEXT_PRIMARY}; font-size: 13px; word-break: break-word; ${mono}">${r.value}</td>
        </tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin: 0 0 22px 0;">
      ${body}
    </table>`;
}

// Session details for a security notice, as a clean label/value panel. Callers
// pass a `SecurityAlertDetails`; values are escaped here.
function securityDetailsBlock(details: SecurityAlertDetails): string {
  return emailDetailPanel([
    { label: "IP address", value: escapeHtml(details.ipAddress), mono: true },
    { label: "Device", value: escapeHtml(details.userAgent) },
  ]);
}

// The "if this wasn't you" aside shared by the account-change notices. Prose in
// a warning-accent note, no rhetorical question label.
function securityWarningBlock(): string {
  return emailNote(
    `If this wasn't you, change your password and review your active sessions right away, then email <a href="mailto:${SUPPORT_EMAIL}" style="color: ${COLORS.ACCENT_YELLOW_LIGHT}; text-decoration: underline;">${SUPPORT_EMAIL}</a>.`,
    COLORS.ACCENT_YELLOW_LIGHT,
  );
}

// A one-time code, rendered big, centered, and letter-spaced so it's easy to
// read off the screen and copy. The `text-indent` cancels the trailing gap
// letter-spacing leaves after the last glyph, keeping the run visually centered.
function emailCodeBlock(code: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 22px 0;">
      <tr>
        <td align="center" style="background-color: ${COLORS.BG_SECTION}; border: 1px solid ${COLORS.BORDER_SECTION}; border-radius: 10px; padding: 24px 16px;">
          <div style="font-size: 34px; font-weight: 700; letter-spacing: 10px; text-indent: 10px; color: ${COLORS.ACCENT_BLUE_LIGHT}; font-family: 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace;">${escapeHtml(code)}</div>
        </td>
      </tr>
    </table>`;
}

// One severity pill: an outlined chip coloured from BRAND.severity. Empty when
// the count is zero, so a chip row only shows the severities actually present.
// Same treatment as scanCompleteEmail, pulled up here so the scheduled-scan,
// regression, and digest reports render findings identically.
function severityChip(label: string, count: number, color: string): string {
  return count > 0
    ? `<td style="padding: 0 6px 6px 0;"><span style="display: inline-block; padding: 5px 11px; border: 1px solid ${color}; border-radius: 999px; font-size: 12px; font-weight: 600; color: ${color}; white-space: nowrap;">${count} ${label}</span></td>`
    : "";
}

function severityChipRow(counts: {
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  info?: number;
}): string {
  const chips = [
    severityChip("critical", counts.critical ?? 0, BRAND.severity.critical),
    severityChip("high", counts.high ?? 0, BRAND.severity.high),
    severityChip("medium", counts.medium ?? 0, BRAND.severity.medium),
    severityChip("low", counts.low ?? 0, BRAND.severity.low),
    severityChip("info", counts.info ?? 0, BRAND.severity.info),
  ].join("");
  return chips
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 22px 0;"><tr>${chips}</tr></table>`
    : "";
}

/**
 * AUDIT-010: replaces every link, numeric code, and long token in an email
 * body with a [REDACTED ...] marker before it's ever written to
 * email_logs.redacted_preview -- so admin staff can see an email was sent
 * and roughly what it contained, but never a working password-reset link,
 * invite link, or 2FA code. Deliberately over-redacts (a plain 4+ digit
 * run, any URL, any long opaque string) rather than trying to enumerate
 * every current and future secret shape by name.
 */
export function redactEmailPreview(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "[REDACTED LINK]")
    .replace(/\b\d{4,}\b/g, "[REDACTED CODE]")
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, "[REDACTED TOKEN]");
}

const EMAIL_LOG_PREVIEW_MAX_CHARS = 500;

/**
 * Best-effort write to email_logs (Admin > System > Email Logs). Never
 * throws -- a logging failure must never mask the real send outcome or
 * break a caller that only expects sendEmail() itself to fail. Lazily
 * imports the DB pool (instead of a top-level import) so this module,
 * which every email-sending code path already depends on, doesn't gain a
 * hard load-time dependency on DATABASE_URL being set -- see this
 * session's earlier fix for the identical problem in
 * lib/admin/staff-invites.ts's STAFF_INVITE_EXPIRY_DAYS.
 */
async function logEmailAttempt(params: {
  to: string;
  subject: string;
  text: string;
  status: "sent" | "failed" | "skipped_not_configured";
  error?: string;
}): Promise<void> {
  try {
    const { default: pool } = await import("@/lib/database/db");
    await pool.query(
      `INSERT INTO email_logs (recipient, subject, status, error_message, redacted_preview)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        params.to,
        params.subject,
        params.status,
        params.error ?? null,
        redactEmailPreview(params.text).slice(0, EMAIL_LOG_PREVIEW_MAX_CHARS),
      ],
    );
  } catch {
    /* logging is best-effort only */
  }
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
  replyTo,
  skipLayout,
  unsubscribeToken,
}: SendEmailOptions) {
  // Check if SMTP is configured
  if (!transporter) {
    console.warn("SMTP not configured. Email not sent:");
    console.warn(`  To: ${to}`);
    console.warn(`  Subject: ${subject}`);
    // privacy: log only metadata (length), never the email body.
    // Email bodies can contain reset links, 2FA codes, or share
    // tokens — they must never appear in logs even truncated.
    console.warn(`  Length: ${text.length} chars`);

    // In development, just log and return successfully
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "  (Skipping email send in development - SMTP not configured)",
      );
      await logEmailAttempt({
        to,
        subject,
        text,
        status: "skipped_not_configured",
      });
      return;
    }

    await logEmailAttempt({
      to,
      subject,
      text,
      status: "skipped_not_configured",
      error: "SMTP not configured",
    });
    throw new Error("Email service not configured");
  }

  const from = `"${APP_NAME}" <${SMTP_FROM}>`;
  const finalHtml = skipLayout ? html : layout(html, unsubscribeToken);
  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html: finalHtml,
      replyTo,
    });
    await logEmailAttempt({ to, subject, text, status: "sent" });
  } catch (err) {
    await logEmailAttempt({
      to,
      subject,
      text,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  bug: "Bug Report",
  feature: "Feature Request",
  security: "Security Issue",
  help: "General Help",
  billing: "Billing Issue",
  enterprise: "Enterprise",
  staff_application: "Staff Application",
  feedback: "Feedback",
};

export function contactEmail(input: {
  name: string;
  email: string;
  subject: string;
  message: string;
  category: string;
}) {
  const name = escapeHtml(input.name);
  const email = escapeHtml(input.email);
  const subject = escapeHtml(input.subject);
  const message = escapeHtml(input.message).replace(/\n/g, "<br />");
  const category =
    CATEGORY_LABELS[input.category] || escapeHtml(input.category);

  return {
    subject: `[Contact] ${input.subject}`,
    text: `New contact request via the ${APP_NAME} contact form.\n\nCategory: ${category}\nName: ${input.name}\nEmail: ${input.email}\nSubject: ${input.subject}\n\nMessage:\n${input.message}`,
    html: `
      ${emailHeading("New contact request")}
      ${emailLead(`${name} reached out through the ${APP_NAME} contact form.`)}
      ${emailDetailPanel([
        { label: "Name", value: name },
        {
          label: "Email",
          value: `<a href="mailto:${email}" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">${email}</a>`,
        },
        { label: "Category", value: category },
        { label: "Subject", value: subject },
      ])}
      ${emailParagraph(message)}
      ${emailButton(`mailto:${email}`, `Reply to ${name}`)}
    `,
  };
}

export function contactConfirmationEmail(input: {
  name: string;
  category: string;
}) {
  const name = escapeHtml(input.name);
  const category = escapeHtml(input.category);

  return {
    subject: "We got your message",
    text: `Hi ${input.name},\n\nThanks for contacting ${APP_NAME}. Your ${input.category.toLowerCase()} request is in our queue.\n\nWe usually reply within 24 to 48 hours. To add anything, just reply to this email and it lands on the same thread.\n\n- ${APP_NAME} Support`,
    html: `
      ${emailHeading("We got your message")}
      ${emailLead(`Hi ${name}, thanks for reaching out. Your ${category.toLowerCase()} request is in our queue.`)}
      ${emailDetailPanel([
        { label: "Request type", value: category },
        {
          label: "Status",
          value: "In review",
          color: COLORS.ACCENT_GREEN_TEXT,
        },
      ])}
      ${emailParagraph(
        "We usually reply within 24 to 48 hours. To add anything, just reply to this email and it lands on the same thread.",
      )}
    `,
  };
}

export function emailVerificationEmail(name: string, verifyLink: string) {
  const safeName = escapeHtml(name);
  return {
    subject: `Verify your email for ${APP_NAME}`,
    text: `Hi ${name},\n\nConfirm this email address to activate your ${APP_NAME} account:\n${verifyLink}\n\nThe link works for the next 24 hours. If it expires, request a new one from the sign-in page.\n\nIf you didn't create this account, you can ignore this email. Nothing was set up.`,
    html: `
      ${emailHeading("Confirm your email address")}
      ${emailLead(`Hi ${safeName}, confirm this is your address and your ${APP_NAME} account is ready to scan.`)}
      ${emailButton(verifyLink, "Verify email address")}
      ${emailNote(
        "The link works for the next 24 hours. If it expires, request a new one from the sign-in page.",
      )}
      ${emailParagraph(
        "If you didn't create this account, you can ignore this email. Nothing was set up.",
      )}
      ${emailFallbackLink(verifyLink)}
    `,
  };
}

export function passwordResetEmail(resetLink: string) {
  return {
    subject: `Reset your ${APP_NAME} password`,
    text: `Someone asked to reset the password for your ${APP_NAME} account.\n\nChoose a new password here:\n${resetLink}\n\nThe link works for one hour, then it stops working. If you didn't request this, you can ignore this email and your current password stays the same.`,
    html: `
      ${emailHeading("Reset your password")}
      ${emailLead(`Someone asked to reset the password for your ${APP_NAME} account. If that was you, set a new one below.`)}
      ${emailButton(resetLink, "Choose a new password")}
      ${emailNote(
        "The link works for one hour, then it stops working. If you didn't request this, you can ignore this email and your current password stays the same.",
        COLORS.ACCENT_YELLOW_LIGHT,
      )}
      ${emailFallbackLink(resetLink)}
    `,
  };
}

export function passwordChangedEmail(
  hasTwoFactor: boolean,
  details: SecurityAlertDetails,
) {
  const securityInfo = hasTwoFactor
    ? "Two-factor authentication is on, so you'll enter your authenticator code the next time you sign in."
    : "Every active session was signed out. Sign in again with your new password.";

  return {
    subject: `Your ${APP_NAME} password was changed`,
    text: `The password for your ${APP_NAME} account was just changed.\n\n${securityInfo}\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, change your password and review your active sessions right away, then email ${SUPPORT_EMAIL}.`,
    html: `
      ${emailHeading("Your password was changed")}
      ${emailLead(`The password for your ${APP_NAME} account was just changed.`)}
      ${emailNote(securityInfo)}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

export function teamInviteEmail(
  teamName: string,
  inviteLink: string,
  invitedBy: string,
) {
  const safeTeamName = escapeHtml(teamName);
  const safeInvitedBy = escapeHtml(invitedBy);
  const safeInviteLink = /^https?:\/\//i.test(inviteLink)
    ? inviteLink
    : "#invalid";
  return {
    subject: `Join ${safeTeamName} on ${APP_NAME}`,
    text: `${invitedBy} invited you to join the team "${teamName}" on ${APP_NAME}. Accepting shares scans, history, and reports across everyone on the team.\n\nAccept the invitation:\n${inviteLink}\n\nThe invite expires in 7 days. If you weren't expecting it, you can ignore this email.`,
    html: `
      ${emailHeading(`Join ${safeTeamName} on ${APP_NAME}`)}
      ${emailLead(`<strong style="color: ${COLORS.TEXT_PRIMARY};">${safeInvitedBy}</strong> invited you to their team. Accepting shares scans, history, and reports across everyone on it.`)}
      ${emailButton(safeInviteLink, "Accept invitation")}
      ${emailNote(
        "The invite expires in 7 days. If you weren't expecting it, you can ignore this email.",
      )}
      ${emailFallbackLink(inviteLink)}
    `,
  };
}

export function staffInviteEmail(
  roleLabel: string,
  inviteLink: string,
  invitedBy: string,
) {
  const safeRoleLabel = escapeHtml(roleLabel);
  const safeInvitedBy = escapeHtml(invitedBy);
  const safeInviteLink = /^https?:\/\//i.test(inviteLink)
    ? inviteLink
    : "#invalid";
  return {
    subject: `Join the ${APP_NAME} team as ${safeRoleLabel}`,
    text: `${invitedBy} invited you to join the ${APP_NAME} staff as ${roleLabel}.\n\nAccept the invitation:\n${inviteLink}\n\nThe invite expires in ${STAFF_INVITE_EXPIRY_DAYS} days. If you weren't expecting it, you can ignore this email.`,
    html: `
      ${emailHeading(`Join the ${APP_NAME} team`)}
      ${emailLead(`<strong style="color: ${COLORS.TEXT_PRIMARY};">${safeInvitedBy}</strong> invited you to join the ${APP_NAME} staff as ${safeRoleLabel}.`)}
      ${emailButton(safeInviteLink, "Accept invitation")}
      ${emailNote(
        `The invite expires in ${STAFF_INVITE_EXPIRY_DAYS} days. If you weren't expecting it, you can ignore this email.`,
        COLORS.ACCENT_YELLOW_LIGHT,
      )}
      ${emailFallbackLink(inviteLink)}
    `,
  };
}

export function landingContactEmail(input: { email: string; message: string }) {
  const email = escapeHtml(input.email);
  const message = escapeHtml(input.message).replace(/\n/g, "<br />");

  return {
    subject: "[Landing Page] New Inquiry",
    text: `New inquiry from the ${APP_NAME} landing page.\n\nEmail: ${input.email}\n\nMessage:\n${input.message}`,
    html: `
      ${emailHeading("New landing page inquiry")}
      ${emailLead(`Someone reached out through the ${APP_NAME} landing page.`)}
      ${emailDetailPanel([
        {
          label: "Email",
          value: `<a href="mailto:${email}" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">${email}</a>`,
        },
      ])}
      ${emailParagraph(message)}
      ${emailButton(`mailto:${email}`, "Reply")}
    `,
  };
}

export function landingContactConfirmationEmail(message: string) {
  const escapedMessage = escapeHtml(message).replace(/\n/g, "<br />");

  return {
    subject: "We got your message",
    text: `Thanks for reaching out. We'll get back to you within 24 hours.\n\nHere's what you sent, for your records:\n${message}\n\nWhile you wait, you can read the docs at ${APP_URL}/docs or start scanning by creating an account at ${APP_URL}/signup.`,
    html: `
      ${emailHeading("We got your message")}
      ${emailLead("Thanks for reaching out. We'll get back to you within 24 hours. Here's what you sent, for your records:")}
      ${emailParagraph(escapedMessage)}
      ${emailNote(
        `While you wait, you can read the <a href="${APP_URL}/docs" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">docs</a> or start scanning by <a href="${APP_URL}/signup" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">creating an account</a>.`,
      )}
    `,
  };
}

export function profileNameChangedEmail(
  oldName: string,
  newName: string,
  details: SecurityAlertDetails,
) {
  return {
    subject: `Your ${APP_NAME} account name was changed`,
    text: `The name on your ${APP_NAME} account was just updated.\n\nPrevious name: ${oldName}\nNew name: ${newName}\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, change your password and review your active sessions right away.`,
    html: `
      ${emailHeading("Your account name was changed")}
      ${emailLead(`The name on your ${APP_NAME} account was just updated.`)}
      ${emailDetailPanel([
        { label: "Previous name", value: escapeHtml(oldName) },
        {
          label: "New name",
          value: escapeHtml(newName),
          color: COLORS.ACCENT_GREEN_TEXT,
        },
      ])}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

export function profileEmailChangedEmail(
  oldEmail: string,
  newEmail: string,
  details: SecurityAlertDetails,
) {
  return {
    subject: `Your ${APP_NAME} account email was changed`,
    text: `The email address on your ${APP_NAME} account was just updated.\n\nPrevious email: ${oldEmail}\nNew email: ${newEmail}\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, change your password and review your active sessions right away.`,
    html: `
      ${emailHeading("Your account email was changed")}
      ${emailLead(`The email address on your ${APP_NAME} account was just updated.`)}
      ${emailDetailPanel([
        { label: "Previous email", value: escapeHtml(oldEmail) },
        {
          label: "New email",
          value: escapeHtml(newEmail),
          color: COLORS.ACCENT_GREEN_TEXT,
        },
      ])}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

export function profilePasswordChangedEmail(details: SecurityAlertDetails) {
  return {
    subject: `Your ${APP_NAME} password was changed`,
    text: `The password for your ${APP_NAME} account was just updated.\n\nSigned in on a shared device recently? Review your active sessions in profile settings and sign out anything you don't recognize.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, change your password and review your active sessions right away.`,
    html: `
      ${emailHeading("Your password was changed")}
      ${emailLead(`The password for your ${APP_NAME} account was just updated.`)}
      ${emailNote(
        "Signed in on a shared device recently? Review your active sessions in profile settings and sign out anything you don't recognize.",
      )}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

export function twoFactorEnabledEmail(details: SecurityAlertDetails) {
  return {
    subject: `Two-factor authentication is on for your ${APP_NAME} account`,
    text: `Two-factor authentication was just turned on for your ${APP_NAME} account. From now on you'll enter a code from your authenticator app each time you sign in.\n\nKeep your backup codes somewhere safe. They're the way back in if you lose access to your authenticator app.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, change your password and review your active sessions right away.`,
    html: `
      ${emailHeading("Two-factor authentication is on")}
      ${emailLead(`Two-factor authentication was just turned on for your ${APP_NAME} account. From now on you'll enter a code from your authenticator app each time you sign in.`)}
      ${emailNote(
        "Keep your backup codes somewhere safe. They're the way back in if you lose access to your authenticator app.",
      )}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

export function twoFactorDisabledEmail(details: SecurityAlertDetails) {
  return {
    subject: `Two-factor authentication is off for your ${APP_NAME} account`,
    text: `Two-factor authentication was just turned off for your ${APP_NAME} account. Signing in no longer asks for an authenticator code.\n\nTwo-factor authentication is one of the best defenses against a stolen password. You can turn it back on anytime in your security settings.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, change your password and review your active sessions right away.`,
    html: `
      ${emailHeading("Two-factor authentication is off")}
      ${emailLead(`Two-factor authentication was just turned off for your ${APP_NAME} account. Signing in no longer asks for an authenticator code.`)}
      ${emailNote(
        "Two-factor authentication is one of the best defenses against a stolen password. You can turn it back on anytime in your security settings.",
        COLORS.ACCENT_YELLOW_LIGHT,
      )}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

export function backupCodesRegeneratedEmail(details: SecurityAlertDetails) {
  return {
    subject: `Your ${APP_NAME} backup codes were regenerated`,
    text: `A new set of two-factor backup codes was just generated for your ${APP_NAME} account.\n\nYour old backup codes no longer work. Save the new ones somewhere safe, like a password manager.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, change your password and review your active sessions right away.`,
    html: `
      ${emailHeading("Your backup codes were regenerated")}
      ${emailLead(`A new set of two-factor backup codes was just generated for your ${APP_NAME} account.`)}
      ${emailNote(
        "Your old backup codes no longer work. Save the new ones somewhere safe, like a password manager.",
        COLORS.ACCENT_YELLOW_LIGHT,
      )}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

// API Key emails
export function apiKeyCreatedEmail(
  keyName: string,
  keyPrefix: string,
  details: SecurityAlertDetails,
) {
  const safeName = escapeHtml(keyName);
  return {
    subject: `A new API key was created on your ${APP_NAME} account`,
    text: `A new API key "${keyName}" was just added to your ${APP_NAME} account.\n\nKey prefix: ${keyPrefix}...\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you didn't create this key, revoke it from your API settings and email ${SUPPORT_EMAIL}.`,
    html: `
      ${emailHeading("A new API key was created")}
      ${emailLead(`A new API key was just added to your ${APP_NAME} account.`)}
      ${emailDetailPanel([
        { label: "Key name", value: safeName },
        {
          label: "Key prefix",
          value: `${escapeHtml(keyPrefix)}...`,
          mono: true,
          color: COLORS.ACCENT_BLUE_LIGHT,
        },
      ])}
      ${securityDetailsBlock(details)}
      ${emailNote(
        `If you didn't create this key, revoke it from your API settings and email <a href="mailto:${SUPPORT_EMAIL}" style="color: ${COLORS.ACCENT_YELLOW_LIGHT}; text-decoration: underline;">${SUPPORT_EMAIL}</a>.`,
        COLORS.ACCENT_YELLOW_LIGHT,
      )}
    `,
  };
}

export function apiKeyDeletedEmail(
  keyName: string,
  details: SecurityAlertDetails,
) {
  const safeName = escapeHtml(keyName);
  return {
    subject: `An API key was revoked on your ${APP_NAME} account`,
    text: `The API key "${keyName}" was just revoked on your ${APP_NAME} account. It can no longer be used to authenticate API requests.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you didn't revoke this key, someone may have access to your account. Change your password and email ${SUPPORT_EMAIL}.`,
    html: `
      ${emailHeading("An API key was revoked")}
      ${emailLead(`The API key "${safeName}" was just revoked on your ${APP_NAME} account. It can no longer be used to authenticate API requests.`)}
      ${emailDetailPanel([
        { label: "Key name", value: safeName },
        { label: "Status", value: "Revoked", color: COLORS.ACCENT_RED_LIGHT },
      ])}
      ${securityDetailsBlock(details)}
      ${emailNote(
        `If you didn't revoke this key, someone may have access to your account. Change your password and email <a href="mailto:${SUPPORT_EMAIL}" style="color: ${COLORS.ACCENT_RED_LIGHT}; text-decoration: underline;">${SUPPORT_EMAIL}</a>.`,
        COLORS.ACCENT_RED_LIGHT,
      )}
    `,
  };
}

// Webhook emails
export function webhookCreatedEmail(
  webhookName: string,
  webhookUrl: string,
  webhookType: string,
  details: SecurityAlertDetails,
) {
  const safeName = escapeHtml(webhookName);
  const safeType = escapeHtml(webhookType);
  return {
    subject: `A webhook was created on your ${APP_NAME} account`,
    text: `A new ${webhookType} webhook "${webhookName}" was just added to your ${APP_NAME} account.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you didn't create this webhook, delete it from your webhook settings.`,
    html: `
      ${emailHeading("A webhook was created")}
      ${emailLead(`A new webhook was just added to your ${APP_NAME} account.`)}
      ${emailDetailPanel([
        { label: "Webhook name", value: safeName },
        { label: "Type", value: safeType, color: COLORS.ACCENT_BLUE_LIGHT },
      ])}
      ${securityDetailsBlock(details)}
      ${emailNote(
        "If you didn't create this webhook, delete it from your webhook settings.",
        COLORS.ACCENT_YELLOW_LIGHT,
      )}
    `,
  };
}

export function webhookDeletedEmail(
  webhookName: string,
  details: SecurityAlertDetails,
) {
  const safeName = escapeHtml(webhookName);
  return {
    subject: `A webhook was deleted from your ${APP_NAME} account`,
    text: `The webhook "${webhookName}" was just removed from your ${APP_NAME} account. It will no longer receive scan events.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you didn't delete this webhook, review your account activity and change your password.`,
    html: `
      ${emailHeading("A webhook was deleted")}
      ${emailLead(`The webhook "${safeName}" was just removed from your ${APP_NAME} account. It will no longer receive scan events.`)}
      ${emailDetailPanel([
        { label: "Webhook name", value: safeName },
        { label: "Status", value: "Deleted", color: COLORS.ACCENT_RED_LIGHT },
      ])}
      ${securityDetailsBlock(details)}
      ${emailNote(
        "If you didn't delete this webhook, review your account activity and change your password.",
        COLORS.ACCENT_YELLOW_LIGHT,
      )}
    `,
  };
}

interface WebhookFailureDetails {
  firstStatus: number | null;
  retryStatus: number | null;
  manageUrl: string;
}

function statusLabel(status: number | null): string {
  return status === null ? "no response / network error" : `HTTP ${status}`;
}

export function webhookDeliveryFailedEmail(
  webhookUrl: string,
  details: WebhookFailureDetails,
) {
  const safeUrl = escapeHtml(webhookUrl);
  const firstLabel = statusLabel(details.firstStatus);
  const retryLabel = statusLabel(details.retryStatus);
  return {
    subject: `${APP_NAME} couldn't deliver a scan to your webhook`,
    text: `A scan finished, but ${APP_NAME} couldn't deliver the result to your webhook. Both the initial attempt and the retry failed.\n\nWebhook URL: ${webhookUrl}\nFirst attempt: ${firstLabel}\nRetry: ${retryLabel}\n\nThe webhook is still active, so future scans will keep trying to deliver to it. Check that your endpoint is reachable and returns a 2xx status, then manage it at ${details.manageUrl}`,
    html: `
      ${emailHeading("Webhook delivery failed")}
      ${emailLead(`A scan finished, but ${APP_NAME} couldn't deliver the result to your webhook. Both the initial attempt and the retry failed.`)}
      ${emailDetailPanel([
        { label: "Webhook URL", value: safeUrl, mono: true },
        {
          label: "First attempt",
          value: firstLabel,
          color: COLORS.ACCENT_YELLOW_LIGHT,
        },
        {
          label: "Retry",
          value: retryLabel,
          color: COLORS.ACCENT_YELLOW_LIGHT,
        },
      ])}
      ${emailNote(
        "The webhook is still active, so future scans will keep trying to deliver to it. Check that your endpoint is reachable and returns a 2xx status, or pause it until it's fixed.",
        COLORS.ACCENT_YELLOW_LIGHT,
      )}
      ${emailButton(details.manageUrl, "Manage webhooks")}
    `,
  };
}

// Scheduled scan emails
export function scheduleCreatedEmail(
  url: string,
  frequency: string,
  details: SecurityAlertDetails,
) {
  const safeUrl = escapeHtml(url);
  const safeFrequency = escapeHtml(frequency);
  const frequencyLabel =
    safeFrequency.charAt(0).toUpperCase() + safeFrequency.slice(1);
  return {
    subject: `Scheduled scan created - ${APP_NAME}`,
    text: `A new recurring scan of ${url} was just added to your ${APP_NAME} account, running ${frequency}.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you didn't set this up, delete it from your profile.`,
    html: `
      ${emailHeading("Scheduled scan created")}
      ${emailLead(`A new recurring scan was just added to your ${APP_NAME} account.`)}
      ${emailDetailPanel([
        {
          label: "Target",
          value: safeUrl,
          mono: true,
          color: COLORS.ACCENT_BLUE_LIGHT,
        },
        { label: "Frequency", value: frequencyLabel },
      ])}
      ${securityDetailsBlock(details)}
      ${emailNote(
        "If you didn't set this up, delete it from your profile.",
        COLORS.ACCENT_YELLOW_LIGHT,
      )}
    `,
  };
}

export function scheduleDeletedEmail(
  url: string,
  details: SecurityAlertDetails,
) {
  const safeUrl = escapeHtml(url);
  return {
    subject: `Scheduled scan deleted - ${APP_NAME}`,
    text: `The recurring scan of ${url} was just removed from your ${APP_NAME} account.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}`,
    html: `
      ${emailHeading("Scheduled scan deleted")}
      ${emailLead(`A recurring scan was just removed from your ${APP_NAME} account.`)}
      ${emailDetailPanel([
        {
          label: "Target",
          value: safeUrl,
          mono: true,
          color: COLORS.ACCENT_BLUE_LIGHT,
        },
        { label: "Status", value: "Deleted", color: COLORS.ACCENT_RED_LIGHT },
      ])}
      ${securityDetailsBlock(details)}
    `,
  };
}

/**
 * Sent by the scheduled-scans worker (lib/scanner/scheduled-scans-worker.ts)
 * when it disables a schedule because its target now fails the SSRF /
 * safe-target check (validateScanTarget) -- e.g. DNS now resolves to a
 * private IP, or the host is otherwise blocked. Unlike a transient scan
 * failure (network blip, timeout), this condition won't clear on its own
 * next run, so the schedule stops firing silently otherwise. No
 * `SecurityAlertDetails` (IP/device) here: there is no request to attribute
 * this to, it was raised by the background worker.
 */
export function scheduleDisabledEmail(url: string, reason: string) {
  const safeUrl = escapeHtml(url);
  const safeReason = escapeHtml(reason);
  return {
    subject: `Scheduled scan disabled - ${APP_NAME}`,
    text: `Your recurring scan of ${url} was turned off because the target no longer passes our safety check: ${reason}\n\nNo more automatic scans will run for this schedule. Remove it from your profile, or re-add it once the target passes the safety check again.`,
    html: `
      ${emailHeading("Scheduled scan disabled")}
      ${emailLead("A recurring scan was turned off because its target stopped passing our safety check.")}
      ${emailDetailPanel([
        {
          label: "Target",
          value: safeUrl,
          mono: true,
          color: COLORS.ACCENT_BLUE_LIGHT,
        },
        { label: "Reason", value: safeReason, color: COLORS.ACCENT_RED_LIGHT },
      ])}
      ${emailParagraph(
        "No more automatic scans will run for this schedule. Remove it from your profile, or re-add it once the target passes the safety check again.",
      )}
    `,
  };
}

// Data request emails
export function dataRequestCreatedEmail(
  requestType: string,
  details: SecurityAlertDetails,
) {
  const typeLabel =
    requestType === "export" ? "Data Export" : "Account Deletion";
  return {
    subject: `${typeLabel} request received - ${APP_NAME}`,
    text: `Your ${typeLabel.toLowerCase()} request for your ${APP_NAME} account has been received and is queued for review.\n\nWe'll process this within 30 days, as required by GDPR and similar privacy rules. You'll get another email when it's done.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you didn't make this request, contact support right away.`,
    html: `
      ${emailHeading(`${typeLabel} request received`)}
      ${emailLead(`Your ${typeLabel.toLowerCase()} request has been received and is queued for review.`)}
      ${emailDetailPanel([
        { label: "Request type", value: typeLabel },
        {
          label: "Status",
          value: "Pending review",
          color: COLORS.ACCENT_YELLOW_LIGHT,
        },
      ])}
      ${emailParagraph(
        "We'll process this within 30 days, as required by GDPR and similar privacy rules. You'll get another email when it's done.",
      )}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

// Security notification emails
export function newLoginEmail(
  location: string,
  ipAddress: string,
  details: SecurityAlertDetails,
) {
  return {
    subject: `New sign-in to your ${APP_NAME} account`,
    text: `Your ${APP_NAME} account was just accessed.\n\nLocation: ${location}\nIP address: ${ipAddress}\nDevice: ${details.userAgent}\n\nIf that was you, there's nothing to do. If it wasn't, change your password and review your active sessions right away.`,
    html: `
      ${emailHeading("New sign-in to your account")}
      ${emailLead(`Your ${APP_NAME} account was just accessed. If that was you, there's nothing to do.`)}
      ${emailDetailPanel([
        { label: "Location", value: escapeHtml(location) },
        { label: "IP address", value: escapeHtml(ipAddress), mono: true },
        { label: "Device", value: escapeHtml(details.userAgent) },
      ])}
      ${securityWarningBlock()}
    `,
  };
}

export function failedLoginAttemptsEmail(
  attempts: number,
  ipAddress: string,
  details: SecurityAlertDetails,
) {
  return {
    subject: `Failed sign-in attempts on your ${APP_NAME} account`,
    text: `We blocked ${attempts} failed sign-in attempts on your ${APP_NAME} account in a short window. Your account is protected for now.\n\nFailed attempts: ${attempts}\nIP address: ${ipAddress}\nDevice: ${details.userAgent}\n\nIf that was you, no action is needed. If not, change your password and turn on two-factor authentication now.`,
    html: `
      ${emailHeading("Repeated failed sign-in attempts")}
      ${emailLead(`We blocked ${attempts} failed sign-in attempts on your ${APP_NAME} account in a short window. Your account is protected for now.`)}
      ${emailDetailPanel([
        { label: "Failed attempts", value: String(attempts) },
        { label: "IP address", value: escapeHtml(ipAddress), mono: true },
        { label: "Device", value: escapeHtml(details.userAgent) },
      ])}
      ${emailNote(
        "If that was you, no action is needed. If not, change your password and turn on two-factor authentication now.",
        COLORS.ACCENT_RED_LIGHT,
      )}
    `,
  };
}

export function rateLimitedEmail(
  ipAddress: string,
  _details: SecurityAlertDetails,
) {
  return {
    subject: `Your ${APP_NAME} API key was rate limited`,
    text: `Your ${APP_NAME} API key hit its request limit and is temporarily throttled. Requests will start going through again once the window resets.\n\nIP address: ${ipAddress}\nStatus: Rate limited\n\nThe limit is tied to your plan and resets within 24 hours. If you're hitting it often, spread requests out or upgrade for more headroom.`,
    html: `
      ${emailHeading("Your API key was rate limited")}
      ${emailLead(`Your ${APP_NAME} API key hit its request limit and is temporarily throttled. Requests will start going through again once the window resets.`)}
      ${emailDetailPanel([
        { label: "IP address", value: escapeHtml(ipAddress), mono: true },
        {
          label: "Status",
          value: "Rate limited",
          color: COLORS.ACCENT_YELLOW_LIGHT,
        },
      ])}
      ${emailNote(
        "The limit is tied to your plan and resets within 24 hours. If you're hitting it often, spread requests out or upgrade for more headroom.",
      )}
    `,
  };
}

export function apiKeyRotationEmail(
  keyName: string,
  newKeyCreatedAt: string,
  details: SecurityAlertDetails,
) {
  return {
    subject: `An API key was rotated on your ${APP_NAME} account`,
    text: `An API key on your ${APP_NAME} account was just rotated. The old key stops working and a new one takes its place.\n\nKey name: ${keyName}\nNew key created: ${newKeyCreatedAt}\nIP address: ${details.ipAddress}\n\nIf you didn't rotate this key, revoke it from your API settings and email ${SUPPORT_EMAIL}.`,
    html: `
      ${emailHeading("An API key was rotated")}
      ${emailLead(`An API key on your ${APP_NAME} account was just rotated. The old key stops working and a new one takes its place.`)}
      ${emailDetailPanel([
        { label: "Key name", value: escapeHtml(keyName) },
        { label: "New key created", value: escapeHtml(newKeyCreatedAt) },
        {
          label: "IP address",
          value: escapeHtml(details.ipAddress),
          mono: true,
        },
      ])}
      ${emailNote(
        `If you didn't rotate this key, revoke it from your API settings and email <a href="mailto:${SUPPORT_EMAIL}" style="color: ${COLORS.ACCENT_YELLOW_LIGHT}; text-decoration: underline;">${SUPPORT_EMAIL}</a>.`,
        COLORS.ACCENT_YELLOW_LIGHT,
      )}
    `,
  };
}

export function email2FACodeEmail(code: string) {
  return {
    subject: `${code} is your ${APP_NAME} sign-in code`,
    text: `Your ${APP_NAME} sign-in code is ${code}. It expires in 10 minutes.\n\nDon't share this code with anyone. ${APP_NAME} will never ask you for it. If you didn't try to sign in, change your password.`,
    html: `
      ${emailHeading("Your sign-in code")}
      ${emailLead("Enter this code to finish signing in.")}
      ${emailCodeBlock(code)}
      ${emailNote(
        `The code expires in 10 minutes. Don't share it with anyone; ${APP_NAME} will never ask you for it. If you didn't try to sign in, change your password.`,
        COLORS.ACCENT_YELLOW_LIGHT,
      )}
    `,
  };
}

export function billingVerificationCodeEmail(code: string) {
  return {
    subject: `${code} is your ${APP_NAME} billing access code`,
    text: `Your ${APP_NAME} billing access code is ${code}. It expires in 5 minutes.\n\nYou'll need a fresh code each time you open billing. Don't share it with anyone. We ask for this so payment details stay locked even if someone reaches your account, since only your email can unlock them.\n\nIf you didn't request this, secure your account.`,
    html: `
      ${emailHeading("Billing access code")}
      ${emailLead("Enter this code to view your billing details.")}
      ${emailCodeBlock(code)}
      ${emailNote(
        "The code expires in 5 minutes, and you'll need a fresh one each time you open billing. Don't share it with anyone.",
        COLORS.ACCENT_YELLOW_LIGHT,
      )}
      ${emailParagraph(
        "We ask for this so payment details stay locked even if someone reaches your account, since only your email can unlock them.",
      )}
    `,
  };
}

export function email2FAEnabledEmail(details: SecurityAlertDetails) {
  return {
    subject: `Email two-factor authentication is on for your ${APP_NAME} account`,
    text: `Email-based two-factor authentication was just turned on for your ${APP_NAME} account. You'll get a verification code by email each time you sign in.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, change your password and review your active sessions right away.`,
    html: `
      ${emailHeading("Email two-factor authentication is on")}
      ${emailLead(`Email-based two-factor authentication was just turned on for your ${APP_NAME} account. You'll get a verification code by email each time you sign in.`)}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

export function email2FADisabledEmail(details: SecurityAlertDetails) {
  return {
    subject: `Email two-factor authentication is off for your ${APP_NAME} account`,
    text: `Email-based two-factor authentication was just turned off for your ${APP_NAME} account. Signing in no longer sends a verification code by email.\n\nTwo-factor authentication makes a stolen password much harder to use. You can turn it back on anytime in your security settings.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, change your password and review your active sessions right away.`,
    html: `
      ${emailHeading("Email two-factor authentication is off")}
      ${emailLead(`Email-based two-factor authentication was just turned off for your ${APP_NAME} account. Signing in no longer sends a verification code by email.`)}
      ${emailNote(
        "Two-factor authentication makes a stolen password much harder to use. You can turn it back on anytime in your security settings.",
        COLORS.ACCENT_YELLOW_LIGHT,
      )}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

// Admin notification to user (manual message)
export interface AdminNotificationInput {
  userName: string;
  adminName: string;
  title: string;
  message: string;
  type?: "info" | "warning" | "success" | "alert";
  timestamp: Date;
}

export function adminNotificationEmail(input: AdminNotificationInput) {
  const userName = escapeHtml(input.userName);
  const adminName = escapeHtml(input.adminName);
  const title = escapeHtml(input.title);
  const message = escapeHtml(input.message).replace(/\n/g, "<br>");
  const timestamp = input.timestamp.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // The message type only sets an accent colour now (the old map carried an
  // emoji icon and a filled banner; both are gone). The accent rides on the
  // message note, so info/warning/success/alert read differently without a
  // decorative icon.
  const typeAccent: Record<
    NonNullable<AdminNotificationInput["type"]>,
    string
  > = {
    info: COLORS.ACCENT_BLUE_LIGHT,
    warning: COLORS.ACCENT_YELLOW_LIGHT,
    success: COLORS.ACCENT_GREEN_LIGHT,
    alert: COLORS.ACCENT_RED_LIGHT,
  };
  const accent = typeAccent[input.type ?? "info"];

  return {
    subject: `${title} - ${APP_NAME}`,
    text: `Hi ${input.userName},\n\n${input.title}\n\n${input.message}\n\nFrom: ${input.adminName} (${APP_NAME} team)\nSent: ${timestamp}\n\nIf anything here needs clarifying, reach the team at ${SUPPORT_EMAIL}.`,
    html: `
      ${emailHeading(title)}
      ${emailLead(`Hi ${userName}, a message from the ${APP_NAME} team.`)}
      ${emailNote(message, accent)}
      ${emailDetailPanel([
        { label: "From", value: `${adminName} (${APP_NAME} team)` },
        { label: "Sent", value: escapeHtml(timestamp) },
      ])}
      ${emailParagraph(
        `If anything here needs clarifying, reach the team at <a href="mailto:${SUPPORT_EMAIL}" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">${SUPPORT_EMAIL}</a>.`,
      )}
    `,
  };
}

// Admin account change notification
export interface ScanCompleteSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
}

export function scanCompleteEmail(
  url: string,
  summary: ScanCompleteSummary,
  duration: number,
  scanHistoryId?: number,
) {
  const safeUrl = escapeHtml(url);
  const durationSecs = (duration / 1000).toFixed(1);
  const viewLink = scanHistoryId
    ? `${APP_URL}/history/${scanHistoryId}`
    : `${APP_URL}/history`;
  const issueWord = summary.total === 1 ? "issue" : "issues";

  const chip = (label: string, count: number, color: string) =>
    count > 0
      ? `<td style="padding: 0 6px 6px 0;"><span style="display: inline-block; padding: 5px 11px; border: 1px solid ${color}; border-radius: 999px; font-size: 12px; font-weight: 600; color: ${color}; white-space: nowrap;">${count} ${label}</span></td>`
      : "";

  const chips = [
    chip("critical", summary.critical, BRAND.severity.critical),
    chip("high", summary.high, BRAND.severity.high),
    chip("medium", summary.medium, BRAND.severity.medium),
    chip("low", summary.low, BRAND.severity.low),
    chip("info", summary.info, BRAND.severity.info),
  ].join("");
  const chipRow = chips
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 22px 0;"><tr>${chips}</tr></table>`
    : "";

  const lead =
    summary.total === 0
      ? `We finished scanning your target in ${durationSecs}s and found nothing to flag.`
      : `We finished scanning your target in ${durationSecs}s and found ${summary.total} ${issueWord}.`;

  const priority = summary.critical + summary.high;
  const priorityNote =
    priority > 0
      ? emailNote(
          `${summary.critical} critical and ${summary.high} high severity ${priority === 1 ? "finding is" : "findings are"} in this report. Start with those.`,
          COLORS.ACCENT_RED_LIGHT,
        )
      : "";

  return {
    subject: `Scan complete: ${summary.total} ${issueWord} found - ${APP_NAME}`,
    text: `Your scan of ${url} finished in ${durationSecs}s.\n\nFindings:\n- Critical: ${summary.critical}\n- High: ${summary.high}\n- Medium: ${summary.medium}\n- Low: ${summary.low}\n- Info: ${summary.info}\nTotal: ${summary.total}\n\nView the full report: ${viewLink}`,
    html: `
      ${emailHeading("Scan complete")}
      ${emailLead(lead)}
      ${chipRow}
      ${emailDetailPanel([
        {
          label: "Target",
          value: safeUrl,
          mono: true,
          color: COLORS.ACCENT_BLUE_LIGHT,
        },
        { label: "Findings", value: `${summary.total} ${issueWord}` },
        { label: "Scan time", value: `${durationSecs}s` },
      ])}
      ${priorityNote}
      ${emailButton(viewLink, "View full report")}
    `,
  };
}

/** Minimal shape the critical-findings alert needs from a finding -- kept
 *  decoupled from lib/scanner/types.ts's full Vulnerability so this module
 *  doesn't have to import the scanner domain. */
export interface CriticalFindingSummary {
  title: string;
  severity: string;
}

function findingListItems(items: CriticalFindingSummary[]): string {
  return items
    .map((f) => {
      const isCritical = f.severity === "critical";
      return `<li style="margin: 0 0 6px 0;"><span style="display: inline-block; min-width: 52px; font-size: 10px; text-transform: uppercase; font-weight: 700; color: ${isCritical ? COLORS.ACCENT_RED_LIGHT : COLORS.ACCENT_YELLOW_LIGHT};">${escapeHtml(f.severity)}</span> ${escapeHtml(f.title)}</li>`;
    })
    .join("");
}

function findingListText(items: CriticalFindingSummary[]): string {
  return items.map((f) => `  - [${f.severity}] ${f.title}`).join("\n");
}

/**
 * The critical/high regression alert -- sent by execute-scan.ts /
 * execute-crawl-scan.ts only when lib/scanner/regression-alert.ts's
 * checkForNewCriticalOrHighFindings finds at least one genuinely new,
 * non-suppressed critical/high finding since the previous scan of the same
 * URL. `newFindings` are what triggered this email; `outstandingFindings`
 * are critical/high findings still present from before (also excluding
 * anything marked false_positive) -- shown for context so the email
 * distinguishes "this just appeared" from "this was already known about."
 */
export function criticalFindingsEmail(
  url: string,
  newFindings: CriticalFindingSummary[],
  outstandingFindings: CriticalFindingSummary[],
  scanHistoryId?: number,
) {
  const safeUrl = escapeHtml(url);
  const viewLink = scanHistoryId
    ? `${APP_URL}/history/${scanHistoryId}`
    : `${APP_URL}/history`;

  const newCritical = newFindings.filter(
    (f) => f.severity === "critical",
  ).length;
  const newHigh = newFindings.filter((f) => f.severity === "high").length;
  const newWord = newFindings.length === 1 ? "finding" : "findings";

  const listBlock = (label: string, items: CriticalFindingSummary[]) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin: 0 0 16px 0;">
        <tr><td>
          <p style="margin: 0 0 10px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">${label}</p>
          <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.7;">${findingListItems(items)}</ul>
        </td></tr>
      </table>`;

  return {
    subject: `${newFindings.length} new critical/high severity issue${newFindings.length !== 1 ? "s" : ""} found - ${APP_NAME}`,
    text: `New critical/high findings on your latest scan.\n\nURL: ${url}\n\nNew since your last scan (${newFindings.length}):\n${findingListText(newFindings)}\n${
      outstandingFindings.length > 0
        ? `\nStill outstanding from before (${outstandingFindings.length}):\n${findingListText(outstandingFindings)}\n`
        : ""
    }\nThese pose real risk. Review and fix them as soon as you can. View the report: ${viewLink}`,
    html: `
      ${emailHeading("New critical and high findings")}
      ${emailLead(`Your latest scan of this target turned up ${newFindings.length} new critical or high severity ${newWord} since last time. These are worth looking at now.`)}
      ${severityChipRow({ critical: newCritical, high: newHigh })}
      ${emailDetailPanel([
        {
          label: "Target",
          value: safeUrl,
          mono: true,
          color: COLORS.ACCENT_BLUE_LIGHT,
        },
      ])}
      ${listBlock("New since your last scan", newFindings)}
      ${
        outstandingFindings.length > 0
          ? listBlock(
              `Still outstanding (${outstandingFindings.length})`,
              outstandingFindings,
            )
          : ""
      }
      ${emailNote(
        "These pose real risk. Review and fix them as soon as you can.",
        COLORS.ACCENT_RED_LIGHT,
      )}
      ${emailButton(viewLink, "View the report", COLORS.ACCENT_RED)}
    `,
  };
}

export function scheduledScanCompleteEmail(
  scheduleName: string,
  url: string,
  summary: ScanCompleteSummary,
  duration: number,
  scanHistoryId?: number,
) {
  const safeName = escapeHtml(scheduleName);
  const safeUrl = escapeHtml(url);
  const durationSecs = (duration / 1000).toFixed(1);
  const viewLink = scanHistoryId
    ? `${APP_URL}/history/${scanHistoryId}`
    : `${APP_URL}/history`;
  const issueWord = summary.total === 1 ? "issue" : "issues";

  const lead =
    summary.total === 0
      ? `Your scheduled scan "${safeName}" finished in ${durationSecs}s and found nothing to flag.`
      : `Your scheduled scan "${safeName}" finished in ${durationSecs}s and found ${summary.total} ${issueWord}.`;

  const priority = summary.critical + summary.high;
  const priorityNote =
    priority > 0
      ? emailNote(
          `${summary.critical} critical and ${summary.high} high severity ${priority === 1 ? "finding is" : "findings are"} in this report. Start with those.`,
          COLORS.ACCENT_RED_LIGHT,
        )
      : "";

  return {
    subject: `Scheduled scan "${scheduleName}" complete - ${APP_NAME}`,
    text: `Your scheduled scan "${scheduleName}" finished in ${durationSecs}s.\n\nURL: ${url}\nFindings:\n- Critical: ${summary.critical}\n- High: ${summary.high}\n- Medium: ${summary.medium}\n- Low: ${summary.low}\n- Info: ${summary.info}\nTotal: ${summary.total}\n\nView the full report: ${viewLink}`,
    html: `
      ${emailHeading("Scheduled scan complete")}
      ${emailLead(lead)}
      ${severityChipRow(summary)}
      ${emailDetailPanel([
        { label: "Schedule", value: safeName },
        {
          label: "Target",
          value: safeUrl,
          mono: true,
          color: COLORS.ACCENT_BLUE_LIGHT,
        },
        { label: "Findings", value: `${summary.total} ${issueWord}` },
        { label: "Scan time", value: `${durationSecs}s` },
      ])}
      ${priorityNote}
      ${emailButton(viewLink, "View full report")}
    `,
  };
}

export interface PostureDigestFinding {
  title: string;
  severity: string;
  url: string;
}

export interface PostureDigestData {
  /** Distinct sites (URLs) this user has ever completed a scan of. */
  siteCount: number;
  /** New critical/high findings since the previous digest, across every
   *  site -- possibly truncated to CONFIG_POSTURE_DIGEST_MAX_FINDINGS_LISTED;
   *  see newFindingsTotal for the untruncated count. */
  newFindings: PostureDigestFinding[];
  /** Untruncated count behind `newFindings`. */
  newFindingsTotal: number;
  newCriticalCount: number;
  newHighCount: number;
  /** Total open critical+high findings right now, across every site. */
  currentOpenCount: number;
  /** Same total as of the previous digest (0 for a site with no prior
   *  baseline scan). */
  previousOpenCount: number;
  trend: "up" | "down" | "flat";
  /** Digest cadence in days -- only used to pick "week" vs "month" copy. */
  windowDays: number;
}

function postureFindingListItems(items: PostureDigestFinding[]): string {
  return items
    .map((f) => {
      const isCritical = f.severity === "critical";
      return `<li style="margin: 0 0 8px 0;"><span style="display: inline-block; min-width: 52px; font-size: 10px; text-transform: uppercase; font-weight: 700; color: ${isCritical ? COLORS.ACCENT_RED_LIGHT : COLORS.ACCENT_YELLOW_LIGHT};">${escapeHtml(f.severity)}</span> ${escapeHtml(f.title)} <span style="color: ${COLORS.TEXT_MUTED}; font-size: 11px;">- ${escapeHtml(f.url)}</span></li>`;
    })
    .join("");
}

function postureFindingListText(items: PostureDigestFinding[]): string {
  return items
    .map((f) => `  - [${f.severity}] ${f.title} (${f.url})`)
    .join("\n");
}

/**
 * Weekly/monthly posture digest -- the periodic cross-site summary email
 * (AUDIT-010: "no periodic posture digest email, only per-scan/per-event
 * notifications exist"). Distinct from scanCompleteEmail (one scan) and
 * criticalFindingsEmail (one scan's regression alert): this aggregates
 * across every site the user has ever scanned, comparing each site's
 * latest completed scan against what it looked like as of the previous
 * digest. See lib/notifications/posture-digest.ts for how `data` is built.
 */
export function postureDigestEmail(data: PostureDigestData) {
  const {
    siteCount,
    newFindings,
    newFindingsTotal,
    newCriticalCount,
    newHighCount,
    currentOpenCount,
    previousOpenCount,
    trend,
    windowDays,
  } = data;

  const periodLabel = windowDays >= 28 ? "month" : "week";
  const siteLabel = `${siteCount} site${siteCount !== 1 ? "s" : ""}`;

  const subject =
    newFindingsTotal > 0
      ? `Posture digest: ${newFindingsTotal} new critical/high finding${newFindingsTotal !== 1 ? "s" : ""} across ${siteLabel} - ${APP_NAME}`
      : `Posture digest: ${siteLabel} monitored, nothing new this ${periodLabel} - ${APP_NAME}`;

  const trendCopy = {
    up: {
      color: COLORS.ACCENT_RED_LIGHT,
      label: "Open critical/high findings increased",
    },
    down: {
      color: COLORS.ACCENT_GREEN_LIGHT,
      label: "Open critical/high findings decreased",
    },
    flat: {
      color: COLORS.TEXT_SECONDARY,
      label: "Open critical/high findings unchanged",
    },
  }[trend];

  const findingsLabel = `New since your last digest${newFindingsTotal > newFindings.length ? ` (showing ${newFindings.length} of ${newFindingsTotal})` : ""}`;

  const text = `Your ${periodLabel}ly posture digest across ${siteLabel}.\n\nNew critical/high findings since your last digest: ${newFindingsTotal}\n${
    newFindings.length > 0 ? `\n${postureFindingListText(newFindings)}\n` : ""
  }\n${trendCopy.label}: ${previousOpenCount} -> ${currentOpenCount} open critical/high findings.\n\nView your scan history: ${APP_URL}/history`;

  const findingsBlock =
    newFindings.length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin: 0 0 22px 0;">
        <tr><td>
          <p style="margin: 0 0 10px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">${findingsLabel}</p>
          <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: ${COLORS.TEXT_SECONDARY}; line-height: 1.8;">${postureFindingListItems(newFindings)}</ul>
        </td></tr>
      </table>`
      : emailNote(
          "No new critical or high severity findings since your last digest.",
          COLORS.ACCENT_GREEN_LIGHT,
        );

  const html = `
      ${emailHeading("Your posture digest")}
      ${emailLead(`Across ${siteLabel} you've scanned with ${APP_NAME}, here's what changed since your last digest.`)}
      ${severityChipRow({ critical: newCriticalCount, high: newHighCount })}
      ${emailDetailPanel([
        { label: "Sites monitored", value: `${siteCount}` },
        {
          label: "New critical/high",
          value: `${newFindingsTotal}`,
          color:
            newFindingsTotal > 0
              ? COLORS.ACCENT_RED_LIGHT
              : COLORS.TEXT_PRIMARY,
        },
        {
          label: "Open now",
          value: `${currentOpenCount}`,
          color: trendCopy.color,
        },
      ])}
      ${emailNote(`${trendCopy.label}: ${previousOpenCount} to ${currentOpenCount} since your last digest.`, trendCopy.color)}
      ${findingsBlock}
      ${emailButton(`${APP_URL}/history`, "View scan history")}
    `;

  return { subject, text, html };
}

export interface AdminChangeNotification {
  userName: string;
  adminName: string;
  changes: { field: string; oldValue: string; newValue: string }[];
  timestamp: Date;
}

export function adminAccountChangeEmail(input: AdminChangeNotification) {
  const userName = escapeHtml(input.userName);
  const adminName = escapeHtml(input.adminName);
  const timestamp = input.timestamp.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const changesHtml = input.changes
    .map(
      (c) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid ${COLORS.BORDER_SECTION}; color: ${COLORS.TEXT_SECONDARY}; font-size: 13px; width: 120px;">${escapeHtml(c.field)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid ${COLORS.BORDER_SECTION};">
          <span style="display: inline-block; padding: 3px 8px; background-color: ${COLORS.BG_DANGER}; border-radius: 4px; font-size: 12px; color: ${COLORS.ACCENT_RED_LIGHT}; text-decoration: line-through; margin-right: 8px;">${escapeHtml(c.oldValue || "(empty)")}</span>
          <span style="color: ${COLORS.TEXT_MUTED};">→</span>
          <span style="display: inline-block; padding: 3px 8px; background-color: ${COLORS.BG_SUCCESS}; border-radius: 4px; font-size: 12px; color: ${COLORS.ACCENT_GREEN_LIGHT}; margin-left: 8px;">${escapeHtml(c.newValue || "(empty)")}</span>
        </td>
      </tr>
    `,
    )
    .join("");

  const changesText = input.changes
    .map(
      (c) =>
        `  - ${c.field}: "${c.oldValue || "(empty)"}" → "${c.newValue || "(empty)"}"`,
    )
    .join("\n");

  return {
    subject: `An administrator updated your account - ${APP_NAME}`,
    text: `Hi ${input.userName},\n\nAn administrator (${input.adminName}) changed some details on your ${APP_NAME} account.\n\nChanges:\n${changesText}\n\nWhen: ${timestamp}\n\nIf any of this looks wrong, reach the team at ${SUPPORT_EMAIL}.`,
    html: `
      ${emailHeading("Your account was updated")}
      ${emailLead(`Hi ${userName}, an administrator changed some details on your ${APP_NAME} account.`)}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${COLORS.BG_SECTION}; border-radius: 8px; padding: 16px; margin: 0 0 22px 0;">
        <tr><td>
          <p style="margin: 0 0 6px 0; font-size: 12px; color: ${COLORS.TEXT_MUTED};">Changes</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
            ${changesHtml}
          </table>
        </td></tr>
      </table>

      ${emailDetailPanel([
        { label: "Changed by", value: adminName },
        { label: "When", value: escapeHtml(timestamp) },
      ])}
      ${emailParagraph(
        `If any of this looks wrong, reach the team at <a href="mailto:${SUPPORT_EMAIL}" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">${SUPPORT_EMAIL}</a>.`,
      )}
    `,
  };
}

// Billing / receipt emails. These are transactional: they're the record of a
// real charge, refund, or plan change on the account, so they send through
// sendEmail directly (see app/api/v3/webhooks/stripe/route.ts) rather than the
// preference-gated sendNotificationEmail path -- a paying customer can't opt
// out of a receipt.

// Renders a Stripe minor-unit amount (cents) in its currency. Stripe hands us
// the currency lowercase ("usd"); Intl.NumberFormat wants it uppercase.
function formatMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    // An unknown/non-ISO currency code would make NumberFormat throw; fall
    // back to a plain amount + code rather than lose the receipt entirely.
    return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function paymentReceiptEmail(input: {
  planName: string;
  amountCents: number;
  currency: string;
  date: string;
  invoiceUrl?: string | null;
}) {
  const safePlan = escapeHtml(input.planName);
  const amount = formatMoney(input.amountCents, input.currency);
  const manageUrl = `${APP_URL}/profile?tab=billing`;
  const hasInvoice =
    !!input.invoiceUrl && /^https?:\/\//i.test(input.invoiceUrl);

  return {
    subject: `Your ${APP_NAME} payment receipt`,
    text: `Thanks, your payment went through.\n\nPlan: ${input.planName}\nAmount: ${amount}\nDate: ${input.date}\n${
      hasInvoice ? `\nDownload your invoice: ${input.invoiceUrl}\n` : ""
    }\nManage your subscription or update your card: ${manageUrl}`,
    html: `
      ${emailHeading("Payment received")}
      ${emailLead(`Thanks, your ${amount} payment for ${safePlan} went through. Here's your receipt.`)}
      ${emailDetailPanel([
        { label: "Plan", value: safePlan },
        { label: "Amount", value: amount, color: COLORS.ACCENT_GREEN_TEXT },
        { label: "Date", value: escapeHtml(input.date) },
      ])}
      ${
        hasInvoice
          ? emailButton(input.invoiceUrl!, "Download invoice")
          : emailButton(manageUrl, "Manage subscription")
      }
      ${emailParagraph(
        `Manage your subscription or update your card anytime from your <a href="${manageUrl}" style="color: ${COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">billing settings</a>.`,
      )}
    `,
  };
}

export function paymentFailedEmail(input: {
  planName: string;
  amountCents: number;
  currency: string;
  nextAttempt?: string | null;
}) {
  const safePlan = escapeHtml(input.planName);
  const amount = formatMoney(input.amountCents, input.currency);
  const updateUrl = `${APP_URL}/profile?tab=billing`;
  const retryLine = input.nextAttempt
    ? `We'll try the card again on ${escapeHtml(input.nextAttempt)}. Update it before then to avoid losing access.`
    : "We'll retry the card automatically over the next few days. Update it to avoid losing access.";

  const rows: EmailDetailRow[] = [
    { label: "Plan", value: safePlan },
    { label: "Amount due", value: amount, color: COLORS.ACCENT_RED_LIGHT },
  ];
  if (input.nextAttempt) {
    rows.push({ label: "Next retry", value: escapeHtml(input.nextAttempt) });
  }

  return {
    subject: `${APP_NAME} couldn't process your payment`,
    text: `We couldn't charge your card ${amount} for your ${input.planName} subscription.\n${
      input.nextAttempt ? `\nNext retry: ${input.nextAttempt}\n` : ""
    }\nUpdate your payment method: ${updateUrl}\n\nYour plan stays active for now, but repeated failures will drop the account to free.`,
    html: `
      ${emailHeading("Your payment didn't go through")}
      ${emailLead(`We couldn't charge your card ${amount} for your ${safePlan} subscription.`)}
      ${emailDetailPanel(rows)}
      ${emailNote(retryLine, COLORS.ACCENT_YELLOW_LIGHT)}
      ${emailButton(updateUrl, "Update payment method")}
    `,
  };
}

export type SubscriptionChangeKind =
  "upgraded" | "downgraded" | "canceled" | "renewed";

// One builder for every subscription lifecycle change, parameterized by kind.
// The Stripe webhook (customer.subscription.created/updated/deleted) resolves
// the kind from the old and new plan prices and calls this once.
export function subscriptionChangedEmail(input: {
  kind: SubscriptionChangeKind;
  planName: string;
  previousPlanName?: string | null;
  effectiveDate?: string | null;
}) {
  const safePlan = escapeHtml(input.planName);
  const safePrev = input.previousPlanName
    ? escapeHtml(input.previousPlanName)
    : null;
  const manageUrl = `${APP_URL}/profile?tab=billing`;
  const isPlanMove = input.kind === "upgraded" || input.kind === "downgraded";

  const copy: Record<
    SubscriptionChangeKind,
    {
      subject: string;
      heading: string;
      lead: string;
      statusLabel: string;
      statusColor: string;
      cta: string;
    }
  > = {
    upgraded: {
      subject: `You're now on ${input.planName} - ${APP_NAME}`,
      heading: "Your plan was upgraded",
      lead: `You're now on ${safePlan}. The higher limits are live on your account right away.`,
      statusLabel: "Upgraded",
      statusColor: COLORS.ACCENT_GREEN_TEXT,
      cta: "Manage subscription",
    },
    downgraded: {
      subject: `Your plan changed to ${input.planName} - ${APP_NAME}`,
      heading: "Your plan was changed",
      lead: `Your subscription is now ${safePlan}. The new limits apply from your next billing cycle.`,
      statusLabel: "Downgraded",
      statusColor: COLORS.ACCENT_YELLOW_LIGHT,
      cta: "Manage subscription",
    },
    canceled: {
      subject: `Your ${APP_NAME} subscription was canceled`,
      heading: "Your subscription was canceled",
      lead: `Your ${safePlan} subscription is canceled. You keep its features until the end of the period you already paid for, then the account drops to the free plan.`,
      statusLabel: "Canceled",
      statusColor: COLORS.ACCENT_RED_LIGHT,
      cta: "Reactivate subscription",
    },
    renewed: {
      subject: `Your ${APP_NAME} subscription renewed`,
      heading: "Your subscription renewed",
      lead: `Your ${safePlan} subscription is active for another cycle. Nothing to do.`,
      statusLabel: "Active",
      statusColor: COLORS.ACCENT_GREEN_TEXT,
      cta: "Manage subscription",
    },
  };
  const c = copy[input.kind];

  const rows: EmailDetailRow[] = [];
  if (safePrev && isPlanMove) {
    rows.push({ label: "Previous plan", value: safePrev });
  }
  rows.push({ label: "Plan", value: safePlan });
  rows.push({ label: "Status", value: c.statusLabel, color: c.statusColor });
  if (input.effectiveDate) {
    rows.push({
      label: input.kind === "canceled" ? "Access until" : "Effective",
      value: escapeHtml(input.effectiveDate),
    });
  }

  const textLines = [c.heading, ""];
  if (input.previousPlanName && isPlanMove) {
    textLines.push(`Previous plan: ${input.previousPlanName}`);
  }
  textLines.push(`Plan: ${input.planName}`);
  textLines.push(`Status: ${c.statusLabel}`);
  if (input.effectiveDate) {
    textLines.push(
      `${input.kind === "canceled" ? "Access until" : "Effective"}: ${input.effectiveDate}`,
    );
  }
  textLines.push("", `Manage your subscription: ${manageUrl}`);

  return {
    subject: c.subject,
    text: textLines.join("\n"),
    html: `
      ${emailHeading(c.heading)}
      ${emailLead(c.lead)}
      ${emailDetailPanel(rows)}
      ${emailButton(manageUrl, c.cta)}
    `,
  };
}

// Sent as the final step of a full account + data purge (self-service
// deletion). The caller captures the recipient's email BEFORE the purge runs,
// since the users row is gone by the time this sends. Transactional: it's the
// confirmation of an irreversible action, not a notification.
export function accountDeletedEmail(name?: string | null) {
  const safeName = name ? escapeHtml(name) : null;
  const greetingHtml = safeName ? `Hi ${safeName}, your` : "Your";
  const greetingText = name ? `Hi ${name}, your` : "Your";

  return {
    subject: `Your ${APP_NAME} account was deleted`,
    text: `${greetingText} ${APP_NAME} account and all of its data have been permanently deleted. Scans, schedules, API keys, and billing records are gone and can't be recovered.\n\nThis is the last email we'll send to this address. If you didn't request this deletion, email ${SUPPORT_EMAIL} right away.\n\nThanks for trying ${APP_NAME}.`,
    html: `
      ${emailHeading("Your account was deleted")}
      ${emailLead(`${greetingHtml} ${APP_NAME} account and all of its data have been permanently deleted.`)}
      ${emailParagraph(
        "Scans, schedules, API keys, and billing records are gone and can't be recovered. This is the last email we'll send to this address.",
      )}
      ${emailNote(
        `If you didn't request this deletion, email <a href="mailto:${SUPPORT_EMAIL}" style="color: ${COLORS.ACCENT_RED_LIGHT}; text-decoration: underline;">${SUPPORT_EMAIL}</a> right away.`,
        COLORS.ACCENT_RED_LIGHT,
      )}
      ${emailParagraph(`Thanks for trying ${APP_NAME}.`)}
    `,
  };
}

// Sent when a user revokes every session ("sign out everywhere"). Security
// notice, gated on the session_alerts preference.
export function sessionRevokedEmail(details: SecurityAlertDetails) {
  return {
    subject: `You were signed out of every ${APP_NAME} session`,
    text: `Every active session on your ${APP_NAME} account was just signed out. You'll need to sign in again on each device.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you didn't do this, change your password and turn on two-factor authentication right away, then email ${SUPPORT_EMAIL}.`,
    html: `
      ${emailHeading("You were signed out everywhere")}
      ${emailLead(`Every active session on your ${APP_NAME} account was just signed out. You'll need to sign in again on each device.`)}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

// Sent to a member removed from a team by someone with manage_members. Gated
// on the team_changes preference.
export function teamMemberRemovedEmail(teamName: string) {
  const safeTeam = escapeHtml(teamName);
  return {
    subject: `You were removed from ${teamName} on ${APP_NAME}`,
    text: `You were removed from the team "${teamName}" on ${APP_NAME}. You no longer have access to that team's shared scans, history, or reports. Your own account and scans are untouched.\n\nIf you think this was a mistake, reach out to the team's owner.`,
    html: `
      ${emailHeading("You were removed from a team")}
      ${emailLead(`You were removed from the team "${safeTeam}" on ${APP_NAME}.`)}
      ${emailParagraph(
        "You no longer have access to that team's shared scans, history, or reports. Your own account and scans are untouched.",
      )}
      ${emailNote("If you think this was a mistake, reach out to the team's owner.")}
    `,
  };
}

// Sent to a member whose role in a team was changed. Gated on the team_changes
// preference.
export function teamRoleChangedEmail(
  teamName: string,
  oldRole: string,
  newRole: string,
) {
  const safeTeam = escapeHtml(teamName);
  return {
    subject: `Your role in ${teamName} changed`,
    text: `Your role in the team "${teamName}" on ${APP_NAME} was changed from ${oldRole} to ${newRole}. What you can do in the team may have changed with it.\n\nView the team: ${APP_URL}/teams`,
    html: `
      ${emailHeading("Your team role changed")}
      ${emailLead(`Your role in the team "${safeTeam}" was just changed.`)}
      ${emailDetailPanel([
        { label: "Previous role", value: escapeHtml(oldRole) },
        {
          label: "New role",
          value: escapeHtml(newRole),
          color: COLORS.ACCENT_BLUE_LIGHT,
        },
      ])}
      ${emailParagraph("What you can do in the team may have changed with it.")}
      ${emailButton(`${APP_URL}/teams`, "View the team")}
    `,
  };
}
