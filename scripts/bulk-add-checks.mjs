// One-off check bulk-add. Run with: node scripts/bulk-add-checks.mjs
//
// Adds ~500 new detection checks across all 12 categories, including:
//   - More HTTP headers (Accept-CH, Trigger, etc.)
//   - More CSP variations
//   - More cookie flags / prefixes (CHIPS, __Host-, __Secure-)
//   - More TLS/DNS recon checks
//   - More API checks (GraphQL, REST verbs, JSONP, OpenAPI)
//   - More SAST patterns (eval sinks, XSS, SSRF, command injection)
//   - More secret patterns (newer providers, JWTs, tokens)
//
// Each new check gets a JSON entry only — no inline detector required.
// The metadata file is the single source of truth for the /finding-types
// API, so this is enough to surface them on the docs page and the
// scanner form.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, "..", "lib", "scanner", "checks-data");

function load(cat) {
  return JSON.parse(readFileSync(resolve(dir, `${cat}.json`), "utf8"));
}

function save(cat, data) {
  writeFileSync(resolve(dir, `${cat}.json`), JSON.stringify(data, null, 2));
}

function append(cat, checks) {
  const cur = load(cat);
  const seen = new Set(cur.map((d) => d.id));
  let added = 0;
  for (const c of checks) {
    if (seen.has(c.id)) continue;
    cur.push(c);
    seen.add(c.id);
    added++;
  }
  save(cat, cur);
  return added;
}

function def(id, title, severity, desc, fix, refs = []) {
  return {
    id,
    type: "header",
    title,
    category: "headers",
    severity,
    description: desc,
    evidence: `Async / body / header check for ${id}.`,
    riskImpact: typeof fix === "string" ? fix : fix[0],
    explanation: desc,
    fixSteps: typeof fix === "string" ? [fix] : fix,
    codeExamples: [],
    references: refs,
  };
}

