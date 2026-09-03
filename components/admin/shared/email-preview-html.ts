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
import {
  emailLayout,
  emailHeading,
  emailProse,
  escapeHtml,
} from "@/lib/email/layout";

export { escapeHtml };

/**
 * An attribute the browser fetches on its own: src, srcset, background,
 * poster. Only http(s) values are matched, so an inlined `data:` image is
 * untouched (it is already in the document and costs no request).
 */
const REMOTE_SUBRESOURCE_ATTR =
  /(\s)(src|srcset|background|poster)(\s*=\s*["']?\s*https?:\/\/)/gi;

/** `url(https://...)` in a stylesheet or a style attribute. */
const REMOTE_CSS_URL = /url\(\s*(["']?)\s*https?:\/\/[^)"']*\1\s*\)/gi;

/** Whether anything in this document would reach the network to render. */
export function hasRemoteContent(html: string): boolean {
  // A fresh regex per call: a /g pattern reused through .test() carries
  // lastIndex between calls and alternates true/false on identical input.
  return (
    new RegExp(REMOTE_SUBRESOURCE_ATTR.source, "i").test(html) ||
    new RegExp(REMOTE_CSS_URL.source, "i").test(html)
  );
}

/**
 * Stop a previewed email fetching anything, before it is handed to a frame.
 *
 * A logged email is shown to the highest-privilege account in the product, and
 * a remote image in one is a beacon: opening the message would tell whoever
 * put the URL there the admin's IP address, their user agent, and the moment
 * they read it. That is the ordinary reason mail clients ship with remote
 * content off, and it applies here with more force, because the reader is an
 * administrator and the sender may be whoever filled in a contact form.
 *
 * The attribute is renamed rather than blanked, so the browser never sees a
 * `src` to load and there is no placeholder URL to reason about. The original
 * value stays in the markup under a `data-vr-blocked-` prefix, which is what
 * lets the viewer offer the unmodified document when an admin asks for it.
 */
export function blockRemoteContent(html: string): string {
  return html
    .replace(REMOTE_SUBRESOURCE_ATTR, "$1data-vr-blocked-$2$3")
    .replace(REMOTE_CSS_URL, "none");
}

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
  // emailHeading rather than a hand-written <h1>: the copy here was a
  // transcription of it that had drifted to font-weight 700, so an admin
  // previewed a heading heavier than any real message renders. The body
  // wrapper carries the same class hooks the layout's dark-mode rules target,
  // so the preview inverts the way a real message does.
  return emailLayout({
    content: `${emailHeading(safeTitle)}${emailProse(bodyHtml)}`,
    appName,
    appUrl,
    logoSrc: logoSrc || `${appUrl}/favicon.svg`,
    supportEmail: supportEmail || `support@${new URL(appUrl).hostname}`,
    unsubscribeUrl: unsubscribeUrl ?? null,
    title: title || undefined,
  });
}
