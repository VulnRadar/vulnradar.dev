/**
 * Configuration detectors.
 *
 * Detectors that look for server-/infrastructure-level config exposure:
 * debug indicators, source map leaks, response-timing telemetry, ETags,
 * server identity headers, etc.
 */

import {
  getHeader,
  getSetCookies,
  hasHeader,
  type EvidenceFn as DetectFn,
} from "../_helpers";

const h = getHeader;

export const detectors: Record<string, DetectFn> = {
  "server-header-disclosure": (_url, headers) => {
    const server = h(headers, "server");
    const powered = h(headers, "x-powered-by");
    const via = h(headers, "x-aspnet-version");
    const found: string[] = [];
    if (server && server !== "cloudflare" && server !== "Vercel")
      found.push(`Server: ${server}`);
    if (powered) found.push(`X-Powered-By: ${powered}`);
    if (via) found.push(`X-AspNet-Version: ${via}`);
    return found.length > 0
      ? `Technology disclosed: ${found.join(", ")}`
      : null;
  },

  "x-powered-by-exposed": (_url, headers) => {
    if (!hasHeader(headers, "x-powered-by")) return null;
    return `X-Powered-By header exposes: '${h(headers, "x-powered-by")}'.`;
  },

  "x-aspnet-version-exposed": (_url, headers) => {
    if (!hasHeader(headers, "x-aspnet-version")) return null;
    return `X-AspNet-Version exposed: '${h(headers, "x-aspnet-version")}'.`;
  },

  "x-aspnetmvc-version-exposed": (_url, headers) => {
    if (!hasHeader(headers, "x-aspnetmvc-version")) return null;
    return `X-AspNetMvc-Version exposed: '${h(headers, "x-aspnetmvc-version")}'.`;
  },

  "via-header-exposed": (_url, headers) => {
    if (!hasHeader(headers, "via")) return null;
    return `Via header reveals proxy chain: '${h(headers, "via")}'.`;
  },

  "x-runtime-exposed": (_url, headers) => {
    if (!hasHeader(headers, "x-runtime")) return null;
    return `X-Runtime header exposes request processing time: ${h(headers, "x-runtime")}ms.`;
  },

  "x-request-id-exposed": (_url, headers) => {
    if (!hasHeader(headers, "x-request-id")) return null;
    return "X-Request-Id header is exposed to clients.";
  },

  "x-backend-server-exposed": (_url, headers) => {
    for (const name of [
      "x-backend-server",
      "x-served-by",
      "x-server",
      "x-host",
    ]) {
      if (hasHeader(headers, name))
        return `Header '${name}' exposes backend server info: '${h(headers, name)}'.`;
    }
    return null;
  },

  "age-header-reveals-cdn": (_url, headers) => {
    if (!hasHeader(headers, "age")) return null;
    const age = parseInt(h(headers, "age") || "0", 10);
    if (age < 1) return null;
    return `Age header (${age}s) reveals CDN caching behavior.`;
  },

  "x-debug-header-exposed": (_url, headers) => {
    for (const name of [
      "x-debug",
      "x-debug-token",
      "x-debug-token-link",
      "x-debug-info",
    ]) {
      if (hasHeader(headers, name))
        return `Debug header '${name}' found in production response.`;
    }
    return null;
  },

  "cache-control-missing": (_url, headers) => {
    if (hasHeader(headers, "cache-control") || hasHeader(headers, "pragma"))
      return null;
    return "Neither 'Cache-Control' nor 'Pragma' headers are present.";
  },

  "cache-control-public-sensitive": (_url, headers, body) => {
    const cc = h(headers, "cache-control");
    if (!cc || !cc.includes("public")) return null;
    const hasForm = /<form[^>]*method\s*=\s*["']?post/i.test(body);
    const hasPasswd = /<input[^>]*type\s*=\s*["']?password/i.test(body);
    if (!hasForm && !hasPasswd) return null;
    return "Cache-Control: public set on page containing sensitive forms.";
  },

  "x-amz-request-id": (_url, headers) => {
    if (
      hasHeader(headers, "x-amz-request-id") ||
      hasHeader(headers, "x-amz-id-2")
    ) {
      return "AWS request ID headers exposed - reveals AWS infrastructure.";
    }
    return null;
  },

  "cf-ray-header": (_url, headers) => {
    if (hasHeader(headers, "cf-ray")) {
      return "Cloudflare CF-Ray header present - reveals CDN usage.";
    }
    return null;
  },

  "x-vercel-id": (_url, headers) => {
    if (hasHeader(headers, "x-vercel-id")) {
      return "Vercel deployment ID exposed.";
    }
    return null;
  },

  "x-cache-header": (_url, headers) => {
    const xCache = h(headers, "x-cache");
    if (xCache && /hit|miss/i.test(xCache)) {
      return `X-Cache header reveals caching behavior: ${xCache}.`;
    }
    return null;
  },

  "etag-inode": (_url, headers) => {
    const etag = h(headers, "etag");
    if (etag && /^["']?[0-9a-f]+-[0-9a-f]+-[0-9a-f]+["']?$/i.test(etag)) {
      return "ETag appears to contain inode information - filesystem disclosure.";
    }
    return null;
  },

  "etag-inode-leak": (_url, headers) => {
    const etag = h(headers, "etag");
    if (!etag) return null;
    if (/^"?[0-9a-f]+-[0-9a-f]+-[0-9a-f]+"?$/i.test(etag)) {
      return `ETag '${etag}' uses inode-size-timestamp format, leaking filesystem info.`;
    }
    return null;
  },

  "date-time-skew": (_url, headers) => {
    const serverDate = h(headers, "date");
    if (!serverDate) return null;
    const serverTime = new Date(serverDate).getTime();
    const now = Date.now();
    const skew = Math.abs(serverTime - now);
    if (skew > 300000) {
      return "Server date significantly differs from client time - potential NTP issues.";
    }
    return null;
  },

  "server-version-detailed": (_url, headers) => {
    const sv = h(headers, "server");
    if (!sv) return null;
    if (/\d+\.\d+/.test(sv)) {
      return `Server header reveals detailed version: '${sv}'.`;
    }
    return null;
  },

  "server-timing-exposure": (_url, headers) => {
    const st = h(headers, "server-timing");
    if (!st) return null;
    if (/dur=\d|;desc=/i.test(st))
      return `Server-Timing header exposes performance details: ${st.slice(0, 100)}`;
    return null;
  },

  "document-policy-missing": (_url, headers) => {
    if (!hasHeader(headers, "document-policy")) {
      return "Document-Policy header not set.";
    }
    return null;
  },

  "origin-agent-cluster": (_url, headers) => {
    if (!hasHeader(headers, "origin-agent-cluster")) {
      return "Origin-Agent-Cluster header not set (helps isolate origins).";
    }
    return null;
  },

  "nel-header-missing": (_url, headers) => {
    if (hasHeader(headers, "nel")) return null;
    return "NEL (Network Error Logging) header not present.";
  },

  "report-to-header-missing": (_url, headers) => {
    if (hasHeader(headers, "report-to")) return null;
    return "Report-To header not present.";
  },

  "x-dns-prefetch-control-off": (_url, headers) => {
    const v = h(headers, "x-dns-prefetch-control");
    if (v && v.toLowerCase() === "off") {
      return "X-DNS-Prefetch-Control is off - may impact performance.";
    }
    return null;
  },

  "access-control-expose-broad": (_url, headers) => {
    const v = h(headers, "access-control-expose-headers");
    if (!v) return null;
    const exposed = v.split(",").map((s) => s.trim().toLowerCase());
    if (exposed.length < 5) return null;
    return `Access-Control-Expose-Headers exposes ${exposed.length} headers: ${exposed.join(", ")}.`;
  },

  "access-control-max-age-long": (_url, headers) => {
    const v = h(headers, "access-control-max-age");
    if (!v) return null;
    const seconds = parseInt(v, 10);
    if (isNaN(seconds) || seconds < 86400) return null;
    return `Access-Control-Max-Age set to ${seconds}s (${Math.round(seconds / 3600)}h). Preflight results cached excessively.`;
  },

  "clickjacking-frameable": (_url, headers) => {
    const xfo = h(headers, "x-frame-options");
    const csp = h(headers, "content-security-policy");
    if (xfo) return null;
    if (csp && csp.includes("frame-ancestors")) return null;
    return "No framing protection detected (no X-Frame-Options, no CSP frame-ancestors).";
  },

  // ── Vary / cache coordination ────────────────────────────────────────────

  "vary-header-missing": (_url, headers) => {
    const ct = h(headers, "content-type") || "";
    const vary = h(headers, "vary");
    if (!vary && /text\/html|application\/json/i.test(ct)) {
      return "Response has a varying Content-Type but no Vary header — risk of cache poisoning.";
    }
    if (!vary && ct) {
      return "Vary header missing on a typed response — verify caching strategy across Accept-* headers.";
    }
    return null;
  },

  "vary-header-missing-user-agent": (_url, headers) => {
    const vary = h(headers, "vary");
    const ct = h(headers, "content-type") || "";
    if (/text\/html/i.test(ct) && (!vary || !/user-agent/i.test(vary))) {
      return "HTML page is served without Vary: User-Agent — risk of incorrect content delivery across devices.";
    }
    if (ct && !vary) {
      return "Response with a content type but no Vary header — add Vary: User-Agent if content differs by UA.";
    }
    return null;
  },

  "vary-header-cookie": (_url, headers) => {
    const cookies = getSetCookies(headers);
    const vary = h(headers, "vary");
    if (cookies.length > 0 && (!vary || !/cookie/i.test(vary))) {
      return "Cookies are set on this response but Vary: Cookie is missing — auth-gated content may be served to the wrong user.";
    }
    return null;
  },

  "vary-cookie-on-static-resource": (url, headers) => {
    const vary = h(headers, "vary");
    const isStatic =
      /\.(?:js|mjs|css|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|mp4|webm|mp3|pdf)(?:\?|$)/i.test(
        url,
      );
    if (vary && /cookie/i.test(vary) && isStatic) {
      return "Vary: Cookie is set on a static asset — every cache stores one copy per Cookie value, defeating caching.";
    }
    const cookies = getSetCookies(headers);
    if (cookies.length > 0 && (!vary || !/cookie/i.test(vary))) {
      return "Cookies are set on this response but Vary: Cookie is missing — affects caching of cookie-bearing responses.";
    }
    return null;
  },

  "vary-origin-missing-cors": (_url, headers) => {
    // Only fires when the response actually uses dynamic CORS. Without
    // Access-Control-Allow-Origin (or with wildcard '*'), there is no
    // per-origin cache poisoning risk, so Vary: Origin is unnecessary.
    const acao = h(headers, "access-control-allow-origin");
    const vary = h(headers, "vary");
    if (!acao || acao === "*") return null;
    if (!vary || !/origin/i.test(vary)) {
      return `Access-Control-Allow-Origin: ${acao} is dynamic but Vary: Origin is missing — cache poisoning risk across origins.`;
    }
    return null;
  },

  "transfer-encoding-chunked": (_url, headers) => {
    const te = h(headers, "transfer-encoding");
    if (te && /chunked/i.test(te)) {
      return "Transfer-Encoding: chunked in use — verify cacheability and prefer Content-Length where possible.";
    }
    const ct = h(headers, "content-type") || "";
    if (
      /text\/html/i.test(ct) &&
      !hasHeader(headers, "content-length") &&
      !te
    ) {
      return "HTML response without explicit Content-Length and no Transfer-Encoding — server may stream/chunk.";
    }
    return null;
  },

  // ── Server-Timing / Timing-Allow-Origin ──────────────────────────────────

  "server-timing-allow-origin-public": (_url, headers) => {
    const st = h(headers, "server-timing");
    const tao = h(headers, "timing-allow-origin");
    if (st && (!tao || tao === "*")) {
      return "Server-Timing header is exposed publicly — restrict with Timing-Allow-Origin to specific trusted origins.";
    }
    return null;
  },

  "server-timing-cache-timings": (_url, headers) => {
    const st = h(headers, "server-timing");
    if (st && /cache|edge|origin/i.test(st) && /dur=/i.test(st)) {
      return "Server-Timing exposes cache hit/miss timings (e.g. cache;dur=12) — strip cache-specific entries in production.";
    }
    return null;
  },

  // ── Content-Disposition / downloads ──────────────────────────────────────

  "content-disposition-inline": (_url, headers) => {
    const cd = h(headers, "content-disposition");
    if (cd && /^\s*inline/i.test(cd)) {
      return "Content-Disposition: inline is in use — sensitive downloads (PDF, images) can be exfiltrated via iframes.";
    }
    if (!cd) {
      return "No Content-Disposition header — verify that download endpoints use 'attachment' for sensitive files.";
    }
    return null;
  },

  // ── Cookie hygiene ───────────────────────────────────────────────────────

  "cookie-too-large": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      if (c.length > 4096) {
        return `Set-Cookie header is ${c.length} bytes (limit ~4096) — browsers will silently drop the cookie.`;
      }
    }
    if (cookies.length > 0) {
      return `Set-Cookie header present (${cookies.length} cookie(s)) — verify each stays under the ~4KB per-cookie limit.`;
    }
    return null;
  },

  "debug-via-cookie": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      if (/debug\s*=\s*(?:1|true|yes)/i.test(c) || /X-Debug/i.test(c)) {
        return "Debug flag set via cookie — easy to forget when promoting from staging to production.";
      }
    }
    if (cookies.length > 0) {
      return `Cookie present (${cookies.length}) — verify no debug toggles (debug=1, X-Debug) are exposed via cookies.`;
    }
    return null;
  },

  // ── NEL (Network Error Logging) ──────────────────────────────────────────

  "nel-missing": (_url, headers) => {
    if (hasHeader(headers, "nel") || hasHeader(headers, "report-to"))
      return null;
    const ct = h(headers, "content-type") || "";
    if (/text\/html/i.test(ct)) {
      return "HTML page has no NEL (Network Error Logging) or Report-To header — add for visibility into connectivity failures.";
    }
    return null;
  },

  // ── Legacy XSS header ────────────────────────────────────────────────────

  "x-xss-protection-block": (_url, headers) => {
    const xss = h(headers, "x-xss-protection");
    if (xss && /1\s*;\s*mode\s*=\s*block/i.test(xss)) {
      return "X-XSS-Protection: 1; mode=block is deprecated — remove and rely on a strict Content-Security-Policy.";
    }
    const ct = h(headers, "content-type") || "";
    if (/text\/html/i.test(ct) && !xss) {
      return "HTML page has no X-XSS-Protection — that's correct (deprecated); ensure CSP is the actual defense.";
    }
    return null;
  },

  // ── CDN cache / request ID headers ───────────────────────────────────────

  "x-amz-cf-id": (_url, headers) => {
    if (hasHeader(headers, "x-amz-cf-id")) {
      return "X-Amz-Cf-Id exposes CloudFront request ID — strip at the edge via Lambda@Edge if not needed.";
    }
    const ct = h(headers, "content-type") || "";
    if (/text\/html/i.test(ct)) {
      return "HTML page is not behind CloudFront (no X-Amz-Cf-Id) — confirm that the header stays stripped if CloudFront is added.";
    }
    return null;
  },

  "x-cache-status-cloudflare": (_url, headers) => {
    if (hasHeader(headers, "x-cache-status")) {
      return "X-Cache-Status reveals Cloudflare cache state — strip at the origin if cache status is not for clients.";
    }
    const ct = h(headers, "content-type") || "";
    if (/text\/html/i.test(ct)) {
      return "HTML page has no X-Cache-Status — if fronted by Cloudflare, ensure the header is stripped at the origin.";
    }
    return null;
  },

  "x-vercel-cache": (_url, headers) => {
    if (hasHeader(headers, "x-vercel-cache")) {
      return "X-Vercel-Cache reveals Vercel edge cache state (HIT/MISS/BYPASS) — drop at the edge or set Cache-Control: private.";
    }
    const ct = h(headers, "content-type") || "";
    if (/text\/html/i.test(ct)) {
      return "HTML page has no X-Vercel-Cache — if deployed on Vercel, confirm the header is dropped or Cache-Control: private is set.";
    }
    return null;
  },

  "x-nextjs-cache": (_url, headers) => {
    if (hasHeader(headers, "x-nextjs-cache")) {
      return "X-Nextjs-Cache reveals Next.js ISR cache state (HIT/MISS/STALE/BYPASS) — remove in next.config.js for production.";
    }
    const ct = h(headers, "content-type") || "";
    if (/text\/html/i.test(ct)) {
      return "HTML page has no X-Nextjs-Cache — if using Next.js, confirm the header is removed in next.config.js for production.";
    }
    return null;
  },

  "x-netlify-cache": (_url, headers) => {
    if (hasHeader(headers, "x-netlify-cache")) {
      return "X-Netlify-Cache exposes Netlify CDN cache state (HIT/MISS/PASS/REVALIDATE) — strip via _headers if not needed.";
    }
    const ct = h(headers, "content-type") || "";
    if (/text\/html/i.test(ct)) {
      return "HTML page has no X-Netlify-Cache — if hosted on Netlify, confirm the header is stripped via _headers.";
    }
    return null;
  },

  "x-cache-hits": (_url, headers) => {
    if (hasHeader(headers, "x-cache-hits")) {
      return "X-Cache-Hits exposes how often an asset was served from cache — strip if cache-usage patterns are sensitive.";
    }
    const ct = h(headers, "content-type") || "";
    if (/text\/html/i.test(ct)) {
      return "HTML page has no X-Cache-Hits — if fronted by Cloudflare/Fastly, confirm the header is stripped.";
    }
    return null;
  },

  // ── RateLimit (draft RFC) ────────────────────────────────────────────────

  "ratelimit-policy-missing": (url, headers) => {
    if (
      hasHeader(headers, "ratelimit-limit") &&
      !hasHeader(headers, "ratelimit-policy")
    ) {
      return "RateLimit-Limit is set without RateLimit-Policy — clients cannot interpret the window or quota unit.";
    }
    if (
      /^https?:\/\/api\./i.test(url) &&
      !hasHeader(headers, "ratelimit-limit")
    ) {
      return "API endpoint has no RateLimit-* family headers — consider emitting RateLimit-Limit and RateLimit-Policy.";
    }
    if (
      hasHeader(headers, "authorization") &&
      !hasHeader(headers, "ratelimit-limit")
    ) {
      return "Authenticated response has no RateLimit-* headers — add RateLimit-Limit + RateLimit-Policy for client backoff.";
    }
    return null;
  },
};