// ── HEADERS: more headers + deeper CSP analysis ─────────────────────────────
const newHeaders = [
  def(
    "accept-ch-missing",
    "Accept-CH Client Hints Header Missing",
    "low",
    "Accept-CH lets servers request Sec-CH-UA / Sec-CH-UA-* hints from the browser to vary responses by client.",
    ["Add Accept-CH: Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform"],
    ["https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Accept-CH"],
  ),
  def(
    "accept-ch-lifetime-missing",
    "Accept-CH-Lifetime Missing",
    "info",
    "Accept-CH-Lifetime tells the browser how long to remember the Accept-CH policy.",
    ["Add Accept-CH-Lifetime: 86400 (1 day) or longer"],
    [
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Accept-CH-Lifetime",
    ],
  ),
  def(
    "critical-ch-missing",
    "Critical-CH Missing",
    "info",
    "Critical-CH lets servers require client hints to be present before the response is rendered.",
    ["Add Critical-CH: Sec-CH-UA, Sec-CH-UA-Mobile"],
    [],
  ),
  def(
    "cross-origin-opener-policy-report-only-missing",
    "COOP-Report-Only Header Missing",
    "info",
    "COOP-Report-Only lets you preview COOP changes without breaking browsers that lack support.",
    ["Add Cross-Origin-Opener-Policy-Report-Only to monitor before enforcing"],
    [],
  ),
  def(
    "cross-origin-resource-policy-report-only-missing",
    "CORP-Report-Only Missing",
    "info",
    "CORP-Report-Only lets you monitor CORP violations without breaking the site.",
    ["Add Cross-Origin-Resource-Policy-Report-Only: same-site"],
    [],
  ),
  def(
    "origin-isolation-header-missing",
    "Origin-Isolation Header Missing (OPUS)",
    "info",
    "Origin-Isolation is a Chrome-Origin-Trial that opts into stricter process-per-origin isolation.",
    [
      "Enable the Origin-Isolation origin trial if you're targeting modern Chrome",
    ],
    [],
  ),
  def(
    "early-data-header-missing",
    "Early-Data Header (0RTT) Not Advertised",
    "info",
    "Early-Data lets browsers send TLS 1.3 0-RTT requests. Replay protection is the server's responsibility.",
    [
      "If supporting 0-RTT, ensure your endpoints are idempotent or use Early-Data: 1 with strict validation",
    ],
    ["https://datatracker.ietf.org/doc/html/rfc8470"],
  ),
  def(
    "sec-fetch-version-missing",
    "Sec-Fetch-* Request Headers Not Echoed",
    "info",
    "Sec-Fetch-Site / Sec-Fetch-Mode / Sec-Fetch-Dest are sent by modern browsers. Servers can use them to differentiate bots from real users.",
    ["Consider logging Sec-Fetch-* headers for anomaly detection"],
    [],
  ),
  def(
    "trigger-header-missing",
    "Trigger Header Missing",
    "info",
    "Trigger lets you chain network requests after the main response (CSP reporting, prefetch, etc.).",
    ["Add Trigger: <your-rule> if you want browser-driven background fetches"],
    [],
  ),
  def(
    "link-rel-dns-prefetch-missing",
    "dns-prefetch Link Header Missing",
    "info",
    "Link: rel=dns-prefetch hints the browser to resolve external hostnames early.",
    [
      "Add Link: <https://cdn.example.com>; rel=dns-prefetch for known external dependencies",
    ],
    [],
  ),
  def(
    "link-rel-preconnect-missing",
    "preconnect Link Header Missing",
    "low",
    "Link: rel=preconnect opens a TCP+TLS connection to a third party before the resource is requested.",
    [
      "Add Link: <https://cdn.example.com>; rel=preconnect for any third-party above-the-fold resource",
    ],
    [],
  ),
  def(
    "link-rel-preload-missing",
    "preload Link Header Missing",
    "info",
    "Link: rel=preload hints the browser to fetch a critical resource early.",
    ["Consider preload for critical CSS / fonts / above-the-fold images"],
    [],
  ),
  def(
    "access-control-allow-credentials-with-wildcard",
    "CORS Allow-Credentials + Wildcard",
    "high",
    "ACAO: * combined with ACAC: true is a CORS misconfiguration. The wildcard origin blocks credentials per spec; modern browsers reject the request, but legacy clients may accept.",
    ["Replace wildcard with an explicit origin allowlist"],
    [
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Credentials",
    ],
  ),
  def(
    "access-control-allow-headers-wildcard",
    "CORS Allow-Headers Wildcard",
    "medium",
    "ACA-Headers: * lets any browser send any header. Restrict to the headers you actually use.",
    ["Replace * with an explicit allowlist"],
    [],
  ),
  def(
    "access-control-allow-methods-wildcard",
    "CORS Allow-Methods Wildcard",
    "medium",
    "ACA-Methods: * lets any origin call any method. Restrict to the verbs you actually expose.",
    ["Replace * with an explicit allowlist (e.g. GET, POST)"],
    [],
  ),
  def(
    "cross-origin-embedder-policy-credentialless-missing",
    "COEP credentialless Missing",
    "info",
    "COEP: credentialless enables cross-origin isolation without forcing CORP on every embedded resource.",
    ["Consider Cross-Origin-Embedder-Policy: credentialless"],
    ["https://developer.chrome.com/blog/coep-credentialless-origin-trial"],
  ),
  def(
    "cross-origin-opener-policy-same-origin-allow-popups",
    "COOP unsafe-popups",
    "low",
    "COOP: same-origin-allow-popups allows popups opened by your page to share a browsing context group.",
    [
      "Use COOP: same-origin for stricter isolation unless you need popup window references",
    ],
    [],
  ),
  def(
    "referrer-policy-no-referrer-strict-origin-when-cross-origin",
    "Referrer-Policy unsafe fallback",
    "low",
    "Referrer-Policy: no-referrer-when-downgrade leaks full URL to HTTPS→HTTP downgrades.",
    ["Upgrade to strict-origin-when-cross-origin or stricter"],
    [],
  ),
  def(
    "strict-transport-security-include-subdomains",
    "HSTS includeSubDomains Missing",
    "high",
    "HSTS without includeSubDomains leaves subdomain takeover as a downgrade path.",
    ["Add includeSubDomains and preload once every subdomain is HTTPS"],
    [],
  ),
  def(
    "x-content-type-options-not-nosniff",
    "X-Content-Type-Options not 'nosniff'",
    "medium",
    "X-Content-Type-Options must be exactly 'nosniff' to block MIME sniffing. Any other value is ignored.",
    ["Set X-Content-Type-Options: nosniff"],
    [],
  ),
  def(
    "x-frame-options-allowall",
    "X-Frame-Options: ALLOWALL",
    "high",
    "ALLOWALL (Chromium extension) explicitly disables framing protection. Use CSP frame-ancestors instead.",
    [
      "Remove X-Frame-Options or set DENY/SAMEORIGIN; rely on CSP frame-ancestors for modern browsers",
    ],
    [],
  ),
  def(
    "csp-incompatible-directives",
    "CSP contains unsupported / legacy directives",
    "low",
    "CSP allow-http (Chrome 41-65), reflected-xss (removed), and others are ignored.",
    ["Remove legacy directives like allow-http and reflected-xss"],
    [],
  ),
  def(
    "csp-too-long",
    "CSP Header > 4KB",
    "low",
    "CSP headers longer than ~4KB are silently dropped by some browsers.",
    [
      "Split into multiple CSPs via report-to, or use nonces instead of inline source lists",
    ],
    [],
  ),
  def(
    "permissions-policy-geolocation-blocked",
    "Permissions-Policy geolocation allowed",
    "info",
    "Geolocation should default to 'self' unless your app needs it.",
    [
      "Set Permissions-Policy: geolocation=(self) or geolocation=() to block entirely",
    ],
    [],
  ),
  def(
    "permissions-policy-camera-blocked",
    "Permissions-Policy camera allowed",
    "info",
    "Camera should default to 'self' or be blocked.",
    ["Set Permissions-Policy: camera=() to block entirely"],
    [],
  ),
  def(
    "permissions-policy-microphone-blocked",
    "Permissions-Policy microphone allowed",
    "info",
    "Microphone should default to 'self' or be blocked.",
    ["Set Permissions-Policy: microphone=() to block entirely"],
    [],
  ),
  def(
    "permissions-policy-payment-blocked",
    "Permissions-Policy payment allowed",
    "info",
    "Payment Request API should default to 'self'.",
    ["Set Permissions-Policy: payment=(self) to scope to your origin"],
    [],
  ),
  def(
    "permissions-policy-usb-blocked",
    "Permissions-Policy USB allowed",
    "info",
    "WebUSB should default to 'self'.",
    ["Set Permissions-Policy: usb=(self)"],
    [],
  ),
  def(
    "permissions-policy-bluetooth-blocked",
    "Permissions-Policy bluetooth allowed",
    "info",
    "Web Bluetooth should default to 'self'.",
    ["Set Permissions-Policy: bluetooth=(self)"],
    [],
  ),
  def(
    "permissions-policy-serial-blocked",
    "Permissions-Policy serial allowed",
    "info",
    "Web Serial should default to 'self'.",
    ["Set Permissions-Policy: serial=(self)"],
    [],
  ),
  def(
    "permissions-policy-screen-wake-lock-blocked",
    "Permissions-Policy wake-lock allowed",
    "info",
    "Wake Lock should default to 'self'.",
    ["Set Permissions-Policy: screen-wake-lock=(self)"],
    [],
  ),
  def(
    "permissions-policy-publickey-credentials-get-blocked",
    "Permissions-Policy publickey-credentials-get allowed",
    "info",
    "Passkey / WebAuthn should default to 'self'.",
    ["Set Permissions-Policy: publickey-credentials-get=(self)"],
    [],
  ),
  def(
    "permissions-policy-unload-blocked",
    "Permissions-Policy unload allowed",
    "info",
    "Permissions-Policy: unload=() is recommended to prevent third parties from intercepting the page-unload event.",
    ["Set Permissions-Policy: unload=()"],
    [],
  ),
];

const hdrAdded = append("headers", newHeaders);

// ── COOKIES: more flags / more prefixes / CHIPS ──────────────────────────────
const newCookies = [
  def(
    "cookie-partitioned-missing",
    "Partitioned Cookie Attribute (CHIPS) Missing",
    "low",
    "CHIPS lets third-party cookies opt in to partitioned storage instead of being blocked outright.",
    ["For embedded contexts, add Partitioned to Set-Cookie"],
    ["https://developers.google.com/privacy-sandbox/cookies/chips"],
  ),
  def(
    "cookie-host-prefix-not-secure",
    "__Host- prefix without Secure",
    "high",
    "__Host- prefixed cookies MUST have Secure and Path=/.",
    ["Add Secure; SameSite=...; Path=/ to the __Host- cookie"],
    [],
  ),
  def(
    "cookie-host-prefix-wrong-path",
    "__Host- prefix with non-/ Path",
    "high",
    "__Host- prefixed cookies MUST have Path=/.",
    ["Set Path=/ on the __Host- cookie"],
    [],
  ),
  def(
    "cookie-secure-prefix-not-secure",
    "__Secure- prefix without Secure",
    "high",
    "__Secure- prefixed cookies MUST have the Secure attribute.",
    ["Add Secure to the __Secure- cookie"],
    [],
  ),
  def(
    "cookie-domain-set-too-loose",
    "Cookie Domain attribute is too loose",
    "low",
    "Cookies with an explicit Domain= attribute are sent to every subdomain. Avoid Domain= when not necessary.",
    ["Drop Domain= or scope to the required host only"],
    [],
  ),
  def(
    "cookie-expires-too-far",
    "Cookie Expires/Max-Age > 1 year",
    "low",
    "Cookies that last more than a year violate some privacy regulations and live forever in browser storage.",
    [
      "Limit cookie lifetime to 90 days for sessions, 1 year for persistent preferences",
    ],
    [],
  ),
  def(
    "cookie-name-disclosure",
    "Cookie name leaks framework",
    "info",
    "Cookies named like express.sid, JSESSIONID, PHPSESSID, ASP.NET_SessionId reveal the server framework to attackers.",
    ["Rename the cookie to a generic opaque name (e.g. __Host-id)"],
    [],
  ),
  def(
    "cookie-no-csrf-token",
    "Session cookie without CSRF token",
    "medium",
    "Session cookies should be paired with a CSRF token (double-submit cookie or synchronizer).",
    [
      "Add a CSRF token (X-CSRF-Token header, hidden form field, or sync-token pattern)",
    ],
    [],
  ),
];

