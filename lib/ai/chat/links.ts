/**
 * Which links in an assistant reply are rendered as links.
 *
 * Vera reads untrusted text: the evidence a scanner lifted from somebody's
 * page, a header a target chose to send. Text written to steer an assistant
 * can ask it to "cite" a URL with the reader's scan results or account
 * details folded into the path or query, and a link the reader clicks then
 * carries them to whoever wrote the page. Images were the silent version of
 * this and never render at all (message-content.tsx). Links need a click, but
 * a reply that looks helpful is exactly what gets clicked.
 *
 * So a link is clickable when it stays inside the app, or goes to a host on a
 * short list of references Vera has a real reason to cite. Anything else is
 * shown as its text and full address, unlinked: still readable and copyable,
 * just not one tap away.
 */

const REFERENCE_HOSTS = new Set([
  "github.com",
  "developer.mozilla.org",
  "owasp.org",
  "cheatsheetseries.owasp.org",
  "cwe.mitre.org",
  "nvd.nist.gov",
  "www.rfc-editor.org",
  "datatracker.ietf.org",
  "hstspreload.org",
  "web.dev",
  "nginx.org",
  "httpd.apache.org",
  "caddyserver.com",
  "letsencrypt.org",
  "certbot.eff.org",
  "nextjs.org",
  "expressjs.com",
  "docs.docker.com",
]);

export type ChatLink =
  | { kind: "internal"; href: string }
  | { kind: "reference"; href: string }
  | { kind: "plain"; href: string };

export function classifyChatLink(
  href: string | undefined,
  appOrigin: string,
): ChatLink {
  const raw = (href ?? "").trim();
  // A path inside the app: /history?scan=..., /checks/hsts-missing.
  if (raw.startsWith("/") && !raw.startsWith("//"))
    return { kind: "internal", href: raw };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "plain", href: raw };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { kind: "plain", href: raw };
  if (url.origin === appOrigin) return { kind: "internal", href: url.href };
  if (url.protocol === "https:" && REFERENCE_HOSTS.has(url.hostname))
    return { kind: "reference", href: url.href };
  return { kind: "plain", href: raw };
}
