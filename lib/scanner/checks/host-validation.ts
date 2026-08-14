/**
 * Host-validation detectors.
 *
 * Checks for Host header injection, HTTP request smuggling hints,
 * IDOR via sequential IDs, open-redirect/SSRF host-trust gaps, and other
 * request-routing vulnerabilities.
 */

import { getHeader, hasHeader, type EvidenceFn as DetectFn } from "../_helpers";
import { extractRootDomain } from "../root-domain";

// Shared by the two "confirmed redirect" detectors below. Deliberately
// excludes OAuth-shaped names like redirect_uri/return_to: those are
// snake_case/suffixed, so "redirect="/"return="/etc. matched literally
// (exact param name, no trailing "_" or extra chars) never matches them --
// the same exclusion the pre-existing content.ts open-redirect check
// relies on to avoid flagging allowlisted, per-client OAuth redirects.
const REDIRECT_PARAM_NAMES = new Set([
  "redirect",
  "return",
  "next",
  "url",
  "goto",
  "dest",
  "redir",
  "returnto",
  "continue",
  "forward",
  "target",
]);

// Link-safety/URL-rewriting vendors whose entire product IS redirecting to
// an external, unrelated host after a reputation check -- e.g. Microsoft
// Defender Safe Links rewrites every link in corporate email to
// https://<region>.safelinks.protection.outlook.com/?url=<target>&data=...
// and legitimately 302s (or meta-refreshes) to that exact url= value.
// extractRootDomain can't suppress these -- the rewriter and the wrapped
// target are unrelated organizations by design -- so they're excluded by
// hostname instead, shared by both "confirmed redirect" detectors below.
const LINK_SAFETY_REWRITER_HOSTNAMES = [
  /\.safelinks\.protection\.outlook\.com$/i,
  /^urldefense\.proofpoint\.com$/i,
  /\.secure-web\.cisco\.com$/i,
  /\.clicktime\.symantec\.com$/i,
  /\.linkprotect\.cudasvc\.com$/i,
  /\.mimecastprotect\.com$/i,
];

function isLinkSafetyRewriter(hostname: string): boolean {
  return LINK_SAFETY_REWRITER_HOSTNAMES.some((p) => p.test(hostname));
}

// Small, local RFC1918/loopback/link-local literal check -- mirrors the
// inline style code.ts already uses for this (e.g. code-ssrf-fetch-port's
// `(?:localhost|127\.0\.0\.1|...|169\.254\.169\.254|10\.|192\.168\.)`)
// rather than pulling in safe-fetch.ts's DNS-resolving version, which this
// synchronous, string-only detector has no use for.
const PRIVATE_WEBHOOK_IPV4 = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./, // covers the 169.254.169.254 cloud metadata endpoint too
  /^0\./,
];

function isPrivateWebhookTarget(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan"))
    return true;
  return PRIVATE_WEBHOOK_IPV4.some((p) => p.test(h));
}

// Mirrors api.ts's isOAuthAuthorizeEndpoint() (identical shape/logic) --
// kept as a local copy rather than a cross-file import because api.ts
// doesn't export it and this task's file list doesn't include api.ts.
function isOAuthAuthorizeEndpoint(pathname: string): boolean {
  return (
    /\/authorize(?:\/|$)/i.test(pathname) ||
    /\/(?:oauth2?|connect)\/.*\/auth(?:orize)?(?:\/|$)/i.test(pathname) ||
    /openid-connect\/auth(?:\/|$)/i.test(pathname)
  );
}