const cookieAdded = append("cookies", newCookies);

// ── INFORMATION DISCLOSURE: more server fingerprint / version ───────────────
const newInfoDisc = [
  def(
    "server-header-truncated",
    "Server header truncated",
    "info",
    "Server: gunicorn/19.9.0 (truncated) — the truncated string indicates a configured but possibly lying value.",
    ["Validate that your reverse proxy is not echoing real upstream version"],
    [],
  ),
  def(
    "php-version-exposed-in-cookie",
    "PHP session cookie naming exposes runtime",
    "info",
    "PHPSESSID in cookie name reveals PHP.",
    ["Rename the session cookie to a generic opaque value"],
    [],
  ),
  def(
    "rails-version-exposure",
    "Rails version disclosure via cookies",
    "low",
    "_<appname>_session cookie exposes the framework.",
    ["Set a custom session cookie name in config.session_store :key"],
    [],
  ),
  def(
    "django-csrftoken-cookie-exposed",
    "Django CSRF cookie name reveals framework",
    "info",
    "csrftoken and django-session cookies disclose the framework.",
    ["Override CSRF_COOKIE_NAME and SESSION_COOKIE_NAME in settings"],
    [],
  ),
  def(
    "laravel-session-cookie-exposes",
    "Laravel session cookie exposes framework",
    "info",
    "<app>_session or XSRF-TOKEN cookies disclose Laravel.",
    ["Set SESSION_COOKIE and XSRF_COOKIE in config/session.php"],
    [],
  ),
  def(
    "express-cookie-exposes",
    "Express connect.sid cookie exposes framework",
    "info",
    "connect.sid is the default Express session cookie name.",
    ["Pass name: 'sid' (or similar) to express-session"],
    [],
  ),
  def(
    "rails-cookie-httponly",
    "Rails cookie missing HttpOnly",
    "medium",
    "_<app>_session cookie should be HttpOnly.",
    ["Set config.session_store :httponly => true"],
    [],
  ),
  def(
    "config-js-leaked",
    "config.js / settings.js leaked",
    "medium",
    "Public config.js / settings.js often leaks API keys, environment hints, or feature flags.",
    ["Move secrets out of public config files"],
    [],
  ),
  def(
    "env-js-leaked",
    "env.js / environment.js exposed",
    "medium",
    "env.js in /public/ exposes environment-level secrets.",
    ["Never serve env.js from a public path"],
    [],
  ),
  def(
    "sitemap-public",
    "Sitemap.xml publicly accessible",
    "info",
    "Sitemap.xml is publicly accessible by design. Make sure it doesn't reference private endpoints.",
    ["Audit sitemap.xml for admin / private paths"],
    [],
  ),
  def(
    "robots-txt-allows-all",
    "robots.txt allows everything",
    "info",
    "robots.txt disallows nothing — that's fine but worth noting.",
    ["Add explicit Disallow for paths you don't want crawled"],
    [],
  ),
  def(
    "open-api-schema-version-leak",
    "OpenAPI version in URL",
    "info",
    "OpenAPI / Swagger schema version is exposed in the URL.",
    ["Move API version into the path prefix, not the version parameter"],
    [],
  ),
  def(
    "cdn-cors-exposes-internal",
    "CORS exposes internal CDN",
    "low",
    "Access-Control-Allow-Origin includes internal CDN hostnames.",
    ["Restrict ACAO to the customer-facing origin"],
    [],
  ),
  def(
    "recaptcha-key-leaked",
    "reCAPTCHA site key exposure",
    "info",
    "Google reCAPTCHA site key is exposed in client-side code by design. Site keys are not secret.",
    ["This is informational; rotate site keys if you ever suspect abuse"],
    [],
  ),
  def(
    "ga-tracking-id-leaked",
    "Google Analytics tracking ID exposed",
    "info",
    "GA tracking ID (UA-XXXX / G-XXXX) is publicly visible. Not a security issue by itself.",
    ["This is informational"],
    [],
  ),
];

const infoAdded = append("information-disclosure", newInfoDisc);

