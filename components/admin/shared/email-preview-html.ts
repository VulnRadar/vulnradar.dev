/**
 * The srcDoc for the admin panel's email preview iframes.
 *
 * This used to be a hand-kept copy of lib/email/email.ts's `layout()`, with a
 * comment asking whoever edited one to remember the other. They drifted: the
 * copy hardcoded `${appUrl}/favicon.svg` rather than the deployment's
 * LOGO_URL, shipped none of the `@media (max-width: 600px)` rules so it could
 * not show the mobile rendering, never rendered the "Manage email
 * preferences" button, and stopped its footer before the support address. An
 * admin composing a broadcast was previewing a message that was not the one
 * recipients received.
 *
 * Both sides now call the one shell in lib/email/layout.ts, which has no
 * server-only imports. What is left here is the preview's own framing: the
 * heading and body wrapper a real template would have built with email.ts's
 * emailHeading/emailLead helpers.
 *
 * `bodyHtml` is inserted unescaped: callers holding raw user or plain text
 * must escape and wrap it themselves, the same way lib/email/email.ts's
 * template functions build HTML before handing it to the layout.
 */
import { BRAND } from "@/lib/config/brand";
import { emailLayout, escapeHtml } from "@/lib/email/layout";

export { escapeHtml };

export function generateEmailPreviewHtml({
  title,
  bodyHtml,
  appName,
  appUrl,
  logoSrc,
  supportEmail,
  unsubscribeUrl,
}: {
  title: string;
  bodyHtml: string;
  appName: string;
  appUrl: string;
  /**
   * Absolute logo URL, so a deployment with a custom LOGO_URL previews its own
   * logo. Falls back to the favicon only when the caller has nothing better.
   */
  logoSrc?: string;
  supportEmail?: string;
  /**
   * Pass a URL to preview the "Manage email preferences" button real messages
   * carry whenever the recipient has an unsubscribe token. Every broadcast
   * does, so the broadcast composer should pass one.
   */
  unsubscribeUrl?: string | null;
}): string {
  const safeTitle = escapeHtml(title || "Subject");
  return emailLayout({
    content: `<h1 style="margin: 0 0 12px 0; font-size: 21px; line-height: 1.3; font-weight: 700; color: ${BRAND.text}; letter-spacing: -0.2px;">${safeTitle}</h1>
              <div style="font-size: 14px; color: ${BRAND.textMuted}; line-height: 1.65;">${bodyHtml}</div>`,
    appName,
    appUrl,
    logoSrc: logoSrc || `${appUrl}/favicon.svg`,
    supportEmail: supportEmail || `support@${new URL(appUrl).hostname}`,
    unsubscribeUrl: unsubscribeUrl ?? null,
  });
}