export const detectors: Record<string, DetectFn> = {
  // This only inspects the response to the scanner's own unmodified GET, so
  // it fires only in the rare case something upstream (a debug echo, a
  // misconfigured proxy) reflects X-Forwarded-Host without being asked to.
  // It cannot itself send a spoofed X-Forwarded-Host, so it will not catch
  // most real host-header-trust bugs; the active probe that sends one and
  // checks for reflection is checkXForwardedHostInjection in async-checks.ts.
  "host-header-injection": (url, headers, body) => {
    const xForwardedHost = getHeader(headers, "x-forwarded-host");
    const location = getHeader(headers, "location");
    if (xForwardedHost) {
      if (location && location.includes(xForwardedHost)) {
        return `Location header reflects X-Forwarded-Host (${xForwardedHost}): host header injection in redirect.`;
      }
      if (body.includes(xForwardedHost)) {
        return `Response body reflects X-Forwarded-Host (${xForwardedHost}): host header injection risk.`;
      }
    }
    return null;
  },

  "symfony-debug-token": (_url, headers) => {
    if (hasHeader(headers, "x-debug-token")) {
      const token = getHeader(headers, "x-debug-token");
      const link = getHeader(headers, "x-debug-token-link");
      return `Symfony debug profiler active in production (X-Debug-Token: ${token}${link ? `, link: ${link}` : ""}).`;
    }
    return null;
  },

  "http-request-smuggling": (_url, headers) => {
    const te = getHeader(headers, "transfer-encoding");
    const cl = getHeader(headers, "content-length");
    if (te && cl && /chunked/i.test(te)) {
      return `Both Transfer-Encoding: ${te} and Content-Length: ${cl} present — potential HTTP request smuggling setup.`;
    }
    return null;
  },

  "basic-auth-over-http": (url, headers) => {
    const wwwAuth = getHeader(headers, "www-authenticate");
    if (!wwwAuth) return null;
    if (!/^basic\s/i.test(wwwAuth)) return null;
    if (url.startsWith("http://")) {
      return "WWW-Authenticate: Basic on HTTP endpoint — credentials sent as plaintext Base64 over the wire.";
    }
    return null;
  },

  "aspnet-viewstate-no-mac": (_url, _headers, body) => {
    const hasViewState = /__VIEWSTATE/.test(body);
    if (!hasViewState) return null;
    const hasMac =
      /__VIEWSTATEMAC/.test(body) ||
      /enableViewStateMac\s*=\s*["']true["']/i.test(body);
    if (!hasMac) {
      const hasDisabledMac =
        /enableViewStateMac\s*=\s*["']false["']/i.test(body) ||
        /ViewStateEncryptionMode\s*=\s*["']Never["']/i.test(body);
      if (hasDisabledMac) {
        return "ASP.NET ViewState MAC validation explicitly disabled: forged ViewState enables deserialization attacks.";
      }
      // A sibling __VIEWSTATEMAC field is only ONE way ASP.NET represents a
      // MAC; some versions/configurations embed the MAC directly inside
      // __VIEWSTATE itself without a separate field, which this markup-only
      // check cannot distinguish from a real misconfiguration. Worded as
      // "could not confirm" rather than a confirmed vulnerability.
      return "ASP.NET ViewState present without a __VIEWSTATEMAC field: MAC protection could not be confirmed from the page markup alone. Verify EnableViewStateMac=true in configuration.";
    }
    return null;
  },

  "cache-poisoning-unkeyed-header": (_url, headers) => {
    const xCache =
      getHeader(headers, "x-cache") ?? getHeader(headers, "x-cache-status");
    const xForwardedHost = getHeader(headers, "x-forwarded-host");
    const xOriginalUrl = getHeader(headers, "x-original-url");
    if (xCache && /HIT/i.test(xCache) && (xForwardedHost || xOriginalUrl)) {
      return `Cached response (${xCache}) reflects routing headers (X-Forwarded-Host/X-Original-URL) — cache poisoning risk via unkeyed headers.`;
    }
    return null;
  },

  "idor-sequential-id-in-url": (url) => {
    // Match small sequential IDs in API resource paths. Deliberately excludes
    // generic nouns like "item" or "record" that just as often name a public,
    // no-ownership-concept resource (a catalog product page, a public
    // records lookup) as a private one -- those words previously flagged
    // ordinary e-commerce/browsing URLs (e.g. /item/42) as an "IDOR risk"
    // with no user-owned resource involved at all. The remaining words are
    // reliably user/account-scoped in normal usage.
    // "user" and "profile" additionally require an api/ or v\d+/ prefix:
    // bare /user/{n} and /profile/{n} are also standard CMS content-routing
    // paths (e.g. Drupal's default /user/{uid} entity route, where uid 1 is
    // the site's own admin account) with no ownership-scoped API behind
    // them, so an unprefixed match there isn't evidence of anything.
    // "account"/"invoice"/"order" stay bare-matchable since those remain
    // reliably owner-scoped without needing an API prefix.
    // EvidenceFn only gets (url, headers, body), never the response status,
    // so this cannot tell a 200 that actually leaked another user's data
    // apart from a 401/403 a properly access-controlled server returned for
    // the same URL shape. It is a passive URL-shape hint, not a confirmed
    // access-control finding -- see host-validation.json's severity for it.
    const m =
      /\/(?:api\/|v\d+\/)(?:user|profile)s?\/([1-9]\d{0,4})(?:\/|$|\?)/i.exec(
        url,
      ) ??
      /\/(?:api\/)?(?:v\d+\/)?(?:account|invoice|order)s?\/([1-9]\d{0,4})(?:\/|$|\?)/i.exec(
        url,
      );
    if (m) {
      const id = parseInt(m[1], 10);
      if (id < 10000) {
        return `Sequential numeric ID (${id}) in resource URL: low integer IDs are trivially enumerable (IDOR risk).`;
      }
    }
    return null;
  },

  // The scanner's own unmodified request already carried a redirect-shaped
  // parameter (whatever value was present in the crawled/scanned URL). If
  // the server's Location header sends the browser to that exact external
  // host, that is real, confirmed server behavior -- not a guess from
  // static text -- proving the parameter drove the redirect target with no
  // allowlist stopping an off-domain destination.
  "open-redirect-location-confirmed": (url, headers) => {
    const location = getHeader(headers, "location");
    if (!location) return null;
    let reqUrl: URL;
    try {
      reqUrl = new URL(url);
    } catch {
      return null;
    }
    let locUrl: URL;
    try {
      locUrl = new URL(location, reqUrl);
    } catch {
      return null;
    }
    if (isLinkSafetyRewriter(reqUrl.hostname)) return null;
    // Same-host (or relative) redirects are the overwhelming majority of
    // real traffic; bail before even inspecting query params.
    if (locUrl.hostname === reqUrl.hostname) return null;
    for (const [key, value] of reqUrl.searchParams) {
      if (!REDIRECT_PARAM_NAMES.has(key.toLowerCase())) continue;
      if (!/^(?:https?:)?\/\//i.test(value)) continue;
      let target: URL;
      try {
        target = new URL(value, reqUrl);
      } catch {
        continue;
      }
      if (target.hostname !== locUrl.hostname) continue;
      // Same organizational domain (e.g. app.example.com -> accounts.example.com)
      // is normal SSO/cross-subdomain routing, not a phishing-enabling redirect.
      if (
        extractRootDomain(target.hostname) ===
        extractRootDomain(reqUrl.hostname)
      )
        continue;
      return `Request parameter "${key}=${value}" and the response's Location header (${location}) both resolve to ${locUrl.hostname}: confirmed open redirect off ${reqUrl.hostname}.`;
    }
    return null;
  },

  // Same confirmation logic as open-redirect-location-confirmed above, but
  // for client-side <meta http-equiv="refresh"> redirects instead of a
  // server Location header -- a distinct vector (fires even when the
  // redirect is issued as a 200 OK page with a refresh tag, not a 3xx).
  "open-redirect-meta-refresh-confirmed": (url, _headers, body) => {
    let reqUrl: URL;
    try {
      reqUrl = new URL(url);
    } catch {
      return null;
    }
    if (isLinkSafetyRewriter(reqUrl.hostname)) return null;
    const metaRe =
      /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"'>]*url=([^"'>\s]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = metaRe.exec(body)) !== null) {
      const idx = m.index;
      const before = body.slice(Math.max(0, idx - 200), idx);
      if (/<code|<pre|```|example|documentation/i.test(before)) continue;
      let target: URL;
      try {
        target = new URL(m[1], reqUrl);
      } catch {
        continue;
      }
      if (target.hostname === reqUrl.hostname) continue;
      if (
        extractRootDomain(target.hostname) ===
        extractRootDomain(reqUrl.hostname)
      )
        continue;
      for (const [key, value] of reqUrl.searchParams) {
        if (!REDIRECT_PARAM_NAMES.has(key.toLowerCase())) continue;
        let paramTarget: URL;
        try {
          paramTarget = new URL(value, reqUrl);
        } catch {
          continue;
        }
        if (paramTarget.hostname === target.hostname) {
          return `Request parameter "${key}=${value}" matches the page's meta-refresh redirect target (${target.hostname}): confirmed client-side open redirect off ${reqUrl.hostname}.`;
        }
      }
    }
    return null;
  },

  // Looks for a webhook/callback URL field whose value, as currently
  // exposed in the response (a settings API response or a rendered form
  // field), is already set to a private/internal address. That the app
  // accepted and is showing back a private-range value is direct evidence
  // no host-range validation ran when the value was saved.
  "webhook-callback-private-ip-target": (_url, _headers, body) => {
    const candidates: { source: string; target: string; idx: number }[] = [];

    const jsonRe =
      /"([a-zA-Z0-9]*(?:webhook|callback)[a-zA-Z0-9]*)"\s*:\s*"(https?:\/\/[^"\s]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = jsonRe.exec(body)) !== null) {
      candidates.push({ source: m[1], target: m[2], idx: m.index });
    }

    const inputRe = /<input\b[^>]*>/gi;
    while ((m = inputRe.exec(body)) !== null) {
      const tag = m[0];
      if (
        !/name=["'][a-zA-Z0-9_-]*(?:webhook|callback)[a-zA-Z0-9_-]*["']/i.test(
          tag,
        )
      )
        continue;
      const valueMatch = /value=["'](https?:\/\/[^"'>\s]+)["']/i.exec(tag);
      if (!valueMatch) continue;
      candidates.push({ source: "input", target: valueMatch[1], idx: m.index });
    }

    for (const { source, target, idx } of candidates) {
      const before = body.slice(Math.max(0, idx - 200), idx);
      if (/<code|<pre|```|example|documentation/i.test(before)) continue;
      let hostname: string;
      try {
        hostname = new URL(target).hostname;
      } catch {
        continue;
      }
      if (!isPrivateWebhookTarget(hostname)) continue;
      return `Webhook/callback URL field "${source}" is configured to a private/internal address (${target}): no host allowlist appears to block internal targets.`;
    }
    return null;
  },

  // Structural signal for missing SSRF hardening on a webhook/callback
  // feature specifically: the destination URL is taken directly off the
  // request (not a hardcoded/config value) AND passed to an outbound HTTP
  // client shortly after, with no private-IP/allowlist check text anywhere
  // in between. Requires both the user-input source and the outbound call
  // in proximity -- a bare "webhook" keyword or a bare fetch() call alone
  // is not enough to fire.
  "webhook-ssrf-request-input-no-validation": (_url, _headers, body) => {
    // Requires the literal req./request. object, not just a bare
    // body/params/query identifier: those exact names are equally common as
    // client-side variables with nothing to do with a server request object
    // (`const params = new URLSearchParams(window.location.search)`,
    // React Router's `useParams()`), and this detector has no way to tell
    // client-side inline <script> text apart from real server source.
    const assignRe =
      /\b(?:webhook|callback)[a-zA-Z_]*\s*[:=]\s*(?:await\s+)?(?:req(?:uest)?)\??\.(?:body|params|query)\??\.[\w'"[\].]{1,80}/gi;
    let m: RegExpExecArray | null;
    while ((m = assignRe.exec(body)) !== null) {
      const idx = m.index;
      const before = body.slice(Math.max(0, idx - 200), idx);
      if (/<code|<pre|```|example|documentation/i.test(before)) continue;
      const windowEnd = Math.min(body.length, idx + m[0].length + 500);
      const after = body.slice(idx + m[0].length, windowEnd);
      if (
        !/\b(?:fetch|axios(?:\.\w+)?|got|superagent|request)\s*\(/i.test(after)
      )
        continue;
      if (
        /private|internal|loopback|localhost|127\.0\.0\.1|169\.254|isPrivateIP|isPrivateHostname|blocklist|denylist|allowlist|whitelist|allowed_hosts|ssrf/i.test(
          after,
        )
      )
        continue;
      return `Webhook/callback URL assigned directly from request input ("${m[0].trim()}") and passed to an outbound HTTP call with no visible private-IP/SSRF check nearby.`;
    }
    return null;
  },

  // Same technique as webhook-ssrf-request-input-no-validation above --
  // request-input-sourced URL variable, syntactically close to an outbound
  // HTTP call, no validation keyword in between -- generalized to the other
  // common "fetch a URL server-side" field families beyond webhook/callback:
  // avatar/image/logo-by-URL fields, link-preview/unfurl endpoints, and
  // PDF/export-from-URL fields. All three are well-known SSRF vectors in
  // their own right (e.g. "set avatar from URL" downloading and re-hosting
  // whatever the server fetches, Slack/Discord-style link unfurling,
  // wkhtmltopdf/headless-browser "render this URL to PDF" exporters).
  //
  // Unlike "webhook"/"callback", words like "avatar"/"image"/"preview" are
  // NOT inherently URL-shaped on their own (an "avatar" field is just as
  // often an uploaded file/blob with no URL semantics at all), so this
  // additionally requires a url/uri/link/src suffix on the variable name --
  // real structural context beyond a bare topic-word substring match.
  "url-import-ssrf-request-input-no-validation": (_url, _headers, body) => {
    const assignRe =
      /\b(?:avatar|image|logo|picture|photo|profile(?:[-_]?image)?|preview|unfurl|embed|pdf|export)[-_]?(?:url|uri|link|src)[a-zA-Z_]*\s*[:=]\s*(?:await\s+)?(?:req(?:uest)?)\??\.(?:body|params|query)\??\.[\w'"[\].]{1,80}/gi;
    let m: RegExpExecArray | null;
    while ((m = assignRe.exec(body)) !== null) {
      const idx = m.index;
      const before = body.slice(Math.max(0, idx - 200), idx);
      if (/<code|<pre|```|example|documentation/i.test(before)) continue;
      const windowEnd = Math.min(body.length, idx + m[0].length + 500);
      const after = body.slice(idx + m[0].length, windowEnd);
      if (
        !/\b(?:fetch|axios(?:\.\w+)?|got|superagent|request)\s*\(/i.test(after)
      )
        continue;
      if (
        /private|internal|loopback|localhost|127\.0\.0\.1|169\.254|isPrivateIP|isPrivateHostname|blocklist|denylist|allowlist|whitelist|allowed_hosts|ssrf/i.test(
          after,
        )
      )
        continue;
      return `URL-import field assigned directly from request input ("${m[0].trim()}") and passed to an outbound HTTP call with no visible private-IP/SSRF check nearby.`;
    }
    return null;
  },

  // Same URL-shape technique as api.ts's api-oauth-authorize-missing-pkce /
  // api-oauth-implicit-flow-response-type-token: inspect the scanned
  // request's own query string on a real OAuth/OIDC authorize endpoint,
  // rather than guessing from page text. response_type and client_id both
  // present confirms this is a real authorization request (not just a page
  // whose path happens to contain "authorize"); no "state" parameter in
  // that same query string means the flow has no CSRF protection.
  "oauth-authorize-missing-state-param": (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!isOAuthAuthorizeEndpoint(parsed.pathname)) return null;
    if (!parsed.searchParams.has("response_type")) return null;
    if (!parsed.searchParams.has("client_id")) return null;
    if (parsed.searchParams.has("state")) return null;
    return `Authorization request to ${parsed.pathname} has response_type and client_id but no state parameter in the query string: CSRF risk in the OAuth authorization flow.`;
  },
};