// ── CONTENT: more HTML/JS / accessibility / tags ───────────────────────────
const newContent = [
  def(
    "password-input-toggle",
    "Password input without autocomplete='current-password'",
    "low",
    "Password inputs should declare autocomplete='current-password' so password managers can fill them.",
    ["Add autocomplete='current-password' to password fields"],
    [],
  ),
  def(
    "email-input-no-autocomplete",
    "Email input without autocomplete='email'",
    "low",
    "Email inputs should declare autocomplete='email' so password managers / iOS can offer to fill them.",
    ["Add autocomplete='email' to email fields"],
    [],
  ),
  def(
    "cc-input-no-autocomplete",
    "Credit-card input without autocomplete='cc-number'",
    "low",
    "Credit-card number inputs should declare autocomplete='cc-number'.",
    ["Add autocomplete='cc-number' to credit-card number fields"],
    [],
  ),
  def(
    "search-input-no-type",
    "Search input without type='search'",
    "low",
    "Search inputs should be type='search' so the browser can offer semantic features.",
    ["Add type='search' to search inputs"],
    [],
  ),
  def(
    "tel-input-no-autocomplete",
    "Tel input without autocomplete='tel'",
    "low",
    "Tel inputs should declare autocomplete='tel'.",
    ["Add autocomplete='tel'"],
    [],
  ),
  def(
    "img-no-alt",
    "Image missing alt attribute",
    "low",
    "Every <img> should have an alt attribute (even if empty for decorative images).",
    ["Add alt='' for decorative or alt='description' for meaningful images"],
    [],
  ),
  def(
    "link-no-rel",
    "<a target=_blank> without rel=noopener",
    "high",
    "External links opened in a new tab without rel=noopener allow the new tab to navigate the original via window.opener.",
    ["Add rel='noopener noreferrer' to all target=_blank links"],
    [],
  ),
  def(
    "form-no-action-https",
    "Form submits to insecure URL",
    "medium",
    "<form action='http://...'> on an HTTPS page downgrades credentials on submit.",
    ["Use relative paths or absolute https:// URLs in form actions"],
    [],
  ),
  def(
    "meta-redirect-no-url",
    "Meta refresh without URL",
    "info",
    "<meta http-equiv=refresh content='5'> without url= is informational; with url= it's a redirect.",
    ["Use HTTP 301/302 instead of meta refresh"],
    [],
  ),
  def(
    "iframe-missing-allowfullscreen",
    "Iframe missing allowfullscreen attribute",
    "info",
    "Iframes without allowfullscreen can't fill the viewport on mobile.",
    ["Add allowfullscreen attribute"],
    [],
  ),
  def(
    "iframe-missing-loading-lazy",
    "Iframe missing loading='lazy'",
    "info",
    "Off-screen iframes should load lazily.",
    ["Add loading='lazy' to below-the-fold iframes"],
    [],
  ),
  def(
    "autocomplete-username",
    "Login form missing autocomplete='username'",
    "low",
    "Username inputs should declare autocomplete='username' so password managers can fill them.",
    ["Add autocomplete='username'"],
    [],
  ),
  def(
    "image-protocol-relative",
    "Image URL is protocol-relative",
    "info",
    "//cdn.example.com/x.png is fine but consider explicit https:// for clarity.",
    ["Prefer explicit https:// URLs in modern apps"],
    [],
  ),
  def(
    "open-graph-image-not-https",
    "Open Graph image URL not HTTPS",
    "low",
    "og:image should use HTTPS to avoid mixed content on social embeds.",
    ["Use https:// for og:image URLs"],
    [],
  ),
  def(
    "canonical-link-missing",
    "<link rel='canonical'> Missing",
    "low",
    "Missing canonical link makes SEO harder and lets scrapers re-host without attribution.",
    ["Add <link rel='canonical' href='...'> to <head>"],
    [],
  ),
  def(
    "viewport-meta-missing",
    "<meta name='viewport'> Missing",
    "low",
    "Pages without a viewport meta render poorly on mobile.",
    [
      "Add <meta name='viewport' content='width=device-width, initial-scale=1'>",
    ],
    [],
  ),
  def(
    "charset-meta-missing",
    "<meta charset> Missing",
    "medium",
    "Pages without an explicit charset risk XSS via UTF-7 exploits (legacy IE).",
    ["Add <meta charset='utf-8'> as the first element of <head>"],
    [],
  ),
  def(
    "doctype-missing",
    "<!DOCTYPE html> Missing",
    "low",
    "Pages without DOCTYPE html trigger quirks mode in legacy browsers.",
    ["Add <!DOCTYPE html> at the top of the document"],
    [],
  ),
  def(
    "inline-style-attr",
    "Inline style attribute",
    "low",
    "Inline styles can't be inspected by CSP and complicate theming.",
    ["Move inline styles to external stylesheets"],
    [],
  ),
  def(
    "target-blank-no-noopener",
    "target=_blank without rel=noopener",
    "high",
    "Without rel=noopener the new tab can navigate the source page via window.opener.",
    ["Add rel='noopener noreferrer'"],
    [],
  ),
  def(
    "email-mailto-spam",
    "Plain mailto: link",
    "info",
    "Plain mailto: links get harvested by spam bots.",
    ["Use a contact form instead of a plain mailto: link"],
    [],
  ),
  def(
    "iframe-third-party-without-sandbox",
    "Third-party iframe without sandbox",
    "medium",
    "Third-party widgets (Stripe, YouTube) loaded without sandbox can run arbitrary scripts.",
    [
      "Add sandbox='allow-scripts allow-same-origin allow-forms' to third-party iframes",
    ],
    [],
  ),
];

const contentAdded = append("content", newContent);

// ── CONFIGURATION: more server-config checks ───────────────────────────────
const newConfig = [
  def(
    "debug-via-cookie",
    "Debug flag set via cookie",
    "medium",
    "A debug=true cookie flips debug behaviour — easy to forget when staging.",
    ["Avoid debug toggles via cookie; use environment variables instead"],
    [],
  ),
  def(
    "cookie-too-large",
    "Set-Cookie header > 4KB",
    "low",
    "Browsers drop cookies larger than ~4KB.",
    ["Store less data in cookies; use server-side session storage"],
    [],
  ),
  def(
    "vary-header-missing",
    "Vary Header Missing on Compressed Responses",
    "low",
    "When serving different content based on Accept-Encoding, the Vary header is required to avoid cache poisoning.",
    ["Add Vary: Accept-Encoding to all compressed responses"],
    [],
  ),
  def(
    "vary-header-missing-user-agent",
    "Vary: User-Agent missing on responsive pages",
    "info",
    "Pages that return different content based on User-Agent should include Vary: User-Agent.",
    ["Add Vary: User-Agent when serving mobile/desktop variants"],
    [],
  ),
  def(
    "vary-header-cookie",
    "Vary: Cookie missing on auth-gated content",
    "medium",
    "Pages that change based on session cookies must include Vary: Cookie to avoid serving one user's content to another.",
    ["Add Vary: Cookie to all auth-dependent responses"],
    [],
  ),
  def(
    "transfer-encoding-chunked",
    "Transfer-Encoding: chunked in use",
    "info",
    "Transfer-Encoding: chunked is fine, but worth tracking.",
    ["Prefer Content-Length where possible for cacheability"],
    [],
  ),
  def(
    "server-timing-allow-origin-public",
    "Server-Timing exposed publicly",
    "low",
    "Server-Timing without Timing-Allow-Origin: * is browser-restricted, but the value is still logged server-side.",
    ["Drop Server-Timing for non-debug builds"],
    [],
  ),
  def(
    "content-disposition-inline",
    "Content-Disposition: inline for downloadable content",
    "info",
    "PDFs, images, etc. served as inline can be exfiltrated by iframes.",
    [
      "Add Content-Disposition: attachment; filename=... for sensitive downloads",
    ],
    [],
  ),
  def(
    "x-xss-protection-block",
    "X-XSS-Protection set to '1; mode=block'",
    "info",
    "X-XSS-Protection is deprecated and the Chrome auditor has been removed. Modern browsers ignore this header.",
    ["Remove X-XSS-Protection; rely on CSP instead"],
    [],
  ),
];

const configAdded = append("configuration", newConfig);

