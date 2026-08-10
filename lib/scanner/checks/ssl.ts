/**
 * SSL / TLS-at-the-edge detectors.
 *
 * Inline detectors here look at the URL + response headers/body. The deep
 * TLS checks (cert chain, cipher suite, OCSP) live in
 * lib/scanner/async-checks.ts because they need a raw socket.
 *
 * Every detector MUST return non-null evidence when its check fires. A
 * detector that returns null for every input is silently dropped by
 * registry.buildCheck()'s filter, so a JSON entry with a no-op detector
 * never produces a finding.
 */

import { hasHeader, getHeader, type EvidenceFn as DetectFn } from "../_helpers";

/**
 * Mixed content: a page served over HTTPS that loads http:// subresources.
 * Browsers block active mixed content by default; passive mixed content
 * (images, iframes) still leaks request metadata and is a known
 * downgrade vector.
 *
 * Mixed content is only a meaningful concept when the PAGE ITSELF is HTTPS;
 * an http:// page referencing other http:// URLs (including same-origin
 * links) is completely normal and not mixed content at all. This previously
 * had no HTTPS gate, so it reported "HTTPS page loading HTTP resources" on
 * any plain HTTP page that happened to contain an absolute http:// src/href,
 * which is virtually every HTTP page.
 */
function detectMixedContent(url: string, _headers: Headers, body: string) {
  if (!body) return null;
  if (!url.startsWith("https://")) return null;
  const httpRefs =
    body.match(/(?:src|href|action)\s*=\s*["']http:\/\//gi) || [];
  if (httpRefs.length === 0) return null;
  return `${httpRefs.length} mixed-content reference(s) (https page loading http resources).`;
}

export const detectors: Record<string, DetectFn> = {
  // ── URL-level ────────────────────────────────────────────────────────
  "unencrypted-connection": (url) => {
    if (!url.startsWith("http://")) return null;
    return `Site served over unencrypted HTTP: ${url}`;
  },

  "ssl-strip-detected": (url, headers) => {
    // A page that has a known HSTS policy but is currently being served
    // over HTTP is a classic ssl-strip / downgrade indicator. Without
    // HSTS we can't differentiate "server should be HTTPS" from "server
    // is HTTP-only", so we don't fire.
    if (url.startsWith("https://")) return null;
    if (!hasHeader(headers, "strict-transport-security")) return null;
    return "HTTPS site with HSTS policy is being served over HTTP (possible ssl-strip).";
  },

  "http-no-redirect": (url, headers) => {
    if (!url.startsWith("http://")) return null;
    // :status pseudo-header on HTTP/2; if absent, HTTP/1.1 — fall back
    // to checking for a Location header pointing to https://.
    const status = getHeader(headers, ":status");
    if (status && status.startsWith("3")) return null;
    const location = getHeader(headers, "location");
    if (location && location.startsWith("https://")) return null;
    return `HTTP endpoint does not redirect to HTTPS: ${url}`;
  },

  // ── Mixed content ────────────────────────────────────────────────────
  "mixed-protocol-content": (url, _headers, body) =>
    detectMixedContent(url, _headers, body || ""),

  // ── HSTS / Expect-CT / Alt-Svc hints (header-level) ─────────────────
  "expect-ct-missing": (url, headers) => {
    if (!url.startsWith("https://")) return null;
    if (hasHeader(headers, "expect-ct")) return null;
    return "HTTPS site does not declare Expect-CT (Certificate Transparency enforcement).";
  },

  // ── HTTP method override ────────────────────────────────────────────
  "x-forwarded-method-override": (_url, headers) => {
    if (hasHeader(headers, "x-http-method-override")) {
      return `X-HTTP-Method-Override header present: ${getHeader(headers, "x-http-method-override")}`;
    }
    if (hasHeader(headers, "x-forwarded-method")) {
      return `X-Forwarded-Method header present: ${getHeader(headers, "x-forwarded-method")}`;
    }
    return null;
  },

  // ── HTTPS on unusual port ───────────────────────────────────────────
  "https-unusual-port": (url) => {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") return null;
      if (u.port === "" || u.port === "443") return null;
      return `HTTPS served on non-standard port: ${u.port}`;
    } catch {
      return null;
    }
  },

  // ── Secure cookie on HTTP endpoint (cookie data leaks) ─────────────
  "ssl-https-only-cookie-on-http": (url, headers) => {
    if (url.startsWith("https://")) return null;
    const setCookies = (getHeader(headers, "set-cookie") || "")
      .toLowerCase()
      .split(/,(?=[^;]+=)/);
    const secureOnHttp = setCookies.find((c) => /;\s*secure\b/.test(c));
    if (secureOnHttp) {
      return `Secure-flagged cookie on HTTP endpoint: ${secureOnHttp.slice(0, 200)}`;
    }
    return null;
  },
};
