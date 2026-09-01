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
  // Only genuine subresource-loading tags trigger a browser mixed-content
  // warning or carry MITM risk. A plain <a href="http://..."> is regular
  // navigation, never fetched as a subresource -- it must not count here.
  // <form action=...> is covered separately by form-action-http. Mirrors
  // headers.ts's `mixed-content` detector, which scopes the same way.
  //
  // Each hit is judged at ITS OWN offset. This previously collected the
  // matched tag TEXT and re-found it with body.indexOf(ref), which always
  // returns the FIRST occurrence of that string: a page that showed a tag
  // inside <pre><code> and then loaded the identical tag for real further
  // down had every copy judged at the documentation offset, so the whole
  // page was reported clean. A silent false negative, the worse direction.
  const srcRe =
    /<(?:script|img|iframe|video|audio|source|object|embed)\b[^>]*\ssrc=["']http:\/\/[^"']+["']/gi;
  const linkRe = /<link\b[^>]{0,2000}>/gi;
  const offsets: number[] = [];
  for (const m of body.matchAll(srcRe)) offsets.push(m.index);
  for (const m of body.matchAll(linkRe)) {
    if (!/\brel=["']?stylesheet["']?/i.test(m[0])) continue;
    if (!/\shref=["']http:\/\/[^"']+["']/i.test(m[0])) continue;
    offsets.push(m.index);
  }
  let count = 0;
  for (const idx of offsets) {
    const before = body.slice(Math.max(0, idx - 200), idx).toLowerCase();
    if (/<code|<pre|```|example|documentation/i.test(before)) continue;
    count++;
  }
  if (count === 0) return null;
  return `${count} mixed-content reference(s) (https page loading http resources).`;
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

  // http-no-redirect was removed: headers here are always the terminal
  // response after safeFetch's redirect:"follow" loop, never the first
  // hop's 3xx/Location, so this fired on every http:// target regardless
  // of whether it actually redirects (see checks-data/ssl.json history).
  // Fixing it needs the first-hop response captured upstream in
  // execute-scan.ts, not something this file can see.

  // ── Mixed content ────────────────────────────────────────────────────
  "mixed-protocol-content": (url, _headers, body) =>
    detectMixedContent(url, _headers, body || ""),

  // ── HSTS / Expect-CT / Alt-Svc hints (header-level) ─────────────────
  "expect-ct-missing": (_url, _headers) => {
    // Chrome removed Expect-CT support in 2022 and MDN marks it deprecated;
    // CT is now enforced unconditionally by browsers at certificate-
    // validation time, independent of this header. Essentially no site,
    // including well-secured ones, sends it anymore, so its absence is not
    // a finding (same rationale as nel-header-missing / age-header-reveals-cdn
    // in headers.ts).
    return null;
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
