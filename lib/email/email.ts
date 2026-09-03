import nodemailer from "nodemailer";
import {
  APP_NAME,
  APP_URL,
  SUPPORT_EMAIL,
  LOGO_URL,
  NOREPLY_EMAIL,
} from "@/lib/config/constants";
import { STAFF_INVITE_EXPIRY_DAYS } from "@/lib/config/constants";
import {
  CONFIG_BILLING_VERIFY_CODE_EXPIRY_MINUTES,
  CONFIG_EMAIL_2FA_CODE_EXPIRY_MINUTES,
  CONFIG_TEAM_INVITE_EXPIRY_DAYS,
} from "@/lib/config/config-values";
import {
  emailLayout,
  escapeHtml,
  emailHeading,
  emailLead,
  emailParagraph,
  emailStrong,
  emailLink,
  emailButton,
  emailFallbackLink,
  emailNote,
  emailDetailPanel,
  emailPanel,
  emailCodeBlock,
  emailFindingItem,
  emailFindingList,
  emailChangeRow,
  severityChipRow,
  SANS_STACK,
  type EmailAccent,
  type EmailDetailRow,
} from "@/lib/email/layout";
import { getSetting } from "@/lib/config/runtime-config";

// SMTP CREDENTIALS
//
// These used to be declared in lib/config/constants.ts, which client
// components import, so `process.env.SMTP_PASS` and its four siblings were
// compiled into the root-layout client chunk as bare expression statements
// and shipped on all 311 routes (AUDIT-012#fe-15). Nothing leaked -- Next
// only inlines NEXT_PUBLIC_* into browser code, so they all evaluated to
// undefined -- but the read sites were one careless rename away from being
// real. They live here now, next to their only consumer: this module builds
// the nodemailer transport, so it can never end up in a client bundle, and
// there is no config module in between to carry them somewhere it could.
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
// Most providers reject a From that is not the authenticated mailbox, so an
// unset SMTP_FROM falls back to the login.
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

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

/**
 * Whether this deployment can send email at all.
 *
 * Callers use this to decide whether an email-dependent REQUIREMENT is
 * enforceable. Email verification is the important one: it exists to prove
 * control of an address by sending to it, so on an instance that cannot send,
 * enforcing it is not a weaker security posture, it is a lockout with no
 * escape. A self-hoster could sign up and then never log in, and the
 * troubleshooting steps for it needed a session they could not obtain.
 */
export function isEmailConfigured(): boolean {
  return transporter !== null;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  skipLayout?: boolean;
  unsubscribeToken?: string;
  /**
   * Inbox preview line, shown after the subject by every mail client. Leave
   * it unset and it is derived from the first sentence of `text`, which is
   * better than the alternative: without one, the preview is whatever visible
   * text the body starts with, which for this layout is the wordmark.
   */
  preheader?: string;
}

interface SecurityAlertDetails {
  ipAddress: string;
  userAgent: string;
}

interface LayoutOptions {
  unsubscribeToken?: string;
  preheader?: string;
  /** The subject, which becomes the document title. */
  title?: string;
}

// escapeHtml used to be a private copy here, byte-identical to the one in
// lib/email/layout.ts and to a third in the admin preview. The layout module
// is the one both the mail sender and the admin preview already import, so it
// owns the escaper too: three copies of "escape these five characters" is
// three places to miss when a sixth one matters.

/**
 * Build the one-click unsubscribe URL for a token.
 *
 * Two different URLs are involved and they are not interchangeable. This one
 * is the API route, which accepts a bodyless POST with
 * `action=unsubscribe_all` and is therefore a valid RFC 8058 endpoint; it is
 * what goes in the List-Unsubscribe header. The in-body button below points
 * at /unsubscribe instead, which is the page a human should land on.
 */
function unsubscribeApiUrl(token: string): string {
  return `${APP_URL}/api/v3/account/unsubscribe?token=${encodeURIComponent(token)}&action=unsubscribe_all`;
}

/**
 * Hidden inbox preview line.
 *
 * Gmail, Apple Mail and Outlook render the subject followed by the first
 * visible text of the body. This layout starts with the wordmark, so every
 * message previewed as "VulnRadar" plus the first words of the heading, which
 * repeats the sender name and the subject and tells the reader nothing. The
 * trailing run of figure-space + zero-width-no-break-space stops the client
 * pulling body copy in behind a short preheader.
 */
function preheaderBlock(preheader: string): string {
  const text = preheader.trim();
  if (!text) return "";
  const filler = "&#8199;&#65279;".repeat(30);
  return `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: transparent; opacity: 0;">${escapeHtml(text)}${filler}</div>`;
}

const PREHEADER_MAX_CHARS = 140;

/**
 * Fall back to the first sentence of the plain-text body when a caller has
 * not written a preheader. Sentences carrying a numeric code or an opaque
 * token are skipped rather than redacted: a 2FA mail's first sentence is
 * "Your sign-in code is 123456", and an inbox preview is exactly the surface
 * a shoulder-surfer or a lock-screen notification exposes. Links are kept,
 * since the scanned URL is useful in the preview.
 */
function derivePreheader(text: string): string {
  // A terminator only ends a sentence when whitespace or the end of the body
  // follows it, so the dots inside "example.com" and "3.1s" do not split.
  const SENTENCE = /^(.*?[.!?])(?=\s|$)/;
  let rest = text.trim().replace(/\s+/g, " ");

  while (rest) {
    const match = SENTENCE.exec(rest);
    const sentence = (match ? match[1] : rest).trim();
    if (!sentence) break;
    const carriesSecret =
      /\b\d{4,}\b/.test(sentence) || /\b[A-Za-z0-9_-]{20,}\b/.test(sentence);
    if (!carriesSecret) {
      return sentence.length > PREHEADER_MAX_CHARS
        ? sentence.slice(0, PREHEADER_MAX_CHARS - 3).trimEnd() + "..."
        : sentence;
    }
    if (!match) break;
    rest = rest.slice(match[1].length).trim();
  }
  return "";
}

/**
 * The shell markup now lives in lib/email/layout.ts, which the admin preview
 * (components/admin/shared/email-preview-html.ts) also calls. It used to be
 * duplicated by hand there and had drifted on the logo source, the mobile
 * media query, the preferences button and the support line, so what an admin
 * previewed before a broadcast was not what recipients received. This wrapper
 * keeps the server-only half: resolving the deployment's constants and turning
 * an unsubscribe token into a URL.
 */
function layout(
  content: string,
  { unsubscribeToken, preheader, title }: LayoutOptions = {},
): string {
  // Email clients don't resolve root-relative asset paths, so an absolute URL
  // is required for the logo to load at all.
  const logoSrc = /^https?:\/\//i.test(LOGO_URL)
    ? LOGO_URL
    : `${APP_URL}${LOGO_URL}`;

  return emailLayout({
    content,
    appName: APP_NAME,
    appUrl: APP_URL,
    logoSrc,
    supportEmail: SUPPORT_EMAIL,
    unsubscribeUrl: unsubscribeToken
      ? `${APP_URL}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`
      : null,
    preheaderHtml: preheaderBlock(preheader ?? ""),
    title,
  });
}

// The blocks a template is composed from -- heading, lead, button, note,
// detail panel, code block, severity chips -- live in lib/email/layout.ts
// alongside the shell, because the shell is what decides how they look in
// light mode, in dark mode, and in Word. They were private to this file, so
// the admin broadcast preview hand-rolled its own <h1> at a different weight
// than every real message used.
//
// Two things stay here, because they read deployment config and the layout
// module deliberately reads none: the session-details panel and the "if this
// wasn't you" aside, both of which name SUPPORT_EMAIL.

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
    `If this wasn't you, change your password and review your active sessions right away, then email ${supportLink()}.`,
    "warn",
  );
}

