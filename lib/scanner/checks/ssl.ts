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

import {
  hasHeader,
  getHeader,
  extractScriptContents,
  type EvidenceFn as DetectFn,
} from "../_helpers";
import { tagsWith } from "./_tag-scan";

/** A cleartext http:// URL that is not a loopback address. */
const HTTP_NON_LOCAL =
  /^http:\/\/(?!localhost[:/]?|127\.0\.0\.1[:/]?|\[::1\])/i;

/** The value of one attribute on an already-matched opening tag. */
function attrValue(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']{1,600})["']`, "i");
  return re.exec(tag)?.[1] ?? null;
}

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

  // ── HSTS delivered in a place browsers ignore ───────────────────────

  "ssl-hsts-meta-tag-ineffective": (_url, _headers, body) => {
    const tag = tagsWith(
      body,
      "meta",
      /http-equiv\s*=\s*["']?strict-transport-security["']?/i,
    )[0];
    if (!tag) return null;
    const content = attrValue(tag, "content");
    return `HSTS is declared in a <meta http-equiv> tag${content ? ` (content="${content.slice(0, 120)}")` : ""}, which no browser honours.`;
  },

  // ── Cleartext protocol advertised alongside the TLS one ─────────────

  "ssl-alt-svc-cleartext-h2c": (url, headers) => {
    if (!url.startsWith("https://")) return null;
    const altSvc = getHeader(headers, "alt-svc");
    if (!altSvc) return null;
    // Protocol ids are the token before '='. h2c is HTTP/2 over cleartext TCP.
    const m = /(?:^|[\s,])(h2c)\s*=\s*"([^"]{0,120})"/i.exec(altSvc);
    if (!m) return null;
    return `Alt-Svc on an HTTPS response advertises the cleartext protocol h2c at ${m[2] || "an unspecified authority"}.`;
  },

  // ── Cleartext subresources the tag-based mixed-content checks miss ──

  "ssl-link-header-http-subresource": (url, headers) => {
    if (!url.startsWith("https://")) return null;
    const link = getHeader(headers, "link");
    if (!link) return null;
    // One entry is `<uri>; rel=...`; entries are comma separated.
    for (const entry of link.split(/,(?=\s*<)/)) {
      const target = /<([^>]{1,600})>/.exec(entry)?.[1];
      if (!target || !HTTP_NON_LOCAL.test(target)) continue;
      const rel = /rel\s*=\s*"?([\w -]{1,60})"?/i.exec(entry)?.[1] ?? "";
      if (
        !/\b(?:preload|modulepreload|preconnect|prefetch|dns-prefetch|stylesheet|prerender)\b/i.test(
          rel,
        )
      ) {
        continue;
      }
      return `Link header on an HTTPS response points a rel="${rel.trim()}" subresource at a cleartext URL: ${target.slice(0, 200)}`;
    }
    return null;
  },

  "ssl-http-resource-hint-tag": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    const hintRel =
      /rel\s*=\s*["']?(?:preload|modulepreload|preconnect|prefetch|dns-prefetch|prerender|manifest)["']?/i;
    for (const tag of tagsWith(body, "link", hintRel)) {
      const href = attrValue(tag, "href");
      if (!href || !HTTP_NON_LOCAL.test(href)) continue;
      const rel = attrValue(tag, "rel") ?? "resource hint";
      return `<link rel="${rel}"> on an HTTPS page points at a cleartext URL: ${href.slice(0, 200)}`;
    }
    return null;
  },

  "ssl-mixed-content-non-src-attribute": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    // The existing mixed-content detectors only read `src` on media/script
    // tags and `href` on stylesheet links. These four attributes load a
    // subresource just as much and are not covered by either.
    const candidates: [string, string, RegExp][] = [
      ["img", "srcset", /srcset\s*=/i],
      ["source", "srcset", /srcset\s*=/i],
      ["video", "poster", /poster\s*=/i],
      ["object", "data", /\bdata\s*=/i],
    ];
    for (const [tagName, attribute, gate] of candidates) {
      for (const tag of tagsWith(body, tagName, gate)) {
        const value = attrValue(tag, attribute);
        if (!value) continue;
        // srcset is a comma-separated candidate list; test each URL.
        const urls =
          attribute === "srcset"
            ? value.split(",").map((c) => c.trim().split(/\s+/)[0])
            : [value];
        for (const candidate of urls) {
          if (!HTTP_NON_LOCAL.test(candidate)) continue;
          return `<${tagName} ${attribute}> on an HTTPS page loads a cleartext subresource: ${candidate.slice(0, 200)}`;
        }
      }
    }
    return null;
  },

  "ssl-canonical-link-http": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    const tag = tagsWith(body, "link", /rel\s*=\s*["']?canonical["']?/i)[0];
    if (!tag) return null;
    const href = attrValue(tag, "href");
    if (!href || !HTTP_NON_LOCAL.test(href)) return null;
    return `An HTTPS page declares its canonical URL as cleartext: ${href.slice(0, 200)}`;
  },

  "ssl-meta-refresh-http-target": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    const tag = tagsWith(
      body,
      "meta",
      /http-equiv\s*=\s*["']?refresh["']?/i,
    )[0];
    if (!tag) return null;
    const content = attrValue(tag, "content");
    if (!content) return null;
    const target = /url\s*=\s*['"]?(\S{1,600}?)['"]?\s*$/i.exec(content)?.[1];
    if (!target || !HTTP_NON_LOCAL.test(target)) return null;
    return `An HTTPS page uses <meta http-equiv="refresh"> to send visitors to a cleartext URL: ${target.slice(0, 200)}`;
  },

  "ssl-http-fetch-endpoint-in-script": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    for (const script of extractScriptContents(body)) {
      if (script.indexOf("http://") === -1) continue;
      const call =
        /\b(?:fetch|open|get|post|put|patch|delete|ajax|connect)\s*\(\s*(?:["'](?:GET|POST|PUT|PATCH|DELETE|HEAD)["']\s*,\s*)?["'](http:\/\/[^"']{1,400})["']/i.exec(
          script,
        );
      if (!call) continue;
      if (!HTTP_NON_LOCAL.test(call[1])) continue;
      return `Inline script on an HTTPS page issues a request to a cleartext endpoint: ${call[1].slice(0, 200)}`;
    }
    return null;
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
