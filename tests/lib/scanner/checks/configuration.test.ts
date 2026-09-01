/**
 * Per-detector tests for the configuration category.
 *
 * Covers 49 detectors in lib/scanner/checks/configuration.ts. Every
 * detector is exercised by the smoke harness (callable, no-throw,
 * deterministic); the curated fixtures below cover the high-signal
 * server-identity and debug-header checks.
 */

import { detectors } from "@/lib/scanner/checks/configuration";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  // ── Server / framework identity disclosure ──────────────────────────

  "server-header-disclosure": [
    {
      description: "Server: nginx/1.18.0",
      headers: { server: "nginx/1.18.0" },
      expect: "fire",
      evidenceIncludes: "nginx",
    },
    {
      description: "Server: Apache/2.4",
      headers: { server: "Apache/2.4.41" },
      expect: "fire",
      evidenceIncludes: "Apache",
    },
    {
      description: "Server: cloudflare (acceptable)",
      headers: { server: "cloudflare" },
      expect: "skip",
    },
    {
      description: "no Server header",
      headers: {},
      expect: "skip",
    },
  ],

  "x-powered-by-exposed": [
    {
      description: "X-Powered-By: Express",
      headers: { "x-powered-by": "Express" },
      expect: "fire",
      evidenceIncludes: "Express",
    },
    {
      description: "no X-Powered-By",
      headers: {},
      expect: "skip",
    },
  ],

  "x-aspnet-version-exposed": [
    {
      description: "X-AspNet-Version exposed",
      headers: { "x-aspnet-version": "4.0.30319" },
      expect: "fire",
      evidenceIncludes: "AspNet",
    },
  ],

  "x-aspnetmvc-version-exposed": [
    {
      description: "X-AspNetMvc-Version exposed",
      headers: { "x-aspnetmvc-version": "5.2.7" },
      expect: "fire",
    },
  ],

  "via-header-exposed": [
    {
      description: "Via: 1.1 varnish",
      headers: { via: "1.1 varnish" },
      expect: "fire",
    },
  ],

  "x-runtime-exposed": [
    {
      description: "X-Runtime: 0.045",
      headers: { "x-runtime": "0.045" },
      expect: "fire",
    },
  ],

  "x-request-id-exposed": [
    {
      description: "removed — request-id is not a security finding",
      headers: { "x-request-id": "abc-123" },
      expect: "skip",
    },
  ],

  "x-backend-server-exposed": [
    {
      description: "X-Served-By present",
      headers: { "x-served-by": "cache-lga21920-LGA" },
      expect: "fire",
    },
  ],

  // ── Cache / ETag / Date ─────────────────────────────────────────────

  "age-header-reveals-cdn": [
    {
      description: "removed — CDN Age header is not a security finding",
      headers: { age: "300" },
      expect: "skip",
    },
  ],

  "cache-control-missing": [
    {
      description: "no cache-control or pragma",
      expect: "fire",
    },
    {
      description: "Cache-Control present",
      headers: { "cache-control": "no-store" },
      expect: "skip",
    },
  ],

  "cache-control-public-sensitive": [
    {
      description: "Cache-Control: public on page with login form",
      url: "https://example.com/login",
      headers: { "cache-control": "public, max-age=3600" },
      body: '<html><body><form method="POST"><input type="password" name="pwd"></form></body></html>',
      expect: "fire",
    },
    {
      description: "Cache-Control: public on page WITHOUT forms (no fire)",
      url: "https://example.com/about",
      headers: { "cache-control": "public" },
      expect: "skip",
    },
    {
      // ref: AUDIT-010#scanner-10. A public newsletter/contact/search POST
      // form carries nothing user-specific, so a normal CDN cache policy on
      // the page it lives on is correct, not a finding.
      description:
        "public newsletter-signup POST form with no sensitive field (no fire)",
      url: "https://example.com/",
      headers: { "cache-control": "public, max-age=3600" },
      body: '<html><body><form method="post" action="/newsletter"><input name="email"></form></body></html>',
      expect: "skip",
    },
  ],

  "etag-inode": [
    {
      description: "removed — duplicate of etag-inode-leak",
      headers: { etag: '"65d4a-1234-5f0a9bcd"' },
      expect: "skip",
    },
  ],

  "etag-inode-leak": [
    {
      description: "inode-style ETag",
      headers: { etag: '"abc-def-123"' },
      expect: "fire",
    },
  ],

  "date-time-skew": [
    {
      description: "Date header skewed",
      headers: { date: "Wed, 01 Jan 2025 00:00:00 GMT" },
      expect: "fire",
    },
  ],

  // ── Debug headers ────────────────────────────────────────────────────

  "x-debug-header-exposed": [
    {
      description: "X-Debug-Token present",
      headers: { "x-debug-token": "abc-123" },
      expect: "fire",
    },
  ],

  "debug-via-cookie": [
    {
      description: "X-Debug-Bar cookie enables debug mode",
      cookies: ["X-Debug-Bar=1; Path=/"],
      expect: "fire",
    },
    {
      description: "debug=1 cookie",
      cookies: ["debug=1; Path=/"],
      expect: "fire",
    },
    {
      // A multi-flag preferences cookie whose VALUE happens to embed the
      // substring "debug=true" is not a server debug toggle; the cookie's
      // own name ("prefs") must be the debug flag, not its serialized value.
      description:
        "unrelated cookie whose value embeds 'debug=true' does not fire",
      cookies: ["prefs=theme=dark&debug=true&lang=en; Path=/"],
      expect: "skip",
    },
  ],

  // ── CDN identity ────────────────────────────────────────────────────

  "x-amz-request-id": [
    {
      description: "X-Amz-Request-Id present",
      headers: { "x-amz-request-id": "ABC123" },
      expect: "fire",
    },
  ],

  "cf-ray-header": [
    {
      description:
        "removed — CDN presence is not actionable security information",
      headers: { "cf-ray": "12345abc-SJC" },
      expect: "skip",
    },
  ],

  "x-vercel-id": [
    {
      description:
        "removed — CDN presence is not actionable security information",
      headers: { "x-vercel-id": "iad1::abc123" },
      expect: "skip",
    },
  ],

  "x-cache-header": [
    {
      description: "removed — cache state is not a security finding",
      headers: { "x-cache": "HIT from cache.example.com" },
      expect: "skip",
    },
  ],

  "x-cache-status-cloudflare": [
    {
      description: "X-Cache-Status present (Cloudflare cache state leaked)",
      headers: { "x-cache-status": "HIT" },
      expect: "fire",
    },
  ],

  "x-vercel-cache": [
    {
      description: "X-Vercel-Cache exposed",
      headers: { "x-vercel-cache": "HIT" },
      expect: "fire",
    },
  ],

  "x-nextjs-cache": [
    {
      description: "X-Nextjs-Cache exposed",
      headers: { "x-nextjs-cache": "HIT" },
      expect: "fire",
    },
  ],

  "x-netlify-cache": [
    {
      description: "X-Netlify-Cache present (Netlify cache state leaked)",
      headers: { "x-netlify-cache": "HIT" },
      expect: "fire",
    },
  ],

  "x-cache-hits": [
    {
      description: "X-Cache-Hits exposed",
      headers: { "x-cache-hits": "5" },
      expect: "fire",
    },
  ],

  // ── Vary header ─────────────────────────────────────────────────────

  "vary-header-missing": [
    {
      description: "gzip response missing Vary: Accept-Encoding",
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-encoding": "gzip",
      },
      expect: "fire",
    },
    {
      description: "gzip response with Vary: Accept-Encoding present",
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-encoding": "gzip",
        vary: "Accept-Encoding",
      },
      expect: "skip",
    },
    {
      // The description/fixSteps are scoped to compressed responses; the
      // code previously fired on ANY typed response missing ANY Vary
      // header, with no Content-Encoding check at all.
      description:
        "uncompressed HTML response with no Vary header no longer fires",
      headers: { "content-type": "text/html; charset=utf-8" },
      expect: "skip",
    },
  ],

  "vary-header-missing-user-agent": [
    {
      description:
        "removed — fires on every modern responsive site (can't detect UA-based serving without two requests)",
      url: "https://example.com/mobile",
      headers: { "content-type": "text/html; charset=utf-8" },
      expect: "skip",
    },
  ],

  "vary-header-cookie": [
    {
      description:
        "cookies set but no Vary: Cookie (auth-gated content may cache wrong)",
      cookies: ["SESSIONID=abc; HttpOnly"],
      headers: { "content-type": "text/html" },
      expect: "fire",
    },
    {
      description: "Vary: Cookie present (good)",
      cookies: ["SESSIONID=abc; HttpOnly"],
      headers: { "content-type": "text/html", vary: "Cookie" },
      expect: "skip",
    },
    {
      description:
        "Cache-Control: no-store makes a missing Vary: Cookie non-exploitable (nothing can cache this response at all)",
      cookies: ["SESSIONID=abc; HttpOnly"],
      headers: {
        "content-type": "text/html",
        "cache-control": "no-cache, no-store, must-revalidate",
      },
      expect: "skip",
    },
    {
      description:
        "Cache-Control: private is also non-cacheable by a shared cache",
      cookies: ["SESSIONID=abc; HttpOnly"],
      headers: { "content-type": "text/html", "cache-control": "private" },
      expect: "skip",
    },
    {
      description:
        "Cache-Control: public still needs Vary: Cookie — a shared cache can store this one",
      cookies: ["SESSIONID=abc; HttpOnly"],
      headers: {
        "content-type": "text/html",
        "cache-control": "public, max-age=3600",
      },
      expect: "fire",
    },
  ],

  "vary-cookie-on-static-resource": [
    {
      description: "Vary: Cookie on /static/",
      url: "https://example.com/static/logo.png",
      headers: { vary: "Cookie" },
      expect: "fire",
    },
  ],

  "vary-origin-missing-cors": [
    {
      description: "ACAO dynamic, no Vary: Origin",
      url: "https://api.example.com/",
      headers: { "access-control-allow-origin": "https://app.example.com" },
      expect: "fire",
    },
  ],

  // ── Server-Timing ────────────────────────────────────────────────────

  "server-timing-exposure": [
    {
      description: "Server-Timing exposed",
      headers: { "server-timing": "cache;dur=100, db;dur=42" },
      expect: "fire",
    },
  ],

  "server-timing-allow-origin-public": [
    {
      description: "Server-Timing + Timing-Allow-Origin: *",
      headers: {
        "server-timing": "cache;dur=100",
        "timing-allow-origin": "*",
      },
      expect: "fire",
    },
  ],

  "server-timing-cache-timings": [
    {
      description: "Server-Timing leaks cache internal timings",
      headers: { "server-timing": "cache-hit;dur=2, miss;dur=15" },
      expect: "fire",
    },
  ],

  // ── Origin / NEL ─────────────────────────────────────────────────────

  "origin-agent-cluster": [
    {
      description: "removed — performance hint, not a security requirement",
      expect: "skip",
    },
  ],

  "nel-missing": [
    {
      description: "HTML page without NEL or Report-To",
      headers: { "content-type": "text/html; charset=utf-8" },
      expect: "fire",
    },
    {
      description: "NEL present",
      headers: {
        "content-type": "text/html; charset=utf-8",
        nel: '{"report_to":"default","max_age":31536000}',
      },
      expect: "skip",
    },
  ],

  "nel-header-missing": [
    {
      description:
        "removed — duplicate of nel-missing (which gates on HTML content-type)",
      expect: "skip",
    },
  ],

  "report-to-header-missing": [
    {
      description: "removed — duplicate of nel-missing",
      expect: "skip",
    },
  ],

  // ── Cookies / size ──────────────────────────────────────────────────

  "cookie-too-large": [
    {
      description: "cookie > 4 KB",
      cookies: [`session=${"a".repeat(5000)}`],
      expect: "fire",
    },
    {
      description: "small cookie does not trigger (fallback removed)",
      cookies: ["session=abc"],
      expect: "skip",
    },
  ],

  // ── Content / Transfer-Encoding ─────────────────────────────────────

  "transfer-encoding-chunked": [
    {
      description: "removed — performance concern, not a security finding",
      headers: { "transfer-encoding": "chunked" },
      expect: "skip",
    },
  ],

  "content-disposition-inline": [
    {
      description:
        "Content-Disposition: inline on PDF (binary MIME type fires)",
      headers: {
        "content-disposition": "inline",
        "content-type": "application/pdf",
      },
      expect: "fire",
    },
    {
      description:
        "Content-Disposition: inline on HTML (not a binary type, skip)",
      headers: { "content-disposition": "inline", "content-type": "text/html" },
      expect: "skip",
    },
    {
      description: "No Content-Disposition on binary response",
      headers: { "content-type": "application/octet-stream" },
      expect: "fire",
    },
    {
      // An <img> is *supposed* to render inline — the previous regex also
      // matched image/audio/video, so this fired on virtually every image
      // on every site. ref: AUDIT-008#scanner-11
      description:
        "no Content-Disposition on a plain image is normal, not a finding",
      headers: { "content-type": "image/png" },
      expect: "skip",
    },
    {
      description: "inline on a video response is normal, not a finding",
      headers: { "content-disposition": "inline", "content-type": "video/mp4" },
      expect: "skip",
    },
  ],

  "x-dns-prefetch-control-off": [
    {
      description: "X-DNS-Prefetch-Control off (informational)",
      headers: { "x-dns-prefetch-control": "off" },
      expect: "fire",
    },
  ],

  // ── Cross-origin / Cross-domain ─────────────────────────────────────

  "access-control-expose-broad": [
    {
      description: "Access-Control-Expose-Headers exposes many headers (>=5)",
      headers: {
        "access-control-expose-headers":
          "X-User-Id, X-User-Roles, X-Auth-Token, X-RateLimit-Remaining, X-Request-Id",
      },
      expect: "fire",
    },
    {
      description: "Access-Control-Expose-Headers with 1 header",
      headers: { "access-control-expose-headers": "X-Request-Id" },
      expect: "skip",
    },
  ],

  "access-control-max-age-long": [
    {
      description: "Access-Control-Max-Age > 24h",
      headers: { "access-control-max-age": "86400" },
      expect: "fire",
    },
  ],

  "clickjacking-frameable": [
    {
      description:
        "page can be framed (no X-Frame-Options, no CSP frame-ancestors)",
      expect: "fire",
    },
    {
      description: "X-Frame-Options: SAMEORIGIN",
      headers: { "x-frame-options": "SAMEORIGIN" },
      expect: "skip",
    },
  ],

  // ── Server version detail ───────────────────────────────────────────

  "server-version-detailed": [
    {
      description: "removed — duplicate of server-header-disclosure",
      headers: { server: "nginx/1.18.0" },
      expect: "skip",
    },
  ],

  "x-amz-cf-id": [
    {
      description: "X-Amz-Cf-Id header exposed",
      headers: { "x-amz-cf-id": "abc123=" },
      expect: "fire",
    },
  ],

  "x-xss-protection-block": [
    {
      description: "X-XSS-Protection: 1; mode=block",
      headers: { "x-xss-protection": "1; mode=block" },
      expect: "fire",
    },
    {
      // Previously this "fired" a finding whose own evidence text said
      // "that's correct" — omitting the deprecated header is the
      // recommended state on every modern HTML page and must not be
      // reported as a finding. ref: AUDIT-008#scanner-12
      description:
        "HTML page correctly omitting the deprecated header is not a finding",
      headers: { "content-type": "text/html" },
      expect: "skip",
    },
  ],

  "document-policy-missing": [
    {
      description: "removed — experimental header, not a security requirement",
      expect: "skip",
    },
  ],

  "ratelimit-policy-missing": [
    {
      description: "no RateLimit-Policy header on API",
      url: "https://api.example.com/v1/users",
      expect: "fire",
    },
    {
      // The description promises checking the legacy X-RateLimit-* family
      // too; the code only checked the new unprefixed name, producing false
      // positives against APIs (GitHub, Twitter/X, etc.) using the still-
      // common legacy convention. ref: AUDIT-008#scanner-10
      description: "legacy X-RateLimit-Limit header satisfies the check",
      url: "https://api.example.com/v1/users",
      headers: { "x-ratelimit-limit": "1000" },
      expect: "skip",
    },
    {
      description: "Retry-After header satisfies the check",
      url: "https://api.example.com/v1/users",
      headers: { "retry-after": "30" },
      expect: "skip",
    },
  ],

  // ── Config / debug artifact exposure ─────────────────────────────────

  "dotenv-file-content-leaked": [
    {
      description: "real .env leak with an actual APP_KEY value",
      headers: { "content-type": "text/plain" },
      body: "APP_ENV=production\nAPP_KEY=base64:XyzAbc123==\nDB_PASSWORD=hunter2",
      expect: "fire",
    },
    {
      // APP_ENV/APP_DEBUG alone are not credentials — a status endpoint
      // echoing these two flags is not a leaked .env file.
      description: "status endpoint echoing only APP_ENV/APP_DEBUG flags",
      headers: { "content-type": "text/plain" },
      body: "APP_ENV=production\nAPP_DEBUG=false",
      expect: "skip",
    },
    {
      description: "blank .env.example template with no real values",
      headers: { "content-type": "text/plain" },
      body: "APP_KEY=\nDB_PASSWORD=\nDB_HOST=127.0.0.1",
      expect: "skip",
    },
  ],

  "debug-toolbar-assets-exposed": [
    {
      description: "Laravel Debugbar asset actually loaded on the page",
      body: '<html><body><script src="/_debugbar/assets/debugbar.js"></script></body></html>',
      expect: "fire",
    },
    {
      description:
        "tutorial blog post showing the install snippet in a <pre><code> block",
      body: '<html><body><p>Example install snippet:</p><pre><code>&lt;script src="/_debugbar/assets/debugbar.js"&gt;&lt;/script&gt;</code></pre></body></html>',
      expect: "skip",
    },
    {
      // The doc-context guard must be applied per occurrence: a benign
      // snippet FIRST must not clear a real, injected reference later on the
      // same page. The filler keeps the second hit outside the 200-char
      // lookback window that classifies a hit as doc context.
      description:
        "doc snippet first, then the debugger's real injected asset lower down - still fires",
      body:
        '<html><body><pre><code>&lt;script src="/_debugbar/assets/debugbar.js"&gt;&lt;/script&gt;</code></pre>' +
        "<p>Release notes for this build follow. </p>".repeat(8) +
        '<footer><script src="/_debugbar/assets/debugbar.js"></script></footer></body></html>',
      expect: "fire",
      evidenceIncludes: "Debugbar",
    },
    {
      description:
        "Django: doc snippet first, then the toolbar's real asset lower down - still fires",
      body:
        "<html><body><pre><code>/static/debug_toolbar/js/toolbar.js</code></pre>" +
        "<p>Release notes for this build follow. </p>".repeat(8) +
        '<script src="/static/debug_toolbar/js/toolbar.js"></script></body></html>',
      expect: "fire",
      evidenceIncludes: "Debug Toolbar",
    },
  ],
};

runDetectorTests(detectors, fixtures);
