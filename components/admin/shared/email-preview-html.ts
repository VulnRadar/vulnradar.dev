/**
 * Client-side stand-in for the real branded email layout
 * (lib/email/email.ts's `layout()`, server-only) -- used anywhere the
 * admin panel needs to show "roughly what this would look like as an
 * email" without a server round trip. This mirrors that layout's header,
 * card, and footer; keep the two in step when either changes.
 *
 * Colours come from lib/config/brand.ts (the same brand source of truth
 * the real layout consumes), so there's no longer a by-hand-synced copy of
 * the palette here to drift.
 *
 * `bodyHtml` is inserted unescaped -- callers that have raw user/plain
 * text (not already-safe HTML) must escape and wrap it themselves
 * before calling this, the same way lib/email/email.ts's own template
 * functions build HTML before handing it to `layout()`.
 */
import { BRAND } from "@/lib/config/brand";

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function generateEmailPreviewHtml({
  title,
  bodyHtml,
  appName,
  appUrl,
}: {
  title: string;
  bodyHtml: string;
  appName: string;
  appUrl: string;
}): string {
  const safeTitle = escapeHtml(title || "Subject");
  const hostname = new URL(appUrl).hostname;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="color-scheme" content="dark light" />
  <style>body { margin: 0; }</style>
</head>
<body style="margin: 0; padding: 0; background-color: ${BRAND.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: ${BRAND.text};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${BRAND.bg}; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
          <tr>
            <td align="center" style="padding: 0 0 22px 0;">
              <a href="${appUrl}" style="text-decoration: none; color: ${BRAND.text};">
                <img src="${appUrl}/favicon.svg" alt="" width="30" height="30" style="display: inline-block; vertical-align: middle; border: 0;" />
                <span style="display: inline-block; vertical-align: middle; margin-left: 9px; font-size: 19px; font-weight: 700; letter-spacing: -0.2px; color: ${BRAND.text};">${appName}</span>
              </a>
            </td>
          </tr>
          <tr>
            <td style="background-color: ${BRAND.surface}; border: 1px solid ${BRAND.border}; border-top: 3px solid ${BRAND.primary}; border-radius: 12px; padding: 34px 32px;">
              <h1 style="margin: 0 0 12px 0; font-size: 21px; line-height: 1.3; font-weight: 700; color: ${BRAND.text}; letter-spacing: -0.2px;">${safeTitle}</h1>
              <div style="font-size: 14px; color: ${BRAND.textMuted}; line-height: 1.65;">${bodyHtml}</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 26px 16px 0 16px; text-align: center;">
              <p style="margin: 0 0 10px 0; font-size: 12px; color: ${BRAND.textFaint}; line-height: 1.6;">
                You're getting this because you have a ${appName} account. Choose what we send you in your account settings.
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
