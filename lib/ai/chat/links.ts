import { APP_REPO } from "@/lib/config/client-constants";

/**
 * Which links in an assistant reply are rendered as links, and to what.
 *
 * Vera reads untrusted text: the evidence a scanner lifted from somebody's
 * page, a header a target chose to send. Text written to steer an assistant
 * can ask it to "cite" a URL with the reader's scan results or account
 * details folded into the path or query, and a link the reader clicks then
 * carries them to whoever wrote the page. Images were the silent version of
 * this and never render at all (message-content.tsx). Links need a click, but
 * a reply that looks helpful is exactly what gets clicked.
 *
 * So a link is clickable when it stays inside the app, or goes to a short list
 * of references Vera has a real reason to cite, and in both cases it loses
 * whatever it could carry data or an action in. Anything else is shown as its
 * text and full address, unlinked: readable and copyable, not one tap away.
 */

/**
 * Query parameters an in-app link keeps: the ones Vera has a reason to write
 * (open a scan, a profile tab). Every other one is dropped, because pages act
 * on their query string as soon as they load: /demo scans ?url=, /login
 * follows ?redirect= after signing in.
 */
const INTERNAL_PARAMS = new Set(["scan", "tab", "dtab", "view", "category"]);

/** Documentation hosts, matched exactly, over https only. */
const REFERENCE_HOSTS = new Set([
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

/**
 * GitHub only under our own organisation. The whole host is not a reference:
 * it serves OAuth consent pages and anybody's repository.
 */
const GITHUB_OWNER = APP_REPO.split("/")[0]?.toLowerCase() ?? "";

export type ChatLink =
  | { kind: "internal"; href: string }
  | { kind: "reference"; href: string }
  | { kind: "plain"; href: string };

function internalHref(url: URL): string | null {
  // Every check below runs on the parsed path, which is also exactly what is
  // written out, so nothing can be normalised past a check after it ran.
  // Parsing resolves dot segments ("/.//attacker.example" comes back as the
  // path "//attacker.example") and turns backslashes into slashes, and a path
  // that starts with "//" is another host to a browser. That is shown as
  // plain text rather than rewritten into something else.
  const path = url.pathname;
  if (path.startsWith("//")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path).toLowerCase();
  } catch {
    return null;
  }
  // An API path is not a page, and a GET to one can do something. Checked
  // decoded, since "/%61pi/..." is the same route.
  if (decoded === "/api" || decoded.startsWith("/api/")) return null;
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams)
    if (INTERNAL_PARAMS.has(key)) kept.append(key, value);
  const query = kept.toString();
  return `${path}${query ? `?${query}` : ""}${url.hash}`;
}

function isReference(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  if (url.hostname === "github.com") {
    const owner = url.pathname.split("/")[1]?.toLowerCase() ?? "";
    return GITHUB_OWNER !== "" && owner === GITHUB_OWNER;
  }
  return REFERENCE_HOSTS.has(url.hostname);
}

export function classifyChatLink(
  href: string | undefined,
  appOrigin: string,
): ChatLink {
  const raw = (href ?? "").trim();
  const plain: ChatLink = { kind: "plain", href: raw };

  // A path inside the app: /history?scan=..., /checks/hsts-missing.
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) {
    let url: URL;
    try {
      url = new URL(raw, "https://app.invalid");
    } catch {
      return plain;
    }
    if (url.origin !== "https://app.invalid") return plain;
    const inApp = internalHref(url);
    return inApp ? { kind: "internal", href: inApp } : plain;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return plain;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return plain;
  if (appOrigin && url.origin === appOrigin) {
    const inApp = internalHref(url);
    return inApp ? { kind: "internal", href: inApp } : plain;
  }
  if (isReference(url)) {
    // The query is the one part of a documentation link a page cannot need
    // and a payload can: the path names the page, the fragment never leaves
    // the browser.
    return {
      kind: "reference",
      href: `${url.origin}${url.pathname}${url.hash}`,
    };
  }
  return plain;
}
