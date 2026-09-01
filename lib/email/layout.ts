/**
 * The branded email shell, as a pure function of its inputs.
 *
 * This exists because there were two of it. lib/email/email.ts owned the real
 * `layout()` (server-only: it reads APP_URL/LOGO_URL/SUPPORT_EMAIL from
 * constants and is reached through nodemailer), and
 * components/admin/shared/email-preview-html.ts owned a hand-kept client-side
 * copy for the admin preview iframes, with a comment asking whoever edited one
 * to remember the other. They drifted on four things: the preview hardcoded
 * `${appUrl}/favicon.svg` instead of the deployment's LOGO_URL, it shipped no
 * `@media (max-width: 600px)` rules so it could not show the mobile rendering,
 * it never rendered the "Manage email preferences" button, and its footer
 * stopped before the support address. An admin composing a broadcast was
 * previewing a message that was not the one recipients received.
 *
 * Nothing in here imports server-only code or reads config, so the admin
 * preview and the mail sender can both call it. Everything that differs
 * between the two callers (which app URL, which logo, whether there is an
 * unsubscribe token) is an argument.
 */
import { BRAND } from "@/lib/config/brand";

/**
 * The wordmark is monospace on every other surface (the app header, the
 * landing nav and the auth layout all render APP_NAME with `font-mono
 * font-semibold tracking-tight`, backed by JetBrains Mono). Email was the one
 * place it was set in bold sans, so the first thing a recipient saw did not
 * look like the product they signed up for.
 *
 * Email clients cannot load a webfont reliably, so this is a stack of faces
 * that actually ship on the platforms that matter, ending in the generic
 * `monospace` keyword. JetBrains Mono is listed first for the handful of
 * desktop clients where the recipient happens to have it installed.
 */
export const MONO_STACK =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

/**
 * Same stack, named for its job. lib/email/email.ts inlined a shorter,
 * divergent variant of this three times (the fallback-URL line, the
 * detail-value cell and the one-time-code block), so the wordmark and the
 * code block could render in two different typefaces in the same message.
 */
const WORDMARK_FONT = MONO_STACK;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailLayoutInput {
  /** Already-safe HTML for the card body. Callers escape their own text. */
  content: string;
  appName: string;
  appUrl: string;
  /** Absolute URL. Email clients do not resolve root-relative asset paths. */
  logoSrc: string;
  supportEmail: string;
  /** Human-facing preferences page, null when there is no unsubscribe token. */
  unsubscribeUrl?: string | null;
  /** Already-built hidden preview block, empty string when there is none. */
  preheaderHtml?: string;
}

export function emailLayout({
  content,
  appName,
  appUrl,
  logoSrc,
  supportEmail,
  unsubscribeUrl = null,
  preheaderHtml = "",
}: EmailLayoutInput): string {
  const hostname = new URL(appUrl).hostname;

  const preferencesButton = unsubscribeUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto 18px auto;">
        <tr>
          <td bgcolor="${BRAND.surfaceRaised}" style="border-radius: 6px;">
            <a href="${unsubscribeUrl}" style="display: inline-block; padding: 8px 18px; background-color: ${BRAND.surfaceRaised}; border: 1px solid ${BRAND.borderStrong}; color: ${BRAND.textMuted}; font-size: 12px; font-weight: 600; text-decoration: none; border-radius: 6px;">Manage email preferences</a>
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
  <title>${appName}</title>
  <style>
    /* Progressive enhancement only; every element also carries inline styles. */
    @media only screen and (max-width: 600px) {
      .vr-shell { padding: 24px 12px !important; }
      .vr-card { padding: 26px 20px !important; }
    }
    a { color: ${BRAND.primaryLight}; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${BRAND.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: ${BRAND.text};">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${BRAND.bg};">
    <tr>
      <td align="center" class="vr-shell" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
          <tr>
            <td align="center" style="padding: 0 0 22px 0;">
              <a href="${appUrl}" style="text-decoration: none; color: ${BRAND.text};">
                <img src="${logoSrc}" alt="" width="30" height="30" style="display: inline-block; vertical-align: middle; border: 0;" />
                <span style="display: inline-block; vertical-align: middle; margin-left: 9px; font-family: ${WORDMARK_FONT}; font-size: 18px; font-weight: 600; letter-spacing: -0.3px; color: ${BRAND.text};">${appName}</span>
              </a>
            </td>
          </tr>
          <tr>
            <td class="vr-card" style="background-color: ${BRAND.surface}; border: 1px solid ${BRAND.border}; border-top: 3px solid ${BRAND.primary}; border-radius: 12px; padding: 34px 32px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding: 26px 16px 0 16px; text-align: center;">
              ${preferencesButton}
              <p style="margin: 0 0 10px 0; font-size: 12px; color: ${BRAND.textFaint}; line-height: 1.6;">
                You're getting this because you have a ${appName} account. Choose what we send you in your <a href="${appUrl}/profile?tab=notifications" style="color: ${BRAND.primaryLight}; text-decoration: none;">account settings</a>, or reach the team at <a href="mailto:${supportEmail}" style="color: ${BRAND.primaryLight}; text-decoration: none;">${supportEmail}</a>.
              </p>
              <p style="margin: 0; font-size: 11px; color: ${BRAND.textDim}; line-height: 1.5;">
                ${appName}, web vulnerability scanner &middot; <a href="${appUrl}" style="color: ${BRAND.textDim}; text-decoration: underline;">${hostname}</a>
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