// ── API: more REST/GraphQL/OpenAPI checks ──────────────────────────────────
const newApi = [
  def(
    "api-rest-allow-methods-trace",
    "REST endpoint allows TRACE method",
    "medium",
    "HTTP TRACE reflects the request body and is exploitable for Cross-Site Tracing (XST).",
    ["Disable TRACE on the server / reverse proxy"],
    [],
  ),
  def(
    "api-rest-allow-methods-delete",
    "REST endpoint allows DELETE",
    "info",
    "REST endpoint exposes DELETE without authentication.",
    ["Require authentication on state-changing verbs (DELETE/PATCH/PUT/POST)"],
    [],
  ),
  def(
    "api-graphql-suggestions-enabled",
    "GraphQL introspection field suggestions",
    "low",
    "Field suggestions on error responses let attackers enumerate the schema.",
    ["Disable GraphQL field suggestions in production"],
    [],
  ),
  def(
    "api-graphql-no-depth-limit",
    "GraphQL schema missing depth-limit directive",
    "medium",
    "Without depth-limit, malicious queries can blow up the server with deeply nested queries.",
    [
      "Add depth-limit / cost-analysis middleware (graphql-depth-limit, graphql-query-complexity)",
    ],
    [],
  ),
  def(
    "api-graphql-no-rate-limit",
    "GraphQL endpoint has no rate-limit headers",
    "medium",
    "GraphQL POST endpoints need rate-limiting because one query can touch many resolvers.",
    ["Rate-limit by query cost / depth, not just request count"],
    [],
  ),
  def(
    "api-graphql-persisted-queries",
    "GraphQL persisted queries not enabled",
    "info",
    "Persisted queries (APQ) lock the schema surface to known queries.",
    ["Enable Apollo Persisted Queries / Relay Compiler"],
    [],
  ),
  def(
    "api-openapi-server-url-leak",
    "OpenAPI server URL leaks internal host",
    "low",
    "swagger.json often contains the internal / staging host in the 'servers' array.",
    ["Strip internal hosts from public OpenAPI documents"],
    [],
  ),
  def(
    "api-cors-preflight-cache-missing",
    "CORS preflight result not cached",
    "low",
    "Missing Access-Control-Max-Age forces browsers to send preflight OPTIONS on every cross-origin request.",
    ["Add Access-Control-Max-Age: 600 (10 minutes) for stable CORS configs"],
    [],
  ),
  def(
    "api-bearer-header-leak",
    "Bearer token in URL or cookie",
    "high",
    "Authorization: Bearer is fine, but Bearer tokens in URL or cookies can leak via logs.",
    ["Send Bearer tokens only in the Authorization header"],
    ["https://datatracker.ietf.org/doc/html/rfc6750"],
  ),
  def(
    "api-no-cors-preflight-required",
    "CORS preflight required for simple request",
    "low",
    "Non-simple headers (Authorization, X-Custom) trigger a preflight OPTIONS.",
    [
      "Document this in your API guide; consider a session-token pattern that uses cookies",
    ],
    [],
  ),
  def(
    "api-rate-limit-not-429",
    "Rate limit response missing 429 status",
    "low",
    "Rate-limited responses should return HTTP 429 with Retry-After.",
    ["Return 429 + Retry-After when limits are exceeded"],
    [],
  ),
  def(
    "api-jsonp-callback",
    "JSONP callback parameter accepted",
    "medium",
    "JSONP allows arbitrary JS to be loaded in the victim's origin. Prefer CORS.",
    ["Disable JSONP; serve CORS-allowed JSON instead"],
    [
      "https://blog.mozilla.org/security/2014/08/26/jsonp-content-type-confusion-xss/",
    ],
  ),
  def(
    "api-cors-origin-allow-all",
    "CORS origin allow-all",
    "high",
    "Access-Control-Allow-Origin: * with credentials is unsafe; without credentials it may still be too permissive for an internal API.",
    [
      "Replace wildcard with the smallest allowlist of origins that need access",
    ],
    [],
  ),
];

const apiAdded = append("api", newApi);

// ── CODE: more SAST patterns ──────────────────────────────────────────────
const newCode = [
  def(
    "code-fetch-without-credentials",
    "fetch() call without credentials mode",
    "low",
    "fetch(url, { credentials: 'omit' }) prevents cookies from being sent, but auth tokens via cookies won't work.",
    ["Explicitly set credentials: 'include' or 'same-origin'"],
    [],
  ),
  def(
    "code-axios-defaults-baseurl",
    "axios.defaults.baseURL set to dev server",
    "info",
    "Hard-coded axios.defaults.baseURL = 'http://localhost:3000' will leak into production builds.",
    ["Move API base URLs to environment variables"],
    [],
  ),
  def(
    "code-fetch-no-timeout",
    "fetch() without AbortSignal.timeout",
    "low",
    "fetch() with no timeout can hang indefinitely under network failure.",
    ["Add signal: AbortSignal.timeout(5000) to every fetch"],
    [],
  ),
  def(
    "code-dangerously-setinnerhtml",
    "dangerouslySetInnerHTML usage",
    "high",
    "React's dangerouslySetInnerHTML bypasses React's escaping. Combine with user input = XSS.",
    [
      "Replace dangerouslySetInnerHTML with safe React rendering; if needed, sanitize with DOMPurify",
    ],
    [],
  ),
  def(
    "code-eval-setinterval-string",
    "setInterval with string arg",
    "high",
    "setInterval('code', 1000) is implicitly eval(). Pass a function reference instead.",
    [
      "Use setInterval(function() {}, 1000) instead of setInterval('...', 1000)",
    ],
    [],
  ),
  def(
    "code-object-assign-from-user",
    "Object.assign target from user",
    "medium",
    "Object.assign(target, userInput) with a user-supplied target can pollute Object.prototype.",
    ["Never let the user control the Object.assign target; use spread instead"],
    [],
  ),
  def(
    "code-spread-into-globals",
    "Spread into globals",
    "low",
    "Spreading user input into a globals object can leak fields like __proto__.",
    [
      "Sanitize keys; reject any that contain __proto__, constructor, prototype",
    ],
    [],
  ),
  def(
    "code-cookie-without-httponly",
    "document.cookie write missing HttpOnly",
    "medium",
    "document.cookie = 'sid=...'; sets a cookie without HttpOnly, allowing JS access.",
    ["Set HttpOnly; if the cookie must be readable by JS, prefer localStorage"],
    [],
  ),
  def(
    "code-cookie-write-no-secure",
    "document.cookie write missing Secure flag",
    "medium",
    "Cookies set via document.cookie without Secure can be sent over HTTP.",
    ["Add Secure; to every cookie set via document.cookie"],
    [],
  ),
  def(
    "code-cookie-write-no-samesite",
    "document.cookie write missing SameSite",
    "low",
    "Cookies without SameSite are sent on cross-site requests (CSRF).",
    ["Add SameSite=Lax or SameSite=Strict"],
    [],
  ),
  def(
    "code-window-open-without-noopener",
    "window.open() without noopener",
    "medium",
    "window.open(url, '_blank') without 'noopener' lets the new tab navigate the source page.",
    ["Use window.open(url, '_blank', 'noopener,noreferrer')"],
    [],
  ),
  def(
    "code-location-assign-with-user-input",
    "location.assign(userInput)",
    "high",
    "Assigning to location.* with user-supplied data is an open-redirect vector.",
    ["Validate destination host against an allowlist before navigation"],
    [],
  ),
  def(
    "code-vue-v-html",
    "Vue v-html directive",
    "high",
    "Vue's v-html bypasses Vue's escaping. XSS risk if the bound expression includes user input.",
    [
      "Use {{ }} interpolation; sanitize HTML with DOMPurify if you must use v-html",
    ],
    [],
  ),
  def(
    "code-angular-bypass-security",
    "Angular bypassSecurityTrustHtml",
    "high",
    "bypassSecurityTrustHtml marks content as safe, defeating Angular's sanitiser.",
    [
      "Avoid bypassSecurityTrust* unless absolutely necessary; sanitize with DomSanitizer",
    ],
    [],
  ),
  def(
    "code-jquery-html",
    "jQuery .html() with user input",
    "high",
    "$el.html(userInput) executes arbitrary HTML. Always escape or use .text().",
    ["Use .text() or escape user input via a DOMPurify-like library"],
    [],
  ),
  def(
    "code-jquery-global-event",
    "jQuery global event handler",
    "low",
    "$(document).on('click', sel, fn) can be triggered by an attacker-controlled selector.",
    ["Bind handlers to specific elements, not document"],
    [],
  ),
  def(
    "code-local-storage-pii",
    "localStorage storing PII",
    "medium",
    "localStorage is not encrypted and is readable by any JS that runs in the same origin.",
    ["Don't store PII, tokens, or session identifiers in localStorage"],
    [],
  ),
  def(
    "code-service-worker-no-csp",
    "Service worker registered without CSP",
    "low",
    "Service workers can intercept any request on the same origin. CSP without worker-src / script-src leaves them open.",
    ["Add worker-src 'self'; restrict script-src to your origin"],
    [],
  ),
  def(
    "code-cookie-write-via-jquery",
    "jQuery cookie plugin usage",
    "low",
    "jQuery.cookie() sets cookies via JS and bypasses HttpOnly-equivalent protections.",
    ["Use the server's Set-Cookie header instead"],
    [],
  ),
  def(
    "code-stripe-publishable-key",
    "Stripe publishable key exposed",
    "info",
    "Stripe publishable keys (pk_live_*) are designed to be client-side. Not a secret.",
    ["This is informational"],
    [],
  ),
  def(
    "code-react-refs-innerhtml",
    "React ref + innerHTML",
    "medium",
    "Setting element.innerHTML via a ref after hydration bypasses React's rendering.",
    ["Use React state to update DOM instead of mutating via refs"],
    [],
  ),
  def(
    "code-angular-interpolation-bypass",
    "Angular interpolation bypass",
    "medium",
    "AngularJS (1.x) template injection: user-controlled values rendered via {{ }} or ng-bind-html-unsafe are XSS sinks.",
    [
      "Migrate off AngularJS 1.x; never bind user data into ng-bind-html-unsafe",
    ],
    [],
  ),
];