// A support-address link inside note or paragraph copy.
function supportLink(): string {
  return emailLink(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL);
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

/**
 * redactEmailPreview applied to one run of text taken from markup.
 *
 * Character references are held out of the redaction because they are not
 * content: the hidden preheader filler is thirty repetitions of
 * `&#8199;&#65279;`, and the numeric-code rule turns every one of those into
 * `&#[REDACTED CODE];`, which is a visible mangling of a part of the message
 * that carries no secret at all.
 */
function redactHtmlText(text: string): string {
  return text
    .split(/(&#?[0-9A-Za-z]+;)/)
    .map((part, i) => (i % 2 === 1 ? part : redactEmailPreview(part)))
    .join("");
}

/**
 * The HTML counterpart of redactEmailPreview, applied to the exact document
 * nodemailer is handed before it is written to email_logs.redacted_html.
 *
 * Same policy, two passes, because one blanket regex over markup destroys it:
 * a URL match that begins inside an attribute value runs straight past the
 * closing quote and eats the rest of the tag, and the numeric rule fires on
 * `width="600"` and on every `border-radius: 999px`.
 *
 * Pass 1 replaces every http(s) href with an inert placeholder, so a working
 * reset, invite or verification link is never stored. Nothing visible changes:
 * an href is not rendered, and the sandboxed frame that displays this cannot
 * navigate anywhere anyway. `mailto:` is left alone, being an address the body
 * already prints in the clear.
 *
 * Pass 2 redacts text nodes and nothing else, which is exactly where a
 * one-time code (emailCodeBlock) and a copy-paste fallback URL
 * (emailFallbackLink) are actually readable. Tags are skipped whole, so the
 * inline colours, widths and styles that every mail client depends on survive
 * and the stored copy still renders like the message that was sent.
 *
 * `src` is deliberately not touched. It carries the deployment's own logo, not
 * a secret, and whether remote images are allowed to load is a decision for
 * the viewer, which blocks them by default.
 */
export function redactEmailHtml(html: string): string {
  const hrefsRedacted = html
    .replace(/(\shref\s*=\s*)("|')https?:\/\/[^"']*\2/gi, `$1$2#redacted$2`)
    .replace(/(\shref\s*=\s*)https?:\/\/[^\s>]*/gi, `$1"#redacted"`);
  // split() on a capturing group interleaves the separators, so odd indices
  // are tags and even indices are the text between them.
  return hrefsRedacted
    .split(/(<[^>]*>)/)
    .map((part, i) => (i % 2 === 1 ? part : redactHtmlText(part)))
    .join("");
}

const EMAIL_LOG_PREVIEW_MAX_CHARS = 500;

/**
 * Above this, the rendered copy is dropped rather than truncated. Half a
 * document is not a smaller document: it renders as broken markup, and a
 * viewer showing that would be back to presenting something that is not what
 * was sent. An honest "no rendered copy was kept" is the better outcome, and
 * no template in this file comes close to the ceiling.
 */
const EMAIL_LOG_HTML_MAX_CHARS = 100_000;

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
  /** The rendered document, exactly as handed to nodemailer. */
  html: string;
  status: "sent" | "failed" | "skipped_not_configured";
  error?: string;
}): Promise<void> {
  try {
    const { default: pool } = await import("@/lib/database/db");
    const redactedHtml = redactEmailHtml(params.html);
    await pool.query(
      `INSERT INTO email_logs (recipient, subject, status, error_message, redacted_preview, redacted_html)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.to,
        params.subject,
        params.status,
        params.error ?? null,
        redactEmailPreview(params.text).slice(0, EMAIL_LOG_PREVIEW_MAX_CHARS),
        redactedHtml.length > EMAIL_LOG_HTML_MAX_CHARS ? null : redactedHtml,
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
  preheader,
}: SendEmailOptions) {
  // Built before the transporter check, not after, so the not-configured
  // branch logs the same rendered document it would have sent. On a
  // self-hosted instance with no SMTP, Admin > System > Email Logs is the only
  // place to see what a message actually looks like.
  const finalHtml = skipLayout
    ? html
    : layout(html, {
        unsubscribeToken,
        preheader: preheader ?? derivePreheader(text),
        title: subject,
      });

  // Check if SMTP is configured
  if (!transporter) {
    console.warn("SMTP not configured. Email not sent:");
    console.warn(`  To: ${to}`);
    console.warn(`  Subject: ${subject}`);
    // privacy: log only metadata (length), never the email body.
    // Email bodies can contain reset links, 2FA codes, or share
    // tokens, and they must never appear in logs even truncated.
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
        html: finalHtml,
        status: "skipped_not_configured",
      });
      return;
    }

    await logEmailAttempt({
      to,
      subject,
      text,
      html: finalHtml,
      status: "skipped_not_configured",
      error: "SMTP not configured",
    });
    throw new Error("Email service not configured");
  }

  // NOREPLY_EMAIL is registered as "From address on automated mail" and the
  // self-hosting docs tell operators to set it, but the From was built from
  // SMTP_FROM || SMTP_USER only, so the setting changed nothing and an
  // operator debugging an SPF rejection was looking at a field that was not in
  // the code path. It is honoured now, with two guards: an explicit SMTP_FROM
  // still wins, because relays like SES require an exact verified envelope
  // sender, and the setting is only used when it differs from the shipped
  // default (NOREPLY_EMAIL is that default). Without the second guard, a
  // self-hoster who never touched either field would start sending as
  // noreply@vulnradar.dev and fail their own SPF.
  const configuredNoReply = await getSetting("NOREPLY_EMAIL");
  const fromAddress =
    process.env.SMTP_FROM ||
    (configuredNoReply && configuredNoReply !== NOREPLY_EMAIL
      ? configuredNoReply
      : SMTP_FROM);
  const from = `"${APP_NAME}" <${fromAddress}>`;

  // Gmail and Yahoo's bulk sender rules want a one-click unsubscribe
  // (RFC 8058) on mail of this shape, and treat its absence as a spam signal.
  // Only mail that carries an unsubscribe token gets it: security notices
  // (password changed, 2FA, new login) are not opt-out and deliberately have
  // no token.
  const headers = unsubscribeToken
    ? {
        "List-Unsubscribe": `<${unsubscribeApiUrl(unsubscribeToken)}>, <mailto:${SUPPORT_EMAIL}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    : undefined;

  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html: finalHtml,
      replyTo,
      headers,
    });
    await logEmailAttempt({
      to,
      subject,
      text,
      html: finalHtml,
      status: "sent",
    });
  } catch (err) {
    await logEmailAttempt({
      to,
      subject,
      text,
      html: finalHtml,
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
    preheader: `${category} from ${input.name}, reply-to ${input.email}`,
    subject: `[Contact] ${input.subject}`,
    text: `New contact request via the ${APP_NAME} contact form.\n\nCategory: ${category}\nName: ${input.name}\nEmail: ${input.email}\nSubject: ${input.subject}\n\nMessage:\n${input.message}`,
    html: `
      ${emailHeading("New contact request")}
      ${emailLead(`${name} reached out through the ${APP_NAME} contact form.`)}
      ${emailDetailPanel([
        { label: "Name", value: name },
        {
          label: "Email",
          value: emailLink(`mailto:${email}`, email),
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
    preheader: `We reply to most ${input.category.toLowerCase()} requests within 24 to 48 hours.`,
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
          accent: "ok",
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
    preheader:
      "One click and the account is live. The link works for the next 24 hours.",
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

/**
 * Sent when someone posts an already-registered address to signup.
 *
 * Signup used to answer 409 for a registered address and 200 for an
 * unregistered one, which is a free account-enumeration oracle: one request
 * per address tells an attacker which of a scraped list has accounts here, and
 * for a security-tools vendor the membership list itself is the interesting
 * output. Every other auth route already refuses to leak this (login returns
 * one generic 401 for both wrong-user and wrong-password, forgot-password
 * always says "if an account exists"), so signup now returns the same 200 and
 * the real disambiguation happens here, in an inbox only the address owner can
 * read (AUDIT-012#auth-09).
 *
 * This mail must always be sent on that path. A 200 with no mail would leave a
 * real person who forgot they had an account waiting for a verification link
 * that never arrives.
 */
export function signupAttemptOnExistingAccountEmail(
  name: string,
  loginLink: string,
  resetLink: string,
) {
  const safeName = escapeHtml(name);
  const greeting = name ? `Hi ${name}, ` : "";
  const safeGreeting = safeName ? `Hi ${safeName}, ` : "";
  // Same scheme guard teamInviteEmail uses. Both links are built from APP_URL
  // here, but a template that renders an href must never assume its caller.
  const safeLoginLink = /^https?:\/\//i.test(loginLink)
    ? loginLink
    : "#invalid";
  const safeResetLink = /^https?:\/\//i.test(resetLink)
    ? resetLink
    : "#invalid";
  return {
    preheader:
      "Nothing was created and nothing changed. Sign in, or reset the password.",
    subject: `Someone tried to sign up with your ${APP_NAME} email`,
    text: `${greeting}someone just tried to create a ${APP_NAME} account with this email address. You already have one, so nothing was created and nothing changed.\n\nIf that was you, sign in instead:\n${loginLink}\n\nIf you don't remember your password, reset it:\n${resetLink}\n\nIf it wasn't you, you can ignore this email. Your account is untouched and whoever submitted the form was not told whether this address is registered.`,
    html: `
      ${emailHeading("You already have an account")}
      ${emailLead(`${safeGreeting}someone just tried to create a ${APP_NAME} account with this email address. You already have one, so nothing was created and nothing changed.`)}
      ${emailButton(safeLoginLink, "Sign in instead")}
      ${emailParagraph(
        `Forgot your password? ${emailLink(safeResetLink, "Reset it here")}.`,
      )}
      ${emailNote(
        "If it wasn't you, you can ignore this email. Your account is untouched, and whoever submitted the form was not told whether this address is registered.",
      )}
      ${emailFallbackLink(safeLoginLink)}
    `,
  };
}

export function passwordResetEmail(resetLink: string) {
  return {
    preheader:
      "The link works for one hour. Ignore this and your current password stays.",
    subject: `Reset your ${APP_NAME} password`,
    text: `Someone asked to reset the password for your ${APP_NAME} account.\n\nChoose a new password here:\n${resetLink}\n\nThe link works for one hour, then it stops working. If you didn't request this, you can ignore this email and your current password stays the same.`,
    html: `
      ${emailHeading("Reset your password")}
      ${emailLead(`Someone asked to reset the password for your ${APP_NAME} account. If that was you, set a new one below.`)}
      ${emailButton(resetLink, "Choose a new password")}
      ${emailNote(
        "The link works for one hour, then it stops working. If you didn't request this, you can ignore this email and your current password stays the same.",
        "warn",
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
    preheader: securityInfo,
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
  // TEAM_INVITE_EXPIRY_DAYS is admin-editable and the caller has already
  // resolved it for the INSERT, so the copy has to be told what the window
  // actually is: hardcoding "7 days" meant an operator who lengthened it to
  // 30 shipped mail telling recipients to discard a still-live invite. The
  // shipped default is the fallback so a caller that has not been updated
  // still matches a default install.
  expiryDays: number = CONFIG_TEAM_INVITE_EXPIRY_DAYS,
) {
  const safeTeamName = escapeHtml(teamName);
  const safeInvitedBy = escapeHtml(invitedBy);
  const safeInviteLink = /^https?:\/\//i.test(inviteLink)
    ? inviteLink
    : "#invalid";
  const expiryCopy = `The invite expires in ${expiryDays} ${expiryDays === 1 ? "day" : "days"}. If you weren't expecting it, you can ignore this email.`;
  return {
    preheader: `Invited by ${invitedBy}. The link expires in ${expiryDays} ${expiryDays === 1 ? "day" : "days"}.`,
    subject: `Join ${teamName} on ${APP_NAME}`,
    text: `${invitedBy} invited you to join the team "${teamName}" on ${APP_NAME}. Accepting shares scans, history, and reports across everyone on the team.\n\nAccept the invitation:\n${inviteLink}\n\n${expiryCopy}`,
    html: `
      ${emailHeading(`Join ${safeTeamName} on ${APP_NAME}`)}
      ${emailLead(`${emailStrong(safeInvitedBy)} invited you to their team. Accepting shares scans, history, and reports across everyone on it.`)}
      ${emailButton(safeInviteLink, "Accept invitation")}
      ${emailNote(expiryCopy)}
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
    preheader: `Invited by ${invitedBy} as ${roleLabel}. Expires in ${STAFF_INVITE_EXPIRY_DAYS} days.`,
    subject: `Join the ${APP_NAME} team as ${roleLabel}`,
    text: `${invitedBy} invited you to join the ${APP_NAME} staff as ${roleLabel}.\n\nAccept the invitation:\n${inviteLink}\n\nThe invite expires in ${STAFF_INVITE_EXPIRY_DAYS} days. If you weren't expecting it, you can ignore this email.`,
    html: `
      ${emailHeading(`Join the ${APP_NAME} team`)}
      ${emailLead(`${emailStrong(safeInvitedBy)} invited you to join the ${APP_NAME} staff as ${safeRoleLabel}.`)}
      ${emailButton(safeInviteLink, "Accept invitation")}
      ${emailNote(
        `The invite expires in ${STAFF_INVITE_EXPIRY_DAYS} days. If you weren't expecting it, you can ignore this email.`,
        "warn",
      )}
      ${emailFallbackLink(inviteLink)}
    `,
  };
}

export function landingContactEmail(input: { email: string; message: string }) {
  const email = escapeHtml(input.email);
  const message = escapeHtml(input.message).replace(/\n/g, "<br />");

  return {
    preheader: firstLine(input.message),
    subject: `[Landing] ${input.email}`,
    text: `New inquiry from the ${APP_NAME} landing page.\n\nEmail: ${input.email}\n\nMessage:\n${input.message}`,
    html: `
      ${emailHeading("New landing page inquiry")}
      ${emailLead(`Someone reached out through the ${APP_NAME} landing page.`)}
      ${emailDetailPanel([
        {
          label: "Email",
          value: emailLink(`mailto:${email}`, email),
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
    preheader:
      "We reply within 24 hours. Your message is quoted below for your records.",
    subject: "We got your message",
    text: `Thanks for reaching out. We'll get back to you within 24 hours.\n\nHere's what you sent, for your records:\n${message}\n\nWhile you wait, you can read the docs at ${APP_URL}/docs or start scanning by creating an account at ${APP_URL}/signup.`,
    html: `
      ${emailHeading("We got your message")}
      ${emailLead("Thanks for reaching out. We'll get back to you within 24 hours. Here's what you sent, for your records:")}
      ${emailParagraph(escapedMessage)}
      ${emailNote(
        `While you wait, read the ${emailLink(`${APP_URL}/docs`, "docs")} or start scanning by ${emailLink(`${APP_URL}/signup`, "creating an account")}.`,
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
    preheader: sentence(`${oldName} is now ${newName}`),
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
          accent: "ok",
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
    preheader: sentence(`${oldEmail} is now ${newEmail}`),
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
          accent: "ok",
        },
      ])}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

export function profilePasswordChangedEmail(details: SecurityAlertDetails) {
  return {
    preheader: `Changed from ${details.ipAddress}. Review your sessions if that wasn't you.`,
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
    preheader:
      "Sign-in now asks for an authenticator code. Keep your backup codes safe.",
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
    preheader:
      "Sign-in no longer asks for a code. You can turn it back on at any time.",
    subject: `Two-factor authentication is off for your ${APP_NAME} account`,
    text: `Two-factor authentication was just turned off for your ${APP_NAME} account. Signing in no longer asks for an authenticator code.\n\nTwo-factor authentication is one of the best defenses against a stolen password. You can turn it back on anytime in your security settings.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, change your password and review your active sessions right away.`,
    html: `
      ${emailHeading("Two-factor authentication is off")}
      ${emailLead(`Two-factor authentication was just turned off for your ${APP_NAME} account. Signing in no longer asks for an authenticator code.`)}
      ${emailNote(
        "Two-factor authentication is one of the best defenses against a stolen password. You can turn it back on anytime in your security settings.",
        "warn",
      )}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

export function backupCodesRegeneratedEmail(details: SecurityAlertDetails) {
  return {
    preheader:
      "The old codes stopped working the moment the new set was generated.",
    subject: `Your ${APP_NAME} backup codes were regenerated`,
    text: `A new set of two-factor backup codes was just generated for your ${APP_NAME} account.\n\nYour old backup codes no longer work. Save the new ones somewhere safe, like a password manager.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, change your password and review your active sessions right away.`,
    html: `
      ${emailHeading("Your backup codes were regenerated")}
      ${emailLead(`A new set of two-factor backup codes was just generated for your ${APP_NAME} account.`)}
      ${emailNote(
        "Your old backup codes no longer work. Save the new ones somewhere safe, like a password manager.",
        "warn",
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
    preheader: `${keyName} (${keyPrefix}...) can now call the API on your behalf.`,
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
          accent: "brand",
        },
      ])}
      ${securityDetailsBlock(details)}
      ${emailNote(
        `If you didn't create this key, revoke it from your API settings and email ${supportLink()}.`,
        "warn",
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
    preheader: `${keyName} can no longer authenticate. Requests using it now fail.`,
    subject: `An API key was revoked on your ${APP_NAME} account`,
    text: `The API key "${keyName}" was just revoked on your ${APP_NAME} account. It can no longer be used to authenticate API requests.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you didn't revoke this key, someone may have access to your account. Change your password and email ${SUPPORT_EMAIL}.`,
    html: `
      ${emailHeading("An API key was revoked")}
      ${emailLead(`The API key "${safeName}" was just revoked on your ${APP_NAME} account. It can no longer be used to authenticate API requests.`)}
      ${emailDetailPanel([
        { label: "Key name", value: safeName },
        { label: "Status", value: "Revoked", accent: "bad" },
      ])}
      ${securityDetailsBlock(details)}
      ${emailNote(
        `If you didn't revoke this key, someone may have access to your account. Change your password and email ${supportLink()}.`,
        "bad",
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
    preheader: `${webhookName} (${webhookType}) will receive scan events from now on.`,
    subject: `A webhook was created on your ${APP_NAME} account`,
    text: `A new ${webhookType} webhook "${webhookName}" was just added to your ${APP_NAME} account.\n\nEndpoint: ${webhookUrl}\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you didn't create this webhook, delete it from your webhook settings.`,
    html: `
      ${emailHeading("A webhook was created")}
      ${emailLead(`A new webhook was just added to your ${APP_NAME} account.`)}
      ${emailDetailPanel([
        { label: "Webhook name", value: safeName },
        { label: "Type", value: safeType, accent: "brand" },
        { label: "Endpoint", value: escapeHtml(webhookUrl), mono: true },
      ])}
      ${securityDetailsBlock(details)}
      ${emailNote(
        "If you didn't create this webhook, delete it from your webhook settings.",
        "warn",
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
    preheader: `${webhookName} will not receive scan events any more.`,
    subject: `A webhook was deleted from your ${APP_NAME} account`,
    text: `The webhook "${webhookName}" was just removed from your ${APP_NAME} account. It will no longer receive scan events.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you didn't delete this webhook, review your account activity and change your password.`,
    html: `
      ${emailHeading("A webhook was deleted")}
      ${emailLead(`The webhook "${safeName}" was just removed from your ${APP_NAME} account. It will no longer receive scan events.`)}
      ${emailDetailPanel([
        { label: "Webhook name", value: safeName },
        { label: "Status", value: "Deleted", accent: "bad" },
      ])}
      ${securityDetailsBlock(details)}
      ${emailNote(
        "If you didn't delete this webhook, review your account activity and change your password.",
        "warn",
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
    preheader: `${firstLabel} on the first attempt, ${retryLabel} on the retry.`,
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
          accent: "warn",
        },
        {
          label: "Retry",
          value: retryLabel,
          accent: "warn",
        },
      ])}
      ${emailNote(
        "The webhook is still active, so future scans will keep trying to deliver to it. Check that your endpoint is reachable and returns a 2xx status, or pause it until it's fixed.",
        "warn",
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
    preheader: `${frequencyLabel} scans of ${url}, starting from the next run.`,
    subject: `Scheduled scan created for ${hostOf(url)}`,
    text: `A new recurring scan of ${url} was just added to your ${APP_NAME} account, running ${frequency}.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you didn't set this up, delete it from your profile.`,
    html: `
      ${emailHeading("Scheduled scan created")}
      ${emailLead(`A new recurring scan was just added to your ${APP_NAME} account.`)}
      ${emailDetailPanel([
        {
          label: "Target",
          value: safeUrl,
          mono: true,
          accent: "brand",
        },
        { label: "Frequency", value: frequencyLabel },
      ])}
      ${securityDetailsBlock(details)}
      ${emailNote(
        "If you didn't set this up, delete it from your profile.",
        "warn",
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
    preheader: `No more automatic scans of ${url}.`,
    subject: `Scheduled scan deleted for ${hostOf(url)}`,
    text: `The recurring scan of ${url} was just removed from your ${APP_NAME} account.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}`,
    html: `
      ${emailHeading("Scheduled scan deleted")}
      ${emailLead(`A recurring scan was just removed from your ${APP_NAME} account.`)}
      ${emailDetailPanel([
        {
          label: "Target",
          value: safeUrl,
          mono: true,
          accent: "brand",
        },
        { label: "Status", value: "Deleted", accent: "bad" },
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
    preheader: `${sentenceCase(reason)}. No further runs until the target passes the check again.`,
    subject: `Scheduled scan disabled for ${hostOf(url)}`,
    text: `Your recurring scan of ${url} was turned off because the target no longer passes our safety check: ${reason}\n\nNo more automatic scans will run for this schedule. Remove it from your profile, or re-add it once the target passes the safety check again.`,
    html: `
      ${emailHeading("Scheduled scan disabled")}
      ${emailLead("A recurring scan was turned off because its target stopped passing our safety check.")}
      ${emailDetailPanel([
        {
          label: "Target",
          value: safeUrl,
          mono: true,
          accent: "brand",
        },
        { label: "Reason", value: safeReason, accent: "bad" },
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
    preheader:
      "We have 30 days to complete it, and we'll email you the moment it's done.",
    subject: `We received your ${typeLabel.toLowerCase()} request`,
    text: `Your ${typeLabel.toLowerCase()} request for your ${APP_NAME} account has been received and is queued for review.\n\nWe'll process this within 30 days, as required by GDPR and similar privacy rules. You'll get another email when it's done.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you didn't make this request, contact support right away.`,
    html: `
      ${emailHeading(`${typeLabel} request received`)}
      ${emailLead(`Your ${typeLabel.toLowerCase()} request has been received and is queued for review.`)}
      ${emailDetailPanel([
        { label: "Request type", value: typeLabel },
        {
          label: "Status",
          value: "Pending review",
          accent: "warn",
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
    preheader: `${location}, ${ipAddress}. Nothing to do if that was you.`,
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
    preheader: `${attempts} attempts from ${ipAddress}, all blocked. Your account is fine.`,
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
        "bad",
      )}
    `,
  };
}

export function rateLimitedEmail(
  ipAddress: string,
  _details: SecurityAlertDetails,
) {
  return {
    preheader: `Throttled from ${ipAddress}. Requests resume when the window resets.`,
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
          accent: "warn",
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
    preheader: `${keyName} has a new secret. The old one stopped working immediately.`,
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
        `If you didn't rotate this key, revoke it from your API settings and email ${supportLink()}.`,
        "warn",
      )}
    `,
  };
}

/** Upper-cases the first letter, for a value that has to open a sentence. */
function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Ends a sentence, without doubling a full stop the value already carries. */
function sentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

/** The opening line of a free-text message, for an inbox preview. */
function firstLine(message: string): string {
  const line = message.trim().split("\n")[0].trim();
  return line.length > 110 ? `${line.slice(0, 107)}...` : line;
}

/**
 * The host a scan targeted, for a subject line. A subject that says "Scan
 * complete: 3 issues found" is useless to anyone monitoring more than one
 * site, and the full URL is too long to survive an inbox's truncation, so
 * subjects carry the host and the body carries the URL. Falls back to the
 * whole string when it will not parse, which is what a caller that has
 * already normalised its input would expect.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** "10 minutes" / "1 minute", for copy that has to follow a live setting. */
function minutesCopy(minutes: number): string {
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function email2FACodeEmail(
  code: string,
  // EMAIL_2FA_CODE_EXPIRY_MINUTES is admin-editable, and the call sites
  // already resolve it one line above their INSERT. Hardcoding "10 minutes"
  // meant an operator who tightened the window for a compliance requirement
  // shipped mail telling every user it lasted twice as long, which users
  // then report as codes "expiring early".
  expiryMinutes: number = CONFIG_EMAIL_2FA_CODE_EXPIRY_MINUTES,
) {
  const window = minutesCopy(expiryMinutes);
  return {
    preheader: `The code expires in ${window}. We will never ask you to share it.`,
    subject: `${code} is your ${APP_NAME} sign-in code`,
    text: `Your ${APP_NAME} sign-in code is ${code}. It expires in ${window}.\n\nDon't share this code with anyone. ${APP_NAME} will never ask you for it. If you didn't try to sign in, change your password.`,
    html: `
      ${emailHeading("Your sign-in code")}
      ${emailLead("Enter this code to finish signing in.")}
      ${emailCodeBlock(code)}
      ${emailNote(
        `The code expires in ${window}. Don't share it with anyone; ${APP_NAME} will never ask you for it. If you didn't try to sign in, change your password.`,
        "warn",
      )}
    `,
  };
}

export function billingVerificationCodeEmail(
  code: string,
  expiryMinutes: number = CONFIG_BILLING_VERIFY_CODE_EXPIRY_MINUTES,
) {
  const window = minutesCopy(expiryMinutes);
  return {
    preheader: `The code expires in ${window} and unlocks billing once.`,
    subject: `${code} is your ${APP_NAME} billing access code`,
    text: `Your ${APP_NAME} billing access code is ${code}. It expires in ${window}.\n\nYou'll need a fresh code each time you open billing. Don't share it with anyone. We ask for this so payment details stay locked even if someone reaches your account, since only your email can unlock them.\n\nIf you didn't request this, secure your account.`,
    html: `
      ${emailHeading("Billing access code")}
      ${emailLead("Enter this code to view your billing details.")}
      ${emailCodeBlock(code)}
      ${emailNote(
        `The code expires in ${window}, and you'll need a fresh one each time you open billing. Don't share it with anyone.`,
        "warn",
      )}
      ${emailParagraph(
        "We ask for this so payment details stay locked even if someone reaches your account, since only your email can unlock them.",
      )}
    `,
  };
}

export function email2FAEnabledEmail(details: SecurityAlertDetails) {
  return {
    preheader: "Each sign-in now sends a verification code to this address.",
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
    preheader: "Sign-in no longer sends a verification code to this address.",
    subject: `Email two-factor authentication is off for your ${APP_NAME} account`,
    text: `Email-based two-factor authentication was just turned off for your ${APP_NAME} account. Signing in no longer sends a verification code by email.\n\nTwo-factor authentication makes a stolen password much harder to use. You can turn it back on anytime in your security settings.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, change your password and review your active sessions right away.`,
    html: `
      ${emailHeading("Email two-factor authentication is off")}
      ${emailLead(`Email-based two-factor authentication was just turned off for your ${APP_NAME} account. Signing in no longer sends a verification code by email.`)}
      ${emailNote(
        "Two-factor authentication makes a stolen password much harder to use. You can turn it back on anytime in your security settings.",
        "warn",
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
    EmailAccent
  > = {
    info: "brand",
    warning: "warn",
    success: "ok",
    alert: "bad",
  };
  const accent = typeAccent[input.type ?? "info"];

  return {
    preheader: `From ${input.adminName} on the ${APP_NAME} team.`,
    subject: input.title,
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
        `If anything here needs clarifying, reach the team at ${supportLink()}.`,
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

  // This built its own chip row from a private copy of the renderer the
  // scheduled-scan and digest reports use, so the same five severities were
  // drawn twice from two ramps. One scan report and one scheduled-scan report
  // of the same target could disagree about what "high" looks like.
  const chipRow = severityChipRow(summary);

  const lead =
    summary.total === 0
      ? `We finished scanning your target in ${durationSecs}s and found nothing to flag.`
      : `We finished scanning your target in ${durationSecs}s and found ${summary.total} ${issueWord}.`;

  const priority = summary.critical + summary.high;
  const priorityNote =
    priority > 0
      ? emailNote(
          `${summary.critical} critical and ${summary.high} high severity ${priority === 1 ? "finding is" : "findings are"} in this report. Start with those.`,
          "bad",
        )
      : "";

  // The first sentence of the plain-text body is what sendEmail turns into
  // the inbox preheader, so it leads with the counts rather than the
  // duration. A recipient scanning an inbox can now tell a clean scan from
  // one with two criticals without opening the mail, which is the judgement
  // this email exists to let them make.
  const countBreakdown = [
    summary.critical > 0 ? `${summary.critical} critical` : "",
    summary.high > 0 ? `${summary.high} high` : "",
    summary.medium > 0 ? `${summary.medium} medium` : "",
    summary.low > 0 ? `${summary.low} low` : "",
    summary.info > 0 ? `${summary.info} info` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const textLead =
    summary.total === 0
      ? `Nothing to flag on ${url}, scanned in ${durationSecs}s.`
      : `${countBreakdown} on ${url}, scanned in ${durationSecs}s.`;

  return {
    preheader: textLead,
    subject: `${hostOf(url)}: scan complete, ${summary.total} ${issueWord} found`,
    text: `${textLead}\n\nFindings:\n- Critical: ${summary.critical}\n- High: ${summary.high}\n- Medium: ${summary.medium}\n- Low: ${summary.low}\n- Info: ${summary.info}\nTotal: ${summary.total}\n\nView the full report: ${viewLink}`,
    html: `
      ${emailHeading("Scan complete")}
      ${emailLead(lead)}
      ${chipRow}
      ${emailDetailPanel([
        {
          label: "Target",
          value: safeUrl,
          mono: true,
          accent: "brand",
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
    .map((f) => emailFindingItem(f.severity, escapeHtml(f.title)))
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
    emailPanel(label, emailFindingList(findingListItems(items)));

  return {
    preheader: `${url}: ${newFindings.length} new, ${outstandingFindings.length} still open from before.`,
    subject: `${hostOf(url)}: ${newFindings.length} new critical/high finding${newFindings.length !== 1 ? "s" : ""}`,
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
          accent: "brand",
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
        "bad",
      )}
      ${emailButton(viewLink, "View the report", "bad")}
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
          "bad",
        )
      : "";

  return {
    preheader: `${summary.total} ${issueWord} on ${url}, scanned in ${durationSecs}s.`,
    subject: `${hostOf(url)}: scheduled scan "${scheduleName}" complete`,
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
          accent: "brand",
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
    .map((f) =>
      emailFindingItem(f.severity, escapeHtml(f.title), escapeHtml(f.url)),
    )
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
      ? `Posture digest: ${newFindingsTotal} new critical/high finding${newFindingsTotal !== 1 ? "s" : ""} across ${siteLabel}`
      : `Posture digest: ${siteLabel} monitored, nothing new this ${periodLabel}`;

  const trendCopy: Record<
    PostureDigestData["trend"],
    { accent: EmailAccent; label: string }
  > = {
    up: {
      accent: "bad",
      label: "Open critical/high findings increased",
    },
    down: {
      accent: "ok",
      label: "Open critical/high findings decreased",
    },
    flat: {
      accent: "neutral",
      label: "Open critical/high findings unchanged",
    },
  };
  const trend_ = trendCopy[trend];

  const findingsLabel = `New since your last digest${newFindingsTotal > newFindings.length ? ` (showing ${newFindings.length} of ${newFindingsTotal})` : ""}`;

  const text = `Your ${periodLabel}ly posture digest across ${siteLabel}.\n\nNew critical/high findings since your last digest: ${newFindingsTotal}\n${
    newFindings.length > 0 ? `\n${postureFindingListText(newFindings)}\n` : ""
  }\n${trend_.label}: ${previousOpenCount} -> ${currentOpenCount} open critical/high findings.\n\nView your scan history: ${APP_URL}/history`;

  const findingsBlock =
    newFindings.length > 0
      ? emailPanel(
          findingsLabel,
          emailFindingList(postureFindingListItems(newFindings)),
        )
      : emailNote(
          "No new critical or high severity findings since your last digest.",
          "ok",
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
          ...(newFindingsTotal > 0 ? { accent: "bad" as const } : {}),
        },
        {
          label: "Open now",
          value: `${currentOpenCount}`,
          accent: trend_.accent,
        },
      ])}
      ${emailNote(`${trend_.label}: ${previousOpenCount} to ${currentOpenCount} since your last digest.`, trend_.accent)}
      ${findingsBlock}
      ${emailButton(`${APP_URL}/history`, "View scan history")}
    `;

  const preheader = `${previousOpenCount} to ${currentOpenCount} open critical/high across ${siteLabel}.`;

  return { subject, preheader, text, html };
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
    .map((c) => emailChangeRow(c.field, c.oldValue, c.newValue))
    .join("");

  const changesText = input.changes
    .map(
      (c) =>
        `  - ${c.field}: "${c.oldValue || "(empty)"}" -> "${c.newValue || "(empty)"}"`,
    )
    .join("\n");

  return {
    preheader: `${input.changes.length} field${input.changes.length === 1 ? "" : "s"} changed by ${input.adminName}.`,
    subject: `An administrator updated your ${APP_NAME} account`,
    text: `Hi ${input.userName},\n\nAn administrator (${input.adminName}) changed some details on your ${APP_NAME} account.\n\nChanges:\n${changesText}\n\nWhen: ${timestamp}\n\nIf any of this looks wrong, reach the team at ${SUPPORT_EMAIL}.`,
    html: `
      ${emailHeading("Your account was updated")}
      ${emailLead(`Hi ${userName}, an administrator changed some details on your ${APP_NAME} account.`)}

      ${emailPanel(
        "Changes",
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${changesHtml}</table>`,
      )}
      ${emailDetailPanel([
        { label: "Changed by", value: adminName },
        { label: "When", value: escapeHtml(timestamp) },
      ])}
      ${emailParagraph(
        `If any of this looks wrong, reach the team at ${supportLink()}.`,
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
    preheader: `${amount} for ${input.planName} on ${input.date}.`,
    subject: `Your ${APP_NAME} payment receipt`,
    text: `Thanks, your payment went through.\n\nPlan: ${input.planName}\nAmount: ${amount}\nDate: ${input.date}\n${
      hasInvoice ? `\nDownload your invoice: ${input.invoiceUrl}\n` : ""
    }\nManage your subscription or update your card: ${manageUrl}`,
    html: `
      ${emailHeading("Payment received")}
      ${emailLead(`Thanks, your ${amount} payment for ${safePlan} went through. Here's your receipt.`)}
      ${emailDetailPanel([
        { label: "Plan", value: safePlan },
        { label: "Amount", value: amount, accent: "ok" },
        { label: "Date", value: escapeHtml(input.date) },
      ])}
      ${
        hasInvoice
          ? emailButton(input.invoiceUrl!, "Download invoice")
          : emailButton(manageUrl, "Manage subscription")
      }
      ${emailParagraph(
        `Manage your subscription or update your card anytime from your ${emailLink(manageUrl, "billing settings")}.`,
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
    { label: "Amount due", value: amount, accent: "bad" },
  ];
  if (input.nextAttempt) {
    rows.push({ label: "Next retry", value: escapeHtml(input.nextAttempt) });
  }

  return {
    preheader: `${amount} for ${input.planName} was declined. Update the card to keep access.`,
    subject: `${APP_NAME} couldn't process your payment`,
    text: `We couldn't charge your card ${amount} for your ${input.planName} subscription.\n${
      input.nextAttempt ? `\nNext retry: ${input.nextAttempt}\n` : ""
    }\nUpdate your payment method: ${updateUrl}\n\nYour plan stays active for now, but repeated failures will drop the account to free.`,
    html: `
      ${emailHeading("Your payment didn't go through")}
      ${emailLead(`We couldn't charge your card ${amount} for your ${safePlan} subscription.`)}
      ${emailDetailPanel(rows)}
      ${emailNote(retryLine, "warn")}
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
      statusAccent: EmailAccent;
      cta: string;
    }
  > = {
    upgraded: {
      subject: `You're now on ${input.planName}`,
      heading: "Your plan was upgraded",
      lead: `You're now on ${safePlan}. The higher limits are live on your account right away.`,
      statusLabel: "Upgraded",
      statusAccent: "ok",
      cta: "Manage subscription",
    },
    downgraded: {
      subject: `Your plan changed to ${input.planName}`,
      heading: "Your plan was changed",
      lead: `Your subscription is now ${safePlan}. The new limits apply from your next billing cycle.`,
      statusLabel: "Downgraded",
      statusAccent: "warn",
      cta: "Manage subscription",
    },
    canceled: {
      subject: `Your ${APP_NAME} subscription was canceled`,
      heading: "Your subscription was canceled",
      lead: `Your ${safePlan} subscription is canceled. You keep its features until the end of the period you already paid for, then the account drops to the free plan.`,
      statusLabel: "Canceled",
      statusAccent: "bad",
      cta: "Reactivate subscription",
    },
    renewed: {
      subject: `Your ${APP_NAME} subscription renewed`,
      heading: "Your subscription renewed",
      lead: `Your ${safePlan} subscription is active for another cycle. Nothing to do.`,
      statusLabel: "Active",
      statusAccent: "ok",
      cta: "Manage subscription",
    },
  };
  const c = copy[input.kind];

  const rows: EmailDetailRow[] = [];
  if (safePrev && isPlanMove) {
    rows.push({ label: "Previous plan", value: safePrev });
  }
  rows.push({ label: "Plan", value: safePlan });
  rows.push({ label: "Status", value: c.statusLabel, accent: c.statusAccent });
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
    preheader: `Plan is now ${input.planName}. Status: ${c.statusLabel}.`,
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
    preheader:
      "Scans, schedules, API keys and billing records are gone. Last email from us.",
    subject: `Your ${APP_NAME} account was deleted`,
    text: `${greetingText} ${APP_NAME} account and all of its data have been permanently deleted. Scans, schedules, API keys, and billing records are gone and can't be recovered.\n\nThis is the last email we'll send to this address. If you didn't request this deletion, email ${SUPPORT_EMAIL} right away.\n\nThanks for trying ${APP_NAME}.`,
    html: `
      ${emailHeading("Your account was deleted")}
      ${emailLead(`${greetingHtml} ${APP_NAME} account and all of its data have been permanently deleted.`)}
      ${emailParagraph(
        "Scans, schedules, API keys, and billing records are gone and can't be recovered. This is the last email we'll send to this address.",
      )}
      ${emailNote(
        `If you didn't request this deletion, email ${supportLink()} right away.`,
        "bad",
      )}
      ${emailParagraph(`Thanks for trying ${APP_NAME}.`)}
    `,
  };
}

// Sent when a user revokes every session ("sign out everywhere"). Security
// notice, gated on the session_alerts preference.
export function sessionRevokedEmail(details: SecurityAlertDetails) {
  return {
    preheader: `Signed out from ${details.ipAddress}. Sign in again on each device.`,
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
    preheader: "Your own account, scans and history are untouched.",
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
    preheader: `${oldRole} to ${newRole} in ${teamName}.`,
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
          accent: "brand",
        },
      ])}
      ${emailParagraph("What you can do in the team may have changed with it.")}
      ${emailButton(`${APP_URL}/teams`, "View the team")}
    `,
  };
}

// Sent to the person who sent the invite once the recipient answers it. The
// invitee already gets the invite mail and the in-app bell; the inviter had no
// signal at all, so a team owner who invited five people had to keep opening
// the members page to find out who had joined.
export function teamInviteResolvedEmail(
  teamName: string,
  inviteeEmail: string,
  accepted: boolean,
) {
  const safeTeam = escapeHtml(teamName);
  const safeEmail = escapeHtml(inviteeEmail);
  const verb = accepted ? "accepted" : "declined";
  return {
    subject: `${inviteeEmail} ${verb} your invite to ${teamName}`,
    preheader: accepted
      ? `They can now see the team's scans, history and reports.`
      : `Nothing changed on the team. You can invite them again at any time.`,
    text: `${inviteeEmail} ${verb} your invitation to the team "${teamName}" on ${APP_NAME}.\n\n${
      accepted
        ? "They can now see the team's shared scans, history, and reports."
        : "Nothing changed on the team. You can send another invite whenever you want."
    }\n\nManage the team: ${APP_URL}/teams`,
    html: `
      ${emailHeading(accepted ? "Your invite was accepted" : "Your invite was declined")}
      ${emailLead(`${emailStrong(safeEmail)} ${verb} your invitation to the team "${safeTeam}".`)}
      ${emailDetailPanel([
        { label: "Team", value: safeTeam },
        { label: "Invitee", value: safeEmail },
        {
          label: "Answer",
          value: accepted ? "Accepted" : "Declined",
          accent: accepted ? "ok" : "neutral",
        },
      ])}
      ${emailParagraph(
        accepted
          ? "They can now see the team's shared scans, history, and reports."
          : "Nothing changed on the team. You can send another invite whenever you want.",
      )}
      ${emailButton(`${APP_URL}/teams`, "Manage the team")}
    `,
  };
}

// Sent to every member when a team is deleted outright. teamMemberRemovedEmail
// covers one member being removed; deleting the team removed all of them and
// told none of them, so a member's shared scans simply stopped being there.
export function teamDeletedEmail(teamName: string) {
  const safeTeam = escapeHtml(teamName);
  return {
    subject: `The team ${teamName} was deleted`,
    preheader: "Your own account, scans and history are untouched.",
    text: `The team "${teamName}" on ${APP_NAME} was deleted by its owner.\n\nIts shared scans, history, and reports are no longer available to anyone who was on it. Your own account and your own scans are untouched.\n\nIf you think this was a mistake, talk to whoever owned the team.`,
    html: `
      ${emailHeading("A team you were on was deleted")}
      ${emailLead(`The team "${safeTeam}" was deleted by its owner.`)}
      ${emailParagraph(
        "Its shared scans, history, and reports are no longer available to anyone who was on it. Your own account and your own scans are untouched.",
      )}
      ${emailNote("If you think this was a mistake, talk to whoever owned the team.")}
    `,
  };
}

// Sent the first time an address is confirmed. The verification mail covers
// the request; nothing covered the result, so a new account's first successful
// action produced silence.
export function emailVerifiedEmail(name?: string | null) {
  const greetingHtml = name ? `Hi ${escapeHtml(name)}, your` : "Your";
  const greetingText = name ? `Hi ${name}, your` : "Your";
  return {
    subject: `Your ${APP_NAME} email is verified`,
    preheader: "Paste a URL and the first scan takes about three seconds.",
    text: `${greetingText} email address is confirmed and your ${APP_NAME} account is fully active.\n\nPaste a URL on the dashboard and the first scan takes about three seconds. Nothing to install.\n\nStart scanning: ${APP_URL}/dashboard\nRead the docs: ${APP_URL}/docs`,
    html: `
      ${emailHeading("Your email is verified")}
      ${emailLead(`${greetingHtml} address is confirmed and your ${APP_NAME} account is fully active.`)}
      ${emailParagraph(
        "Paste a URL on the dashboard and the first scan takes about three seconds. There is no agent to install.",
      )}
      ${emailButton(`${APP_URL}/dashboard`, "Run your first scan")}
      ${emailNote(
        `The ${emailLink(`${APP_URL}/docs`, "docs")} cover the API, scheduled scans, and the CI integrations if you want them.`,
      )}
    `,
  };
}

/**
 * A sign-in method was connected to or disconnected from the account.
 *
 * This is the same class of event as twoFactorEnabled/Disabled: it changes how
 * many ways there are into the account. Connecting one adds a credential the
 * owner may not have added; disconnecting one can lock a password-less account
 * out of itself. Neither said anything before.
 */
export function loginMethodChangedEmail(
  providerLabel: string,
  connected: boolean,
  details: SecurityAlertDetails,
) {
  const safeProvider = escapeHtml(providerLabel);
  const verb = connected ? "connected to" : "disconnected from";
  const consequence = connected
    ? `Signing in with ${providerLabel} now works on this account.`
    : `Signing in with ${providerLabel} no longer works. Make sure you still have a password or another provider you can use.`;
  return {
    subject: `${providerLabel} was ${verb} your ${APP_NAME} account`,
    preheader: consequence,
    text: `${providerLabel} was just ${verb} your ${APP_NAME} account.\n\n${consequence}\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf this wasn't you, change your password and review your active sessions right away, then email ${SUPPORT_EMAIL}.`,
    html: `
      ${emailHeading(connected ? "A sign-in method was added" : "A sign-in method was removed")}
      ${emailLead(`${emailStrong(safeProvider)} was just ${verb} your ${APP_NAME} account.`)}
      ${emailNote(escapeHtml(consequence), connected ? "brand" : "warn")}
      ${securityDetailsBlock(details)}
      ${securityWarningBlock()}
    `,
  };
}

// Sent when an API key's IP binding is cleared. The binding being VIOLATED
// already emailed; deliberately removing it did not, which is the wrong way
// round: one is a failed request, the other is a security control being
// switched off.
export function apiKeyBindingResetEmail(
  keyName: string,
  details: SecurityAlertDetails,
) {
  const safeName = escapeHtml(keyName);
  return {
    subject: `The IP lock on an API key was removed`,
    preheader: `${keyName} will now accept requests from any address.`,
    text: `The IP binding on your API key "${keyName}" was just cleared. The key will now accept requests from any address, and re-binds to the first one it sees.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nIf you didn't do this, revoke the key from your API settings and email ${SUPPORT_EMAIL}.`,
    html: `
      ${emailHeading("An API key's IP lock was removed")}
      ${emailLead(`The IP binding on your API key "${safeName}" was just cleared.`)}
      ${emailDetailPanel([
        { label: "Key name", value: safeName },
        { label: "Binding", value: "Cleared", accent: "warn" },
      ])}
      ${emailNote(
        "The key now accepts requests from any address, and re-binds to the first one it sees.",
        "warn",
      )}
      ${securityDetailsBlock(details)}
      ${emailNote(
        `If you didn't do this, revoke the key from your API settings and email ${supportLink()}.`,
        "bad",
      )}
    `,
  };
}

// Sent when a webhook's signing secret is rotated. Every receiver verifying
// signatures starts rejecting deliveries the moment this happens, which makes
// it the webhook change most worth an email, and it was the one with none.
export function webhookSecretRotatedEmail(
  webhookName: string,
  details: SecurityAlertDetails,
) {
  const safeName = escapeHtml(webhookName);
  const manageUrl = `${APP_URL}/profile?tab=webhooks`;
  return {
    subject: `The signing secret for a webhook was rotated`,
    preheader: `${webhookName} deliveries fail signature checks until you update the receiver.`,
    text: `The signing secret for your webhook "${webhookName}" was just rotated.\n\nAny receiver still verifying with the old secret will reject deliveries. Copy the new secret from your webhook settings and update it there.\n\nIP address: ${details.ipAddress}\nDevice: ${details.userAgent}\n\nManage webhooks: ${manageUrl}`,
    html: `
      ${emailHeading("A webhook signing secret was rotated")}
      ${emailLead(`The signing secret for your webhook "${safeName}" was just rotated.`)}
      ${emailNote(
        "Any receiver still verifying with the old secret will reject deliveries. Copy the new secret from your webhook settings and update it there.",
        "warn",
      )}
      ${securityDetailsBlock(details)}
      ${emailButton(manageUrl, "Open webhook settings")}
    `,
  };
}

// ---------------------------------------------------------------------------
// Credit purchases
//
// paymentReceiptEmail covers a subscription invoice. A one-off credit purchase
// is a separate Stripe flow (payment_intent.succeeded) and had no email at all:
// money left the card, the balance moved, and the only record was a server log
// line. These two are transactional and are not preference-gated.
// ---------------------------------------------------------------------------

export interface CreditLedgerEntry {
  /** Human label for the credit type, e.g. "AI analysis credits". */
  creditLabel: string;
  quantity: number;
  amountCents: number;
  currency: string;
}

export function creditPurchaseReceiptEmail(
  input: CreditLedgerEntry & { date: string; invoiceUrl?: string | null },
) {
  const amount = formatMoney(input.amountCents, input.currency);
  const safeLabel = escapeHtml(input.creditLabel);
  const balanceUrl = `${APP_URL}/profile?tab=billing`;
  const hasInvoice =
    !!input.invoiceUrl && /^https?:\/\//i.test(input.invoiceUrl);
  return {
    subject: `Your ${APP_NAME} credit receipt`,
    preheader: `${input.quantity} ${input.creditLabel} for ${amount}, already on your balance.`,
    text: `Thanks, your payment went through and the credits are already on your balance.\n\nCredits: ${input.quantity} ${input.creditLabel}\nAmount: ${amount}\nDate: ${input.date}\n${
      hasInvoice ? `\nDownload your invoice: ${input.invoiceUrl}\n` : ""
    }\nCheck your balance: ${balanceUrl}`,
    html: `
      ${emailHeading("Credits added")}
      ${emailLead(`Your ${amount} payment went through and the credits are already on your balance.`)}
      ${emailDetailPanel([
        {
          label: "Credits",
          value: `${input.quantity} ${safeLabel}`,
          accent: "ok",
        },
        { label: "Amount", value: amount },
        { label: "Date", value: escapeHtml(input.date) },
      ])}
      ${
        hasInvoice
          ? emailButton(input.invoiceUrl!, "Download invoice")
          : emailButton(balanceUrl, "Check your balance")
      }
      ${emailParagraph(
        "Credits do not expire and are spent oldest first. Nothing recurring was set up by this purchase.",
      )}
    `,
  };
}

export function creditRefundEmail(
  input: CreditLedgerEntry & { disputed?: boolean },
) {
  const amount = formatMoney(input.amountCents, input.currency);
  const safeLabel = escapeHtml(input.creditLabel);
  const reason = input.disputed
    ? "Your bank opened a dispute on the charge, so we reversed it."
    : "The charge was refunded, so we reversed it.";
  return {
    subject: `${amount} was refunded and the credits were removed`,
    preheader: `${input.quantity} ${input.creditLabel} came off your balance.`,
    text: `${reason}\n\nRefunded: ${amount}\nCredits removed: ${input.quantity} ${input.creditLabel}\n\nYour balance no longer includes them. If this doesn't look right, email ${SUPPORT_EMAIL} and we'll sort it out.`,
    html: `
      ${emailHeading("A credit purchase was refunded")}
      ${emailLead(escapeHtml(reason))}
      ${emailDetailPanel([
        { label: "Refunded", value: amount, accent: "ok" },
        {
          label: "Credits removed",
          value: `${input.quantity} ${safeLabel}`,
          accent: "bad",
        },
      ])}
      ${emailNote(
        `Your balance no longer includes them. If this doesn't look right, email ${supportLink()} and we'll sort it out.`,
      )}
    `,
  };
}

// ---------------------------------------------------------------------------
// Support tickets
//
// These three replaced hand-built `<p>` strings in lib/support/ticket-notify.ts
// that never reached the layout at all: no wordmark, no heading, no button, no
// footer, and a fourth private copy of escapeHtml. They were the only messages
// in the product that did not look like the product.
// ---------------------------------------------------------------------------

function ticketBodyBlock(body: string): string {
  return emailPanel(
    "Message",
    `<div class="v-t" style="font-family:${SANS_STACK};font-size:14px;line-height:1.65;">${escapeHtml(body).replace(/\n/g, "<br />")}</div>`,
  );
}

/** To the user, confirming their in-app ticket landed. */
export function supportTicketReceivedEmail(input: {
  ticketId: number;
  subject: string;
  category: string;
  body: string;
}) {
  const url = `${APP_URL}/contact?ticket=${input.ticketId}`;
  return {
    subject: `[Ticket #${input.ticketId}] ${input.subject}`,
    preheader: "We reply to most tickets within 24 to 48 hours.",
    text: `Your support ticket #${input.ticketId} is open and in our queue.\n\nSubject: ${input.subject}\nCategory: ${input.category}\n\nWhat you sent:\n${input.body}\n\nWe reply to most tickets within 24 to 48 hours. Track it here: ${url}`,
    html: `
      ${emailHeading("Your ticket is open")}
      ${emailLead(`Ticket #${input.ticketId} is in our queue. We reply to most tickets within 24 to 48 hours.`)}
      ${emailDetailPanel([
        { label: "Ticket", value: `#${input.ticketId}`, mono: true },
        { label: "Subject", value: escapeHtml(input.subject) },
        { label: "Category", value: escapeHtml(input.category) },
        { label: "Status", value: "Open", accent: "ok" },
      ])}
      ${ticketBodyBlock(input.body)}
      ${emailButton(url, "Track this ticket")}
    `,
  };
}

/** To the staff inbox, on a new ticket or a user reply. */
export function supportTicketStaffAlertEmail(input: {
  ticketId: number;
  subject: string;
  category: string;
  fromEmail: string;
  body: string;
  isNew: boolean;
}) {
  const verb = input.isNew ? "New" : "Reply on";
  return {
    subject: `[Ticket #${input.ticketId}] ${input.subject}`,
    preheader: `${input.category} from ${input.fromEmail}`,
    text: `${verb} ${input.category} support ticket #${input.ticketId} from ${input.fromEmail}\n\nSubject: ${input.subject}\n\n${input.body}\n\nOpen the admin support inbox: ${APP_URL}/admin`,
    html: `
      ${emailHeading(input.isNew ? "New support ticket" : "New reply on a ticket")}
      ${emailLead(`${emailStrong(escapeHtml(input.fromEmail))} ${input.isNew ? "opened" : "replied on"} ticket #${input.ticketId}.`)}
      ${emailDetailPanel([
        { label: "Ticket", value: `#${input.ticketId}`, mono: true },
        { label: "Subject", value: escapeHtml(input.subject) },
        {
          label: "Category",
          value: escapeHtml(input.category),
          accent: "brand",
        },
        { label: "From", value: escapeHtml(input.fromEmail) },
      ])}
      ${ticketBodyBlock(input.body)}
      ${emailButton(`${APP_URL}/admin`, "Open the support inbox")}
    `,
  };
}

/** To the user, when staff reply. */
export function supportTicketReplyEmail(input: {
  ticketId: number;
  subject: string;
  body: string;
}) {
  const url = `${APP_URL}/contact?ticket=${input.ticketId}`;
  return {
    subject: `Re: [Ticket #${input.ticketId}] ${input.subject}`,
    preheader: "Reply on the ticket and it stays on the same thread.",
    text: `Our team replied to your support ticket #${input.ticketId}.\n\n${input.body}\n\nView and reply: ${url}`,
    html: `
      ${emailHeading("Support replied to your ticket")}
      ${emailLead(`There's a new reply on ticket #${input.ticketId}, "${escapeHtml(input.subject)}".`)}
      ${ticketBodyBlock(input.body)}
      ${emailButton(url, "View and reply")}
    `,
  };
}

/** To the user, when staff resolve, close, or reopen the ticket. */
export function supportTicketStatusChangedEmail(input: {
  ticketId: number;
  subject: string;
  status: string;
}) {
  const url = `${APP_URL}/contact?ticket=${input.ticketId}`;
  const status = input.status.toLowerCase();
  const closed = status === "resolved" || status === "closed";
  return {
    subject: `Ticket #${input.ticketId} is ${status}`,
    preheader: closed
      ? "Reply on it and it reopens, no need to start a new one."
      : "Someone is looking at it again.",
    text: `Your support ticket #${input.ticketId} ("${input.subject}") is now ${status}.\n\n${
      closed
        ? "If it isn't actually sorted, reply on the ticket and it reopens. You don't need to start a new one."
        : "Someone is looking at it again. We'll email you when there's a reply."
    }\n\nView the ticket: ${url}`,
    html: `
      ${emailHeading(`Ticket #${input.ticketId} is ${escapeHtml(status)}`)}
      ${emailLead(`"${escapeHtml(input.subject)}" was marked ${escapeHtml(status)}.`)}
      ${emailDetailPanel([
        { label: "Ticket", value: `#${input.ticketId}`, mono: true },
        {
          label: "Status",
          value: escapeHtml(status),
          accent: closed ? "ok" : "brand",
        },
      ])}
      ${emailParagraph(
        closed
          ? "If it isn't actually sorted, reply on the ticket and it reopens. You don't need to start a new one."
          : "Someone is looking at it again. We'll email you when there's a reply.",
      )}
      ${emailButton(url, "View the ticket")}
    `,
  };
}
