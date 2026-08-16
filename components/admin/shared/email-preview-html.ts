/**
 * Client-side stand-in for the real branded email layout
 * (lib/email/email.ts's `layout()`, server-only) -- used anywhere the
 * admin panel needs to show "roughly what this would look like as an
 * email" without a server round trip. Colors are kept in sync with
 * lib/email/email.ts's own COLORS by hand; there's no shared import
 * across the client/server boundary for a handful of hex values.
 *
 * `bodyHtml` is inserted unescaped -- callers that have raw user/plain
 * text (not already-safe HTML) must escape and wrap it themselves
 * before calling this, the same way lib/email/email.ts's own template
 * functions build HTML before handing it to `layout()`.
 */
const EMAIL_COLORS = {
  BG_DARK: "#0a0e13",
  BG_CARD: "#0f172a",
  BORDER: "#1e293b",
  TEXT_PRIMARY: "#f8fafc",
  TEXT_SECONDARY: "#94a3b8",
  TEXT_MUTED: "#64748b",
  TEXT_DARK: "#475569",
  ACCENT_BLUE: "#2563eb",
  ACCENT_BLUE_LIGHT: "#3b82f6",
};

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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>body { margin: 0; }</style>
</head>
<body style="margin: 0; padding: 0; background-color: ${EMAIL_COLORS.BG_DARK}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #e5e7eb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${EMAIL_COLORS.BG_DARK}; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 0 0 20px 0; text-align: center;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <img src="/favicon.svg" alt="${appName}" width="48" height="48" style="display: block; margin: 0 auto;" />
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: ${EMAIL_COLORS.TEXT_PRIMARY}; letter-spacing: -0.3px;">${appName}</h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 0 24px 0;">
              <div style="height: 2px; background: linear-gradient(90deg, ${EMAIL_COLORS.ACCENT_BLUE}, ${EMAIL_COLORS.ACCENT_BLUE_LIGHT}); border-radius: 999px;"></div>
            </td>
          </tr>
          <tr>
            <td style="background-color: ${EMAIL_COLORS.BG_CARD}; border: 1px solid ${EMAIL_COLORS.BORDER}; border-radius: 12px; padding: 32px 28px;">
              <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: ${EMAIL_COLORS.TEXT_PRIMARY};">${safeTitle}</h2>
              <div style="font-size: 14px; color: ${EMAIL_COLORS.TEXT_SECONDARY}; line-height: 1.6;">${bodyHtml}</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 20px 0 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="text-align: center;">
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: ${EMAIL_COLORS.TEXT_MUTED}; line-height: 1.6;">
                      <a href="${appUrl}" style="color: ${EMAIL_COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">${new URL(appUrl).hostname}</a>
                    </p>
                    <p style="margin: 0; font-size: 11px; color: ${EMAIL_COLORS.TEXT_DARK}; line-height: 1.5;">
                      ${appName} - Web Vulnerability Scanner<br />
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
</html>`;
}