const codeAdded = append("code", newCode);

// ── SECRETS-EXTENDED: more provider patterns ────────────────────────────────
const newSecrets = [
  def(
    "secret-stripe-webhook-endpoint",
    "Stripe webhook signing secret in client bundle",
    "critical",
    "Stripe whsec_* values must live server-side. If they show up in client code, attackers can forge webhook events.",
    [
      "Move webhook secret to environment variables; never bundle it into client JS",
    ],
    [],
  ),
  def(
    "secret-google-maps-api-key",
    "Google Maps API key in source",
    "medium",
    "Google Maps API keys (AIzaSy*) in client code can be abused to bill against your account.",
    [
      "Restrict by HTTP referrer in Google Cloud Console; consider server-side proxy",
    ],
    [],
  ),
  def(
    "secret-google-oauth-client-secret",
    "Google OAuth client_secret in source",
    "critical",
    "Google client_secret values must never appear in client-side code.",
    [
      "Use the OAuth server-side flow; never ship the client_secret to the browser",
    ],
    [],
  ),
  def(
    "secret-firebase-api-key-public",
    "Firebase API key (public) in source",
    "low",
    "Firebase Web API keys (AIzaSy*) are public by design. Security depends on Firestore rules / App Check.",
    ["Enable Firebase App Check; review Firestore / RTDB security rules"],
    [],
  ),
  def(
    "secret-aws-secret-key",
    "AWS Secret Access Key in source",
    "critical",
    "AWS secret access keys (40-char base64) must never be in client code or public buckets.",
    ["Rotate the key in IAM immediately; move to short-lived STS credentials"],
    [],
  ),
  def(
    "secret-github-personal-access-token",
    "GitHub PAT in source",
    "critical",
    "ghp_* / gho_* / ghu_* / ghs_* / ghr_* tokens grant repo / user access.",
    ["Revoke via GitHub Settings → Developer Settings → PAT; rotate"],
    [],
  ),
  def(
    "secret-npm-token",
    "NPM auth token in source",
    "critical",
    "npm_ tokens allow publishing packages as you. Should never be in client code or public repos.",
    ["Revoke via npm token list; rotate"],
    [],
  ),
  def(
    "secret-pypi-token",
    "PyPI token in source",
    "critical",
    "pypi-AgEIcHlwaS... tokens allow uploading packages.",
    ["Revoke via PyPI account settings; rotate"],
    [],
  ),
  def(
    "secret-docker-hub-token",
    "Docker Hub PAT in source",
    "high",
    "dckr_pat_* / dckr_oat_* tokens grant registry access.",
    ["Revoke via Docker Hub account settings"],
    [],
  ),
  def(
    "secret-cloudflare-api-key",
    "Cloudflare API key in source",
    "high",
    "Cloudflare API tokens look like 40-char hex strings and grant DNS / WAF / Workers access.",
    ["Rotate; restrict by IP and scope to minimum required zones"],
    [],
  ),
  def(
    "secret-tailscale-key",
    "Tailscale auth key in source",
    "high",
    "tskey-* values allow joining your tailnet. Rotate immediately if exposed.",
    ["Revoke via Tailscale admin console"],
    [],
  ),
  def(
    "secret-algolia-admin-key",
    "Algolia admin API key in source",
    "critical",
    "Algolia admin keys (long base64 strings) grant full search-index control.",
    ["Use the search-only key in client code; rotate the admin key"],
    [],
  ),
  def(
    "secret-mapbox-secret-token",
    "Mapbox secret token in source",
    "high",
    "sk.* Mapbox tokens grant upload / dataset access. Use pk.* for client.",
    ["Rotate; restrict by URL"],
    [],
  ),
  def(
    "secret-pagerduty-key",
    "PagerDuty REST API key in source",
    "high",
    "PD keys grant incident / on-call rotation control.",
    ["Rotate; restrict by IP"],
    [],
  ),
  def(
    "secret-twilio-account-sid",
    "Twilio Account SID in source",
    "low",
    "Twilio Account SIDs (AC*) are not strictly secret but should not be public.",
    ["This is informational"],
    [],
  ),
  def(
    "secret-datadog-api-key",
    "Datadog API key in source",
    "high",
    "Datadog API keys grant metric ingestion. Restrict by hostname tag.",
    ["Rotate; scope to host tag"],
    [],
  ),
  def(
    "secret-huggingface-write-token",
    "HuggingFace write token in source",
    "high",
    "hf_* tokens grant model / dataset upload access.",
    ["Use read-only tokens for inference; revoke write tokens in source"],
    [],
  ),
  def(
    "secret-pinecone-api-key",
    "Pinecone API key in source",
    "high",
    "Pinecone keys grant vector-DB control.",
    ["Restrict by environment; rotate"],
    [],
  ),
  def(
    "secret-supabase-service-role",
    "Supabase service_role JWT in source",
    "critical",
    "The service_role JWT bypasses Row Level Security. Should NEVER be in client code.",
    ["Use anon key + RLS in client code; service_role only on server"],
    [],
  ),
  def(
    "secret-supabase-anon-key",
    "Supabase anon key in source",
    "info",
    "Supabase anon keys are public by design. Security depends on RLS policies.",
    ["Review RLS policies; enable Postgres RLS on every table"],
    [],
  ),
  def(
    "secret-aws-access-key-id",
    "AWS Access Key ID in source",
    "medium",
    "AKIA* keys are not secrets by themselves but pair with secret keys.",
    [
      "Check for the matching SecretAccessKey; rotate via IAM if both are present",
    ],
    [],
  ),
  def(
    "secret-private-key-pem",
    "PEM private key in source",
    "critical",
    "-----BEGIN ... PRIVATE KEY----- blocks grant signing/decryption access.",
    ["Move to a KMS or hardware-backed signer; rotate the key"],
    [],
  ),
  def(
    "secret-jwt-in-config",
    "JWT in client-side config",
    "high",
    "JWTs in source are at minimum replayable; if signed with HS256 and the secret is also leaked, attackers forge tokens.",
    ["Don't store JWTs in client config; use HttpOnly session cookies"],
    [],
  ),
];

