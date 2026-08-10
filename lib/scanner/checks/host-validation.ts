/**
 * Host-validation detectors.
 *
 * Checks for Host header injection, HTTP request smuggling hints,
 * IDOR via sequential IDs, and other request-routing vulnerabilities.
 */

import { getHeader, hasHeader, type EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  "host-header-injection": (url, headers, body) => {
    // Check if the response contains password reset or absolute URL patterns
    // reflecting a potentially attacker-controlled host value
    const xForwardedHost = getHeader(headers, "x-forwarded-host");
    const location = getHeader(headers, "location");
    if (xForwardedHost) {
      // If the response Location header reflects the X-Forwarded-Host value, flag it
      if (location && location.includes(xForwardedHost)) {
        return `Location header reflects X-Forwarded-Host (${xForwardedHost}) — host header injection in redirect.`;
      }
      // If the body includes the X-Forwarded-Host value in a link/URL context, flag it
      if (body.includes(xForwardedHost)) {
        return `Response body reflects X-Forwarded-Host (${xForwardedHost}) — host header injection risk.`;
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
        return "ASP.NET ViewState MAC validation explicitly disabled — forged ViewState enables deserialization attacks.";
      }
      // If __VIEWSTATE present without __VIEWSTATEMAC, flag as potentially missing
      return "ASP.NET ViewState present without __VIEWSTATEMAC — verify EnableViewStateMac=true in configuration.";
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
    const m =
      /\/(?:api\/)?(?:v\d+\/)?(?:user|account|invoice|order|profile)s?\/([1-9]\d{0,4})(?:\/|$|\?)/i.exec(
        url,
      );
    if (m) {
      const id = parseInt(m[1], 10);
      if (id < 10000) {
        return `Sequential numeric ID (${id}) in resource URL — low integer IDs are trivially enumerable (IDOR risk).`;
      }
    }
    return null;
  },
};
