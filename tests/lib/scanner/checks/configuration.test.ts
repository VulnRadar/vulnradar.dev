/**
 * Per-detector tests for the configuration category.
 *
 * Covers every detector in lib/scanner/checks/configuration.ts. Every
 * detector is exercised by the smoke harness (callable, no-throw,
 * deterministic); the curated fixtures below cover the high-signal
 * server-identity and debug-header checks.
 */

import { detectors } from "@/lib/scanner/checks/configuration";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  // ── Server / framework identity disclosure ──────────────────────────

  // ── Cache / ETag / Date ─────────────────────────────────────────────

  // ── Debug headers ────────────────────────────────────────────────────

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
    {
      // The failure mode is a SHARED cache handing a stored compressed body
      // to a client that never asked for compression. A response no shared
      // cache may store cannot do that, which is the same exemption
      // vary-header-cookie already applies.
      description:
        "gzip response marked Cache-Control: no-store does not fire -- nothing can store it, so there is nothing to mis-serve",
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-encoding": "gzip",
        "cache-control": "no-store",
      },
      expect: "skip",
    },
    {
      description:
        "Accept-Encoding among the other tokens a Next.js page varies on",
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-encoding": "br",
        vary: "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding",
      },
      expect: "skip",
    },
    {
      description:
        "Content-Encoding: identity is not compression and does not fire",
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-encoding": "identity",
      },
      expect: "skip",
    },
  ],

  "vary-header-cookie": [
    {
      // A cookie is not a shared-cache problem until something says a shared
      // cache may keep the response.
      description: "a cookie on a response nothing marks as shared-cacheable",
      cookies: ["SESSIONID=abc; HttpOnly"],
      headers: { "content-type": "text/html" },
      expect: "skip",
    },
    {
      description: "the session cookie and a cf-cache-status HIT",
      cookies: ["sid=abc; HttpOnly"],
      headers: { "content-type": "text/html", "cf-cache-status": "HIT" },
      expect: "fire",
      evidenceIncludes: "sid",
    },
    {
      description: "an X-Cache hit, including CloudFront's RefreshHit",
      cookies: ["sid=abc; HttpOnly"],
      headers: {
        "content-type": "text/html",
        "x-cache": "RefreshHit from cloudfront",
      },
      expect: "fire",
      evidenceIncludes: "X-Cache",
    },
    {
      description: "Age above zero means a cache served this",
      cookies: ["sid=abc; HttpOnly"],
      headers: { "content-type": "text/html", age: "120" },
      expect: "fire",
      evidenceIncludes: "Age: 120",
    },
    {
      description: "s-maxage of one or more marks it shared-cacheable",
      cookies: ["sid=abc; HttpOnly"],
      headers: { "content-type": "text/html", "cache-control": "s-maxage=60" },
      expect: "fire",
      evidenceIncludes: "s-maxage",
    },
    {
      description: "s-maxage=0 does not",
      cookies: ["sid=abc; HttpOnly"],
      headers: { "content-type": "text/html", "cache-control": "s-maxage=0" },
      expect: "skip",
    },
    {
      // A cached response with Set-Cookie replays that cookie to every visitor
      // who sends none, and Vary: Cookie keys on exactly that absent header.
      description: "Vary: Cookie does not stop the cookie being replayed",
      cookies: ["sessionid=abc; HttpOnly"],
      headers: {
        "content-type": "text/html",
        "cache-control": "public, max-age=600",
        vary: "Cookie",
      },
      expect: "fire",
      evidenceIncludes: "sessionid",
    },
    {
      description: "the evidence names the cookie and never its value",
      cookies: ["sessionid=s3cretvalue; HttpOnly"],
      headers: {
        "content-type": "text/html",
        "cache-control": "public, max-age=600",
      },
      expect: "fire",
      evidenceIncludes: "Cache-Control: public, max-age=600",
      evidenceExcludes: "s3cretvalue",
    },
    {
      // Recorded from www.npmjs.com: Cloudflare adds these after the cache.
      description: "Cloudflare's own cookies on a cached public page",
      cookies: ["__cf_bm=abc; Path=/", "_cfuvid=def; Path=/"],
      headers: {
        "content-type": "text/html",
        "cache-control": "public, max-age=14400",
        "cf-cache-status": "HIT",
        age: "361",
      },
      expect: "skip",
    },
    {
      description: "the edge list covers other CDNs and load balancers",
      cookies: [
        "AWSALB=a",
        "AWSALBCORS=b",
        "incap_ses_123_456=c",
        "visid_incap_123=d",
        "nlbi_123=e",
        "ak_bmsc=f",
        "bm_sz=g",
        "bm_sv=h",
        "_abck=i",
        "datadome=j",
      ],
      headers: {
        "content-type": "text/html",
        "cache-control": "public, max-age=600",
      },
      expect: "skip",
    },
    {
      description: "an application cookie among edge cookies is still reported",
      cookies: ["__cf_bm=abc; Path=/", "cart=1; Path=/"],
      headers: {
        "content-type": "text/html",
        "cache-control": "public, max-age=600",
      },
      expect: "fire",
      evidenceIncludes: "cart",
      evidenceExcludes: "__cf_bm",
    },
    {
      // Recorded from gamba.com: DYNAMIC means Cloudflare did not cache it.
      description: "an application cookie on a dynamic response",
      cookies: ["locale=en; Path=/; SameSite=Lax"],
      headers: { "content-type": "text/html", "cf-cache-status": "DYNAMIC" },
      expect: "skip",
    },
    {
      // Recorded from nullkommawein.de, a Shopify store.
      description: "Shopify's cookies on a private response",
      cookies: ["localization=DE; path=/", "cart_currency=EUR; path=/"],
      headers: {
        "content-type": "text/html",
        "cache-control": "private, max-age=0, must-revalidate",
        "cf-cache-status": "DYNAMIC",
      },
      expect: "skip",
    },
    {
      description: "no cookies at all",
      headers: {
        "content-type": "text/html",
        "cache-control": "public, max-age=600",
      },
      expect: "skip",
    },
    {
      description: "Vary: Cookie with nothing marking it cacheable",
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
      description: "Cache-Control: public means a shared cache can store this",
      cookies: ["SESSIONID=abc; HttpOnly"],
      headers: {
        "content-type": "text/html",
        "cache-control": "public, max-age=3600",
      },
      expect: "fire",
      evidenceIncludes: "SESSIONID",
    },
    {
      // vary-cookie-on-static-resource reports Vary: Cookie on a static
      // asset as a defect, so demanding it here on the same URL made the
      // two checks contradict each other. A CDN attaching a bot-management
      // or analytics cookie to a .js response is common and the body is
      // identical for every visitor.
      description:
        "a bundled .js asset that happens to carry a Set-Cookie does not fire -- the body is the same bytes for every user",
      url: "https://example.com/_next/static/chunks/main.js",
      cookies: ["analytics=abc; Path=/"],
      headers: {
        "content-type": "application/javascript",
        "cache-control": "public, max-age=31536000",
      },
      expect: "skip",
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
      evidenceIncludes: "Vary: Origin",
    },
    {
      // The scanner sends no Origin header, so a value naming the page itself
      // is a constant, and a constant needs no Vary. Recorded on
      // www.abercrombie.com.
      description: "ACAO is the scanned page's own origin",
      url: "https://www.example.com/some/page",
      headers: { "access-control-allow-origin": "https://www.example.com" },
      expect: "skip",
    },
    {
      description: "the own-origin comparison ignores case",
      url: "https://www.example.com/",
      headers: { "access-control-allow-origin": "https://WWW.example.com" },
      expect: "skip",
    },
    {
      description: "a different port is a different origin",
      url: "https://www.example.com/",
      headers: {
        "access-control-allow-origin": "https://www.example.com:8443",
      },
      expect: "fire",
      evidenceIncludes: "Vary: Origin",
    },
    {
      description: "Vary: Origin present",
      url: "https://api.example.com/",
      headers: {
        "access-control-allow-origin": "https://app.example.com",
        vary: "Origin",
      },
      expect: "skip",
    },
  ],

  // ── Server-Timing ────────────────────────────────────────────────────

  "server-timing-allow-origin-public": [
    {
      description: "Server-Timing + Timing-Allow-Origin: *",
      headers: {
        "server-timing": "cache;dur=100",
        "timing-allow-origin": "*",
      },
      expect: "fire",
    },
    {
      description: "the wildcard inside a list of origins",
      headers: {
        "server-timing": "db;dur=53",
        "timing-allow-origin": "https://a.example, *",
      },
      expect: "fire",
    },
    {
      // Without Timing-Allow-Origin another origin reads no serverTiming
      // entries at all. This was reported as "exposed publicly".
      description: "regression: Server-Timing with no Timing-Allow-Origin",
      headers: { "server-timing": 'chlray;desc="a3db96a95d6655b5"' },
      expect: "skip",
    },
    {
      description: "Timing-Allow-Origin naming one trusted origin",
      headers: {
        "server-timing": "db;dur=53",
        "timing-allow-origin": "https://monitor.example",
      },
      expect: "skip",
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

  // ── Cross-origin / Cross-domain ─────────────────────────────────────

  // ── Server version detail ───────────────────────────────────────────

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