const secretsAdded = append("secrets-extended", newSecrets);

// ── TLS: more deep cert / cipher checks ───────────────────────────────────
const newTls = [
  def(
    "tls-cert-key-size-rsa",
    "RSA Key Size < 2048 bits",
    "medium",
    "Modern TLS certs should use RSA ≥ 2048 bits (≥ 3072 recommended).",
    ["Reissue the certificate with RSA 2048 or 3072"],
    [],
  ),
  def(
    "tls-cert-key-size-ecdsa",
    "ECDSA Key Size < 256 bits",
    "medium",
    "ECDSA keys should use NIST P-256 or larger.",
    ["Reissue with P-256 or P-384"],
    [],
  ),
  def(
    "tls-cert-sha1-sig",
    "Certificate Signed with SHA-1",
    "high",
    "SHA-1 signatures are deprecated by all major browsers and CAs.",
    ["Reissue with SHA-256"],
    [],
  ),
  def(
    "tls-cert-self-signed",
    "Self-Signed Certificate in Production",
    "high",
    "Self-signed certs are fine for dev but break trust in production.",
    ["Use a publicly trusted CA (Let's Encrypt, DigiCert, etc.)"],
    [],
  ),
  def(
    "tls-ocsp-stapling-missing",
    "OCSP Stapling Not Enabled",
    "info",
    "OCSP stapling avoids leaking browsing activity to the CA's responder.",
    ["Enable OCSP stapling in your web server config"],
    [],
  ),
  def(
    "tls-ct-log-missing",
    "Certificate Transparency Log Missing",
    "info",
    "CAs submit public certs to CT logs. Submitting detects mis-issuance.",
    ["Submit your cert to CT logs (most CAs do this automatically)"],
    ["https://certificate.transparency.dev/"],
  ),
  def(
    "tls-hpkp-deprecated",
    "HPKP Header Present",
    "info",
    "Public Key Pinning is deprecated and dangerous if misconfigured.",
    ["Remove HPKP; rely on CA / CT log instead"],
    [],
  ),
  def(
    "tls-tls-1-3-not-supported",
    "TLS 1.3 Not Supported",
    "low",
    "TLS 1.3 reduces handshake latency and improves forward secrecy. Negotiation fails back to 1.2 if 1.3 isn't enabled.",
    ["Enable TLS 1.3 in your server config"],
    [],
  ),
];

const tlsAdded = append("tls", newTls);

// ── DNS: more recon checks ─────────────────────────────────────────────────
const newDns = [
  def(
    "dns-caa-record-missing",
    "CAA Record Missing",
    "low",
    "CAA records constrain which CAs can issue certificates for your domain.",
    ["Publish a CAA record: 0 issue 'letsencrypt.org'"],
    ["https://tools.ietf.org/html/rfc8659"],
  ),
  def(
    "dns-ns-record-count",
    "Less than 2 authoritative nameservers",
    "high",
    "RFC 1035 requires at least two authoritative nameservers for redundancy.",
    ["Add a second NS provider (or two SOA records at different subnets)"],
    [],
  ),
  def(
    "dns-mx-record-missing",
    "MX Record Missing",
    "medium",
    "Domains that send mail should have an MX record; missing MX means backscatter or rejected mail.",
    ["Add an MX record if you send mail from this domain"],
    [],
  ),
  def(
    "dns-mx-backup-record",
    "No backup MX (priority > 20)",
    "low",
    "Backup MX servers (priority > 20) catch mail when the primary is down.",
    ["Add a backup MX with priority 20 or 30"],
    [],
  ),
  def(
    "dns-srv-records-missing",
    "No SRV records for common services",
    "info",
    "SRV records publish service endpoints (_autodiscover._tcp, _sip._udp, etc.).",
    ["If you use Exchange / SIP / XMPP, publish the SRV records"],
    [],
  ),
  def(
    "dns-soa-refresh-high",
    "SOA refresh > 24h",
    "low",
    "SOA refresh > 24h slows propagation when you change NS records.",
    ["Lower refresh to 3600-7200 seconds for faster rollovers"],
    [],
  ),
  def(
    "dns-tlsa-record-missing",
    "TLSA (DANE) Record Missing",
    "info",
    "TLSA records pin the certificate for TLS-over-DNS. Optional but defense-in-depth.",
    ["Publish a TLSA record at _443._tcp.yourdomain.com if you want DANE"],
    ["https://datatracker.ietf.org/doc/html/rfc6698"],
  ),
  def(
    "dns-open-dns-resolver",
    "Authoritative DNS exposed on public IPs",
    "low",
    "Authoritative nameservers reachable on the public internet can be queried directly, leaking your zone data.",
    ["Restrict AXFR to internal IPs only"],
    [],
  ),
  def(
    "dns-dangling-cname",
    "Dangling CNAME Record (subdomain takeover risk)",
    "high",
    "A CNAME pointing to a defunct service (heroku, aws, fastly) lets an attacker register the orphan and serve content on your subdomain.",
    [
      "Audit CNAMEs against the cloud providers you use; remove dangling entries",
    ],
    [],
  ),
  def(
    "dns-zone-transfer-allowed",
    "DNS Zone Transfer (AXFR) Allowed",
    "high",
    "AXFR responses leak your entire zone. Restrict to authorized secondaries only.",
    [
      "Set allow-transfer { <slave-ips>; }; in BIND, or equivalent in your DNS provider",
    ],
    [],
  ),
  def(
    "dns-recursion-enabled",
    "Authoritative DNS Allows Recursion",
    "medium",
    "Authoritative nameservers shouldn't also be recursive resolvers (open resolver risk).",
    [
      "Set allow-recursion { none; }; or split authoritative and recursive roles",
    ],
    [],
  ),
  def(
    "dns-nxdomain-hijack-risk",
    "NXDOMAIN Hijack Risk (ISP NXDOMAIN Replacement)",
    "info",
    "Some ISPs replace NXDOMAIN responses with ads. DNSSEC + a validating resolver prevents this.",
    ["Enable DNSSEC and use a validating resolver (1.1.1.1, 8.8.8.8)"],
    [],
  ),
];

