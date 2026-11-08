/**
 * The one answer to "whose resource is this, and could a hash pin it?", for
 * every Subresource Integrity detector.
 *
 * Each detector used to answer that for itself, and they disagreed. None of
 * the legacy ones compared the resource with the page, so a site writing its
 * own assets as absolute URLs was told to hash its own files. One decided
 * "CDN" with a substring test on the hostname, so `stripecdn.com` counted
 * because it contains `cdn.`. And the exempt list was shared by some detectors
 * and not others, so the same Maps script was fine in one finding and a
 * problem in the next.
 */

import { pluralize } from "@/lib/ui/plural";
import { startTagAttributes } from "../html/tokenizer";
import { extractRootDomain } from "../root-domain";
import { tagsWith } from "./_tag-scan";

export type SubresourceClass =
  /** Same scheme, host and port. A written-out default port normalises away. */
  | "same-origin"
  /** The same site on another subdomain, scheme or port. */
  | "same-site"
  /** A vendor that changes the file on purpose, so no hash could stay valid. */
  | "exempt-vendor"
  /** A public library CDN URL that names an exact version: a hash would hold. */
  | "library-cdn-pinned"
  /** Everything else. */
  | "third-party";

// Hosts that intentionally serve scripts/stylesheets without SRI support:
// content is mutable server-side by design (analytics/payment/CAPTCHA
// providers push updates without notice), so pinning a hash would break the
// integration. Google Fonts and Typekit answer each browser with different
// CSS for the same URL, which no single hash can match.
export const SRI_EXEMPT_HOSTS: ReadonlySet<string> = new Set([
  "js.stripe.com",
  "checkout.stripe.com",
  "www.googletagmanager.com",
  "googletagmanager.com",
  "www.google-analytics.com",
  "google-analytics.com",
  "www.google.com",
  "www.gstatic.com",
  "googlesyndication.com",
  "pagead2.googlesyndication.com",
  "fonts.googleapis.com",
  "maps.googleapis.com",
  "maps.gstatic.com",
  "apis.google.com",
  "www.recaptcha.net",
  "challenges.cloudflare.com",
  "js.hcaptcha.com",
  "widget.intercom.io",
  "js.intercomcdn.com",
  "www.paypalobjects.com",
  "connect.facebook.net",
  "cdn.segment.com",
  "static.hotjar.com",
  "snap.licdn.com",
  "use.typekit.net",
]);

/**
 * Registrable domains whose subdomains belong to different customers.
 * extractRootDomain has no public suffix list, so without this
 * `a.blogspot.com` and `b.blogspot.com` read as one site.
 */
const SHARED_HOSTING_SUFFIXES: ReadonlySet<string> = new Set([
  "amazonaws.com",
  "appspot.com",
  "azureedge.net",
  "azurewebsites.net",
  "b-cdn.net",
  "blogspot.com",
  "cloudfront.net",
  "deno.dev",
  "firebaseapp.com",
  "fly.dev",
  "github.io",
  "gitlab.io",
  "glitch.me",
  "great-site.net",
  "herokuapp.com",
  "jimdofree.com",
  "jimdosite.com",
  "myshopify.com",
  "netlify.app",
  "ngrok-free.app",
  "ngrok.io",
  "now.sh",
  "onrender.com",
  "pages.dev",
  "r2.dev",
  "repl.co",
  "replit.app",
  "surge.sh",
  "vercel.app",
  "web.app",
  "webflow.io",
  "wixsite.com",
  "wordpress.com",
  "workers.dev",
]);

/**
 * `com.sg`, `co.id`, `org.tr`: a public second level that extractRootDomain's
 * short table does not list, and so returns as if it were someone's domain.
 */
const COUNTRY_SECOND_LEVEL = /^(?:ac|co|com|edu|gov|ne|net|or|org)\.[a-z]{2}$/;

function registrableDomain(host: string): string {
  const root = extractRootDomain(host);
  return COUNTRY_SECOND_LEVEL.test(root)
    ? host.split(".").slice(-3).join(".")
    : root;
}