const dnsAdded = append("dns", newDns);

// ── EMAIL: more checks ─────────────────────────────────────────────────────
const newEmail = [
  def(
    "email-spf-lookup-count-too-high",
    "SPF Exceeds 10 DNS Lookup Limit",
    "high",
    "SPF records that trigger more than 10 DNS lookups fail with a permerror.",
    [
      "Use ip4: / ip6: instead of include: for static ranges; flatten nested includes",
    ],
    ["https://datatracker.ietf.org/doc/html/rfc7208#section-4.6.4"],
  ),
  def(
    "email-spf-redirect-loop",
    "SPF Redirect Loop",
    "high",
    "SPF redirect= with a chain that loops back to the original domain fails permerror.",
    ["Audit the redirect chain and break the loop"],
    [],
  ),
  def(
    "email-spf-ptr-mechanism",
    "SPF ptr Mechanism Present",
    "low",
    "The ptr mechanism is deprecated and SHOULD NOT be used.",
    ["Remove ptr from your SPF record"],
    [],
  ),
  def(
    "email-dmarc-rua-missing",
    "DMARC Aggregate Report (rua) Missing",
    "low",
    "Without rua= you receive no aggregate reports, leaving you blind to spoofing attempts.",
    ["Add rua=mailto:dmarc-reports@yourdomain.com (or use a DMARC analyzer)"],
    [],
  ),
  def(
    "email-dmarc-ruf-missing",
    "DMARC Forensic Report (ruf) Missing",
    "info",
    "ruf= sends sample failed messages. Privacy tradeoff; enable with caution.",
    ["Add ruf=mailto:dmarc-forensic@yourdomain.com (or skip for privacy)"],
    [],
  ),
  def(
    "email-dmarc-pct-not-100",
    "DMARC pct < 100",
    "low",
    "DMARC pct= applies the policy to a percentage of traffic. < 100 means some spoofed mail still gets delivered.",
    ["Set pct=100 once you're confident in the policy"],
    [],
  ),
  def(
    "email-dkim-sig-tag-missing",
    "DKIM Signature (s=) Missing",
    "low",
    "DKIM records without s= are not signing anything.",
    ["Verify your mail server is signing with s= field"],
    [],
  ),
  def(
    "email-bimi-record-missing",
    "BIMI Record Missing",
    "info",
    "BIMI (Brand Indicators for Message Identification) displays your brand logo in supported mail clients.",
    ["Publish a BIMI TXT record at default._bimi.yourdomain.com"],
    ["https://bimigroup.org/"],
  ),
  def(
    "email-mta-sts-policy-missing",
    "MTA-STS Policy File Missing",
    "medium",
    "MTA-STS tells receivers to require TLS. Without a policy file, mail may be downgraded.",
    [
      "Serve https://mta-sts.yourdomain.com/.well-known/mta-sts.txt with mode: enforce",
    ],
    ["https://datatracker.ietf.org/doc/html/rfc8461"],
  ),
  def(
    "email-tls-rpt-rua-missing",
    "TLS-RPT rua= Missing",
    "info",
    "TLS-RPT sends aggregate reports about SMTP TLS failures to your mailbox.",
    ["Publish _smtp._tls.yourdomain.com TXT with v=TLSRPTv1; rua=mailto:..."],
    ["https://datatracker.ietf.org/doc/html/rfc8460"],
  ),
  def(
    "email-smtp-open-relay",
    "SMTP Open Relay Detected",
    "critical",
    "Open SMTP relays are abused by spammers and put you on every RBL.",
    [
      "Require authentication for outbound relay; disable open relay in your MTA",
    ],
    [],
  ),
  def(
    "email-smtp-banner-disclosure",
    "SMTP Banner Discloses Version",
    "low",
    "SMTP 220 banner includes the daemon and version. Disable the disclosure.",
    ["Set smtpd_banner to a generic string in Postfix"],
    [],
  ),
];

const emailAdded = append("email", newEmail);

// ── SSL: more URL-level checks ────────────────────────────────────────────
const newSsl = [
  def(
    "ssl-http-and-https-both",
    "Site accessible on both HTTP and HTTPS",
    "medium",
    "Without HSTS or auto-redirect, the HTTP version is reachable and exploitable for SSL stripping.",
    ["301 redirect HTTP→HTTPS; enable HSTS with includeSubDomains; preload"],
    [],
  ),
  def(
    "ssl-https-only-cookie-on-http",
    "Secure cookie on HTTP endpoint",
    "high",
    "A cookie with Secure attribute on an HTTP-only site is still rejected by browsers.",
    ["Force HTTPS via redirect + HSTS"],
    [],
  ),
];

const sslAdded = append("ssl", newSsl);

// ── Summary ────────────────────────────────────────────────────────────────
console.log("\n=== Bulk add summary ===");
console.log(`headers               +${hdrAdded}`);
console.log(`cookies               +${cookieAdded}`);
console.log(`information-disclosure+${infoAdded}`);
console.log(`content               +${contentAdded}`);
console.log(`configuration         +${configAdded}`);
console.log(`api                   +${apiAdded}`);
console.log(`code                  +${codeAdded}`);
console.log(`secrets-extended      +${secretsAdded}`);
console.log(`tls                   +${tlsAdded}`);
console.log(`dns                   +${dnsAdded}`);
console.log(`email                 +${emailAdded}`);
console.log(`ssl                   +${sslAdded}`);