function isIpLiteral(host: string): boolean {
  return host.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function isSameSite(a: string, b: string): boolean {
  const withoutWww = (host: string) => host.replace(/^www\./, "");
  if (withoutWww(a) === withoutWww(b)) return true;
  // The last two labels of an address are not a domain.
  if (isIpLiteral(a) || isIpLiteral(b)) return false;
  const site = registrableDomain(a);
  return (
    site.includes(".") &&
    site === registrableDomain(b) &&
    !SHARED_HOSTING_SUFFIXES.has(site)
  );
}

/** Whole hostnames, so `evilunpkg.com` and `unpkg.com.evil.net` are not these. */
const LIBRARY_CDN_HOST =
  /^(?:cdnjs\.cloudflare\.com|unpkg\.com|ajax\.googleapis\.com|code\.jquery\.com|(?:[a-z0-9-]+\.)?(?:jsdelivr\.net|bootstrapcdn\.com))$/;

/** Where the version is written `package@version`, and only `@` says so. */
const NPM_STYLE_CDN_HOST = /^(?:unpkg\.com|(?:[a-z0-9-]+\.)?jsdelivr\.net)$/;

/**
 * An exact `@x.y.z` that ends its path segment. A version anywhere else in the
 * path is not one: `/npm/thing@latest/dist-1.2.3/a.js` still moves, and
 * `/npm/widget-1.2.3/a.js` is a package name that resolves to newest.
 */
const EXACT_AT_VERSION =
  /@v?\d{1,9}\.\d{1,9}\.\d{1,9}(?:[-+][\w.+-]*)?(?:\/|$)/;

/** `/jquery/3.7.1/`, `/jquery-3.7.1.min.js`. Not `/jquery/3/` or `-latest`. */
const EXACT_PATH_VERSION = /[/-]v?\d{1,9}\.\d{1,9}\.\d{1,9}(?!\d)/;

function isPinnedLibraryCdn(url: URL): boolean {
  if (!LIBRARY_CDN_HOST.test(url.hostname)) return false;
  return (
    NPM_STYLE_CDN_HOST.test(url.hostname)
      ? EXACT_AT_VERSION
      : EXACT_PATH_VERSION
  ).test(url.pathname);
}

/** `rawUrl` resolved against the page, or null unless it is fetched over HTTP. */
function resolveHttpUrl(rawUrl: string, pageUrl: string): URL | null {
  try {
    const url = new URL(rawUrl, pageUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Classify a resource as a page references it. Null for anything that has no
 * origin to reason about: a `data:` URI, an unparseable URL.
 *
 * The page's own site is decided first, so a vendor scanned on its own domain
 * is judged like any other site's first-party assets.
 */
export function classifySubresource(
  rawUrl: string,
  pageUrl: string,
): SubresourceClass | null {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return null;
  }
  const url = resolveHttpUrl(rawUrl, page.href);
  if (!url) return null;
  if (url.origin === page.origin) return "same-origin";
  if (isSameSite(url.hostname, page.hostname)) return "same-site";
  if (SRI_EXEMPT_HOSTS.has(url.hostname)) return "exempt-vendor";
  if (isPinnedLibraryCdn(url)) return "library-cdn-pinned";
  return "third-party";
}

/** Whether a resource of this class is worth reporting for having no hash. */
export function needsIntegrity(cls: SubresourceClass | null): boolean {
  return cls === "library-cdn-pinned" || cls === "third-party";
}

const MAX_NAMED_URLS = 3;
const MAX_URL_CHARS = 200;

/**
 * Finding text that names the resources. A bare count gave a reader, and the
 * verifier, nothing to judge: the same finding was true on a pinned jsDelivr
 * library and got marked a false positive because no URL was in sight.
 */
export function integrityGapEvidence(noun: string, urls: string[]): string {
  const named = urls
    .slice(0, MAX_NAMED_URLS)
    .map((u) =>
      u.length > MAX_URL_CHARS ? `${u.slice(0, MAX_URL_CHARS)}...` : u,
    )
    .join(", ");
  const rest = urls.length - MAX_NAMED_URLS;
  return `${pluralize(urls.length, noun)} without integrity: ${named}${rest > 0 ? ` and ${rest} more` : ""}`;
}

/**
 * Absolute URLs, without repeats, of the scripts a page loads from a pinned
 * library CDN with no integrity hash. For the detectors that see only the
 * body, so each attribute is read whole: `data-src` is not `src`.
 */
export function pinnedCdnScriptsWithoutIntegrity(
  body: string,
  pageUrl: string,
): string[] {
  const found = new Set<string>();
  for (const tag of tagsWith(body, "script", /[\s/]src\s*=/i)) {
    const attrs = startTagAttributes(tag);
    if (!attrs.src || attrs.integrity?.trim()) continue;
    if (classifySubresource(attrs.src, pageUrl) !== "library-cdn-pinned") {
      continue;
    }
    const url = resolveHttpUrl(attrs.src, pageUrl);
    if (url) found.add(url.href);
  }
  return [...found];
}
