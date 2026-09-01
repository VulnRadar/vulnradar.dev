/**
 * Per-detector tests for the headers category.
 *
 * Covers ~140 detectors in lib/scanner/checks/headers.ts. Every detector
 * is exercised by the smoke harness (callable, no-throw, deterministic);
 * the curated fixtures below cover the high-signal checks.
 *
 * Fixture IDs match the actual detector map keys exactly. When in doubt
 * about a detector's behaviour, leave it smoke-only — the fixture-hygiene
 * test logs a warning for positive cases without evidenceIncludes but
 * does not block.
 */

import { detectors } from "@/lib/scanner/checks/headers";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  // ── Security header presence ────────────────────────────────────────

  "hsts-missing": [
    {
      description: "no HSTS header on https page",
      url: "https://example.com/",
      expect: "fire",
      evidenceIncludes: "Strict-Transport-Security",
    },
    {
      description: "HSTS present",
      url: "https://example.com/",
      headers: { "strict-transport-security": "max-age=31536000" },
      expect: "skip",
    },
    {
      description: "HTTP page — HSTS not applicable",
      url: "http://example.com/",
      expect: "skip",
    },
  ],

  "hsts-no-preload": [
    {
      description: "missing preload only (includeSubDomains present)",
      url: "https://example.com/",
      headers: {
        "strict-transport-security": "max-age=31536000; includeSubDomains",
      },
      expect: "fire",
      evidenceIncludes: "missing preload",
    },
    {
      // includeSubDomains has its own dedicated check now — this detector
      // must not double-report it. ref: AUDIT-008#scanner-05
      description:
        "missing includeSubDomains only is not reported here (covered by the dedicated check)",
      url: "https://example.com/",
      headers: { "strict-transport-security": "max-age=31536000; preload" },
      expect: "skip",
    },
    {
      description: "fully compliant HSTS",
      url: "https://example.com/",
      headers: {
        "strict-transport-security":
          "max-age=31536000; includeSubDomains; preload",
      },
      expect: "skip",
    },
  ],

  "strict-transport-security-include-subdomains": [
    {
      description: "HSTS without includeSubDomains",
      url: "https://example.com/",
      headers: { "strict-transport-security": "max-age=31536000; preload" },
      expect: "fire",
      evidenceIncludes: "includeSubDomains",
    },
    {
      description: "HSTS with includeSubDomains",
      url: "https://example.com/",
      headers: {
        "strict-transport-security": "max-age=31536000; includeSubDomains",
      },
      expect: "skip",
    },
  ],

  "csp-missing": [
    {
      description: "HTML page without CSP",
      url: "https://example.com/",
      headers: { "content-type": "text/html; charset=utf-8" },
      expect: "fire",
      evidenceIncludes: "Content-Security-Policy",
    },
    {
      description: "HTML page with CSP",
      url: "https://example.com/",
      headers: {
        "content-type": "text/html",
        "content-security-policy": "default-src 'self'",
      },
      expect: "skip",
    },
    {
      description: "JSON API response — CSP not required",
      url: "https://api.example.com/data",
      headers: { "content-type": "application/json" },
      expect: "skip",
    },
    {
      description:
        "CSP delivered only via <meta http-equiv> (GitHub Pages, S3 without a CloudFront function) is not reported as missing",
      url: "https://example.com/",
      headers: { "content-type": "text/html" },
      body: '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head></html>',
      expect: "skip",
    },
  ],

  "clickjack-missing": [
    {
      description: "no X-Frame-Options, no CSP frame-ancestors",
      url: "https://example.com/",
      expect: "fire",
      evidenceIncludes: "X-Frame-Options",
    },
    {
      description: "X-Frame-Options present",
      url: "https://example.com/",
      headers: { "x-frame-options": "DENY" },
      expect: "skip",
    },
  ],

  "xcto-missing": [
    {
      description: "no X-Content-Type-Options",
      url: "https://example.com/",
      expect: "fire",
      evidenceIncludes: "X-Content-Type-Options",
    },
    {
      description: "nosniff present",
      url: "https://example.com/",
      headers: { "x-content-type-options": "nosniff" },
      expect: "skip",
    },
  ],

  "nosniff-incorrect": [
    {
      description: "X-Content-Type-Options present but not nosniff",
      url: "https://example.com/",
      headers: { "x-content-type-options": "sniff" },
      expect: "fire",
      evidenceIncludes: "nosniff",
    },
    {
      description: "nosniff correctly set",
      url: "https://example.com/",
      headers: { "x-content-type-options": "nosniff" },
      expect: "skip",
    },
  ],

  "x-content-type-options-not-nosniff": [
    {
      // Disabled: exact duplicate of nosniff-incorrect on the same
      // condition. ref: AUDIT-008#scanner-05
      description:
        "disabled duplicate of nosniff-incorrect — never fires even with an invalid value present",
      url: "https://example.com/",
      headers: { "x-content-type-options": "sniff" },
      expect: "skip",
    },
  ],

  "xpcdp-missing": [
    {
      description: "no X-Permitted-Cross-Domain-Policies",
      url: "https://example.com/",
      expect: "fire",
      evidenceIncludes: "X-Permitted-Cross-Domain-Policies",
    },
    {
      description: "set to none",
      url: "https://example.com/",
      headers: { "x-permitted-cross-domain-policies": "none" },
      expect: "skip",
    },
    {
      description: "present but permissive",
      url: "https://example.com/",
      headers: { "x-permitted-cross-domain-policies": "all" },
      expect: "fire",
      evidenceIncludes: "not 'none'",
    },
  ],

  "origin-agent-cluster-missing": [
    {
      description: "no Origin-Agent-Cluster",
      url: "https://example.com/",
      expect: "fire",
      evidenceIncludes: "Origin-Agent-Cluster",
    },
    {
      description: "Origin-Agent-Cluster present",
      url: "https://example.com/",
      headers: { "origin-agent-cluster": "?1" },
      expect: "skip",
    },
  ],

  "permissions-policy-browsing-topics-blocked": [
    {
      description: "browsing-topics not mentioned — not flagged in isolation",
      url: "https://example.com/",
      expect: "skip",
    },
    {
      description: "browsing-topics explicitly allowed",
      url: "https://example.com/",
      headers: { "permissions-policy": "browsing-topics=*" },
      expect: "fire",
      evidenceIncludes: "browsing-topics",
    },
    {
      description: "browsing-topics blocked",
      url: "https://example.com/",
      headers: { "permissions-policy": "browsing-topics=()" },
      expect: "skip",
    },
  ],

  "referrer-policy-missing": [
    {
      description: "no Referrer-Policy",
      url: "https://example.com/",
      expect: "fire",
      evidenceIncludes: "Referrer-Policy",
    },
    {
      description: "Referrer-Policy present",
      url: "https://example.com/",
      headers: { "referrer-policy": "no-referrer" },
      expect: "skip",
    },
  ],

  "referrer-policy-unsafe": [
    {
      description: "unsafe-url leaks full URL",
      url: "https://example.com/",
      headers: { "referrer-policy": "unsafe-url" },
      expect: "fire",
      evidenceIncludes: "leaks full url",
    },
    {
      description:
        "origin is weaker but handled by the other check, not this one",
      url: "https://example.com/",
      headers: { "referrer-policy": "origin" },
      expect: "skip",
    },
  ],

  "referrer-policy-no-referrer-strict-origin-when-cross-origin": [
    {
      description: "origin is weaker than strict-origin-when-cross-origin",
      url: "https://example.com/",
      headers: { "referrer-policy": "origin" },
      expect: "fire",
      evidenceIncludes: "weaker",
    },
    {
      // unsafe-url is already reported by referrer-policy-unsafe at a higher
      // severity — don't double-count the same header value.
      // ref: AUDIT-008#scanner-05
      description:
        "unsafe-url is already reported by referrer-policy-unsafe — not double-counted here",
      url: "https://example.com/",
      headers: { "referrer-policy": "unsafe-url" },
      expect: "skip",
    },
    {
      description: "strict-origin-when-cross-origin is the recommended value",
      url: "https://example.com/",
      headers: { "referrer-policy": "strict-origin-when-cross-origin" },
      expect: "skip",
    },
  ],

  "permissions-policy-missing": [
    {
      description: "neither Permissions-Policy nor Feature-Policy",
      url: "https://example.com/",
      expect: "fire",
      evidenceIncludes: "Permissions-Policy",
    },
    {
      description: "Permissions-Policy present",
      url: "https://example.com/",
      headers: { "permissions-policy": "geolocation=()" },
      expect: "skip",
    },
  ],

  "coop-missing": [
    {
      description: "no Cross-Origin-Opener-Policy",
      url: "https://example.com/",
      expect: "fire",
      evidenceIncludes: "Cross-Origin-Opener-Policy",
    },
    {
      description: "COOP present",
      url: "https://example.com/",
      headers: { "cross-origin-opener-policy": "same-origin" },
      expect: "skip",
    },
  ],

  "corp-missing": [
    {
      // Disabled: exact duplicate of cross-origin-resource-policy-report-only-missing
      // (same header, same condition — CORP has no separate Report-Only
      // variant). ref: AUDIT-008#scanner-05
      description: "disabled duplicate — never fires even with CORP absent",
      url: "https://example.com/",
      expect: "skip",
    },
    {
      description: "CORP present",
      url: "https://example.com/",
      headers: { "cross-origin-resource-policy": "same-origin" },
      expect: "skip",
    },
  ],

  "cross-origin-resource-policy-report-only-missing": [
    {
      description: "no Cross-Origin-Resource-Policy",
      url: "https://example.com/",
      expect: "fire",
      evidenceIncludes: "Cross-Origin-Resource-Policy",
    },
    {
      description: "CORP present",
      url: "https://example.com/",
      headers: { "cross-origin-resource-policy": "same-origin" },
      expect: "skip",
    },
  ],

  "coep-missing": [
    {
      description: "no Cross-Origin-Embedder-Policy",
      url: "https://example.com/",
      expect: "fire",
      evidenceIncludes: "Cross-Origin-Embedder-Policy",
    },
    {
      description: "COEP present",
      url: "https://example.com/",
      headers: { "cross-origin-embedder-policy": "require-corp" },
      expect: "skip",
    },
  ],

  "xxss-protection-missing": [
    {
      description: "no X-XSS-Protection AND no CSP",
      url: "https://example.com/",
      expect: "fire",
    },
    {
      description: "CSP present (sufficient)",
      url: "https://example.com/",
      headers: { "content-security-policy": "default-src 'self'" },
      expect: "skip",
    },
  ],

  "cache-control-missing": [
    {
      description: "no cache-control or pragma on a sensitive path",
      url: "https://example.com/account",
      expect: "fire",
    },
    {
      description:
        "no cache-control or pragma on an ordinary, non-sensitive page — no fire",
      url: "https://example.com/",
      expect: "skip",
    },
    {
      description: "Cache-Control present",
      url: "https://example.com/account",
      headers: { "cache-control": "no-store" },
      expect: "skip",
    },
    {
      // Path-segment matching, not a raw substring match: "/accounting" merely
      // contains "account" as a substring but is not the sensitive path itself.
      description:
        "public blog/CMS route that only contains a sensitive word as a substring — no fire",
      url: "https://example.com/accounting/reports",
      expect: "skip",
    },
  ],

  "cache-control-no-store-missing": [
    {
      description: "sensitive path (/account) without Cache-Control: no-store",
      url: "https://example.com/account",
      expect: "fire",
      evidenceIncludes: "Sensitive page path",
    },
    {
      description: "sensitive path with Cache-Control: no-store present",
      url: "https://example.com/account",
      headers: { "cache-control": "no-store" },
      expect: "skip",
    },
    {
      description:
        "/api/authors — a public content-API path that merely contains '/api/auth' as a substring, not the auth endpoint itself",
      url: "https://example.com/api/authors/42",
      expect: "skip",
    },
    {
      description:
        "/sessions/keynote-address — an events site's public schedule page, not a session/auth endpoint",
      url: "https://example.com/sessions/keynote-address",
      expect: "skip",
    },
    {
      description:
        "/accounting/reports — an unrelated public route, not an account-management endpoint",
      url: "https://example.com/accounting/reports",
      expect: "skip",
    },
  ],

  // ── CORS ────────────────────────────────────────────────────────────

  "cors-wildcard": [
    {
      description: "Access-Control-Allow-Origin: * (bad)",
      url: "https://api.example.com/users",
      headers: { "access-control-allow-origin": "*" },
      expect: "fire",
    },
    {
      description: "explicit origin (good)",
      url: "https://api.example.com/users",
      headers: { "access-control-allow-origin": "https://example.com" },
      expect: "skip",
    },
  ],

  "cors-credentials-wildcard": [
    {
      description: "* with credentials — browser will reject",
      url: "https://api.example.com/",
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-credentials": "true",
      },
      expect: "fire",
    },
    {
      description: "specific origin with credentials",
      url: "https://api.example.com/",
      headers: {
        "access-control-allow-origin": "https://example.com",
        "access-control-allow-credentials": "true",
      },
      expect: "skip",
    },
  ],

  "cors-origin-reflection": [
    {
      description:
        "ACAO reflects http:// origin WITH credentials (browser will send cookies)",
      url: "https://api.example.com/",
      headers: {
        "access-control-allow-origin": "http://attacker.example/",
        "access-control-allow-credentials": "true",
      },
      expect: "fire",
    },
    {
      description:
        "ACAO specific origin without credentials — does not trigger reflection check",
      url: "https://api.example.com/",
      headers: {
        "access-control-allow-origin": "http://attacker.example/",
      },
      expect: "skip",
    },
  ],

  "cors-null-origin-allowed": [
    {
      description: "Access-Control-Allow-Origin: null",
      url: "https://api.example.com/",
      headers: { "access-control-allow-origin": "null" },
      expect: "fire",
    },
  ],

  // ── Server identity ─────────────────────────────────────────────────

  "server-header-disclosure": [
    {
      description: "Server: nginx/1.18.0 disclosed",
      url: "https://example.com/",
      headers: { server: "nginx/1.18.0" },
      expect: "fire",
      evidenceIncludes: "nginx",
    },
    {
      description: "Server: cloudflare (acceptable)",
      url: "https://example.com/",
      headers: { server: "cloudflare" },
      expect: "skip",
    },
  ],

  "x-powered-by-exposed": [
    {
      description: "X-Powered-By: Express",
      url: "https://example.com/",
      headers: { "x-powered-by": "Express" },
      expect: "fire",
      evidenceIncludes: "Express",
    },
    {
      description: "no X-Powered-By",
      url: "https://example.com/",
      expect: "skip",
    },
  ],

  "via-header-exposed": [
    {
      description: "Via: 1.1 varnish",
      url: "https://example.com/",
      headers: { via: "1.1 varnish" },
      expect: "fire",
    },
  ],

  "x-aspnet-version-exposed": [
    {
      description: "X-AspNet-Version: 4.0.30319",
      url: "https://example.com/",
      headers: { "x-aspnet-version": "4.0.30319" },
      expect: "fire",
    },
  ],

  "x-aspnetmvc-version-exposed": [
    {
      description: "X-AspNetMvc-Version: 5.2",
      url: "https://example.com/",
      headers: { "x-aspnetmvc-version": "5.2" },
      expect: "fire",
    },
  ],

  "x-runtime-exposed": [
    {
      description: "X-Runtime: 0.045",
      url: "https://example.com/",
      headers: { "x-runtime": "0.045" },
      expect: "fire",
    },
  ],

  "x-request-id-exposed": [
    {
      description: "X-Request-Id is standard tracing infra, not a finding",
      url: "https://example.com/",
      headers: { "x-request-id": "abc-123" },
      expect: "skip",
    },
  ],

  // ── Cache / ETag / Date ─────────────────────────────────────────────

  "etag-inode": [
    {
      description: "ETag reveals inode (insecure)",
      url: "https://example.com/",
      headers: { etag: '"65d4a-1234-5f0a9bcd"' },
      expect: "fire",
    },
  ],

  "age-header-reveals-cdn": [
    {
      description: "Age header is standard caching behavior, not a finding",
      url: "https://example.com/",
      headers: { age: "300" },
      expect: "skip",
    },
    {
      description: "Age: 0 (just-fetched)",
      url: "https://example.com/",
      headers: { age: "0" },
      expect: "skip",
    },
  ],

  "date-time-skew": [
    {
      description: "Date header significantly skewed",
      url: "https://example.com/",
      headers: { date: "Wed, 01 Jan 2025 00:00:00 GMT" },
      expect: "fire",
    },
  ],

  "expires-past": [
    {
      description: "genuinely stale hardcoded epoch date fires",
      url: "https://example.com/",
      headers: { expires: "Thu, 01 Jan 1970 00:00:00 GMT" },
      expect: "fire",
      evidenceIncludes: "past date",
    },
    {
      description:
        "Expires set to the exact response Date (the common HTTP/1.0 no-cache idiom) does not fire, even though it is technically <= Date.now() by the time this check runs",
      url: "https://example.com/",
      headers: {
        date: new Date().toUTCString(),
        expires: new Date().toUTCString(),
      },
      expect: "skip",
    },
    {
      description:
        "Expires a few seconds behind Date.now() (test/network latency), no Date header to compare against, does not fire",
      url: "https://example.com/",
      headers: { expires: new Date(Date.now() - 2000).toUTCString() },
      expect: "skip",
    },
    {
      description: "Expires meaningfully (>5min) before the Date header fires",
      url: "https://example.com/",
      headers: {
        date: new Date().toUTCString(),
        expires: new Date(Date.now() - 10 * 60 * 1000).toUTCString(),
      },
      expect: "fire",
    },
  ],

  // ── Cookies (live copy: the definition's category is "headers") ──────
  //
  // cookies.ts used to carry a second, dead implementation of this id that
  // flagged every cookie. It was deleted, and these fixtures moved here so the
  // detector that actually runs is the one under test. ref: AUDIT-009#dup-09

  "cookie-security": [
    {
      description: "session cookie missing HttpOnly/Secure/SameSite",
      cookies: ["session=abc"],
      expect: "fire",
      evidenceIncludes: "HttpOnly",
    },
    {
      description: "session cookie with all three attributes",
      cookies: ["session=abc; HttpOnly; Secure; SameSite=Lax"],
      expect: "skip",
    },
    {
      description:
        "third-party analytics cookie missing the attributes is not a session-hijacking risk",
      cookies: ["_ga=GA1.1.1234567890.1700000000; Path=/"],
      expect: "skip",
    },
  ],

  // ── Clear-site-data / Critical ──────────────────────────────────────

  "clear-site-data-missing": [
    {
      description: "logout page body without Clear-Site-Data header",
      url: "https://example.com/logout",
      body: '<html><body><h1>Sign out</h1><p>Click below to logout.</p><form method="POST"><button>Logout</button></form></body></html>',
      expect: "fire",
    },
    {
      description: "logout page WITH Clear-Site-Data header",
      url: "https://example.com/logout",
      body: "<html><body><h1>Logout</h1></body></html>",
      headers: { "clear-site-data": '"cache", "cookies", "storage"' },
      expect: "skip",
    },
    {
      description:
        "URL path variant /sign-out is still recognized as a logout endpoint",
      url: "https://example.com/account/sign-out",
      body: "<html><body><h1>You have been signed out</h1></body></html>",
      expect: "fire",
    },
    {
      description:
        "ordinary dashboard page whose nav merely LINKS to /logout does not fire -- the scanned page itself is not a logout endpoint",
      url: "https://example.com/dashboard",
      body: '<html><body><nav><a href="/logout">Log out</a></nav><h1>Dashboard</h1></body></html>',
      expect: "skip",
    },
  ],

  // ── Frame / window security ─────────────────────────────────────────

  "x-frame-options-allowall": [
    {
      description: "X-Frame-Options: ALLOWALL (bad)",
      url: "https://example.com/",
      headers: { "x-frame-options": "ALLOWALL" },
      expect: "fire",
    },
    {
      description: "X-Frame-Options: DENY (good)",
      url: "https://example.com/",
      headers: { "x-frame-options": "DENY" },
      expect: "skip",
    },
  ],

  "x-frame-options-invalid": [
    {
      description: "garbage X-Frame-Options value",
      url: "https://example.com/",
      headers: { "x-frame-options": "BANANA" },
      expect: "fire",
      evidenceIncludes: "invalid value",
    },
    {
      description: "DENY is valid",
      url: "https://example.com/",
      headers: { "x-frame-options": "DENY" },
      expect: "skip",
    },
    {
      // ALLOWALL has its own dedicated, higher-severity check —
      // don't double-fire the generic check for it too.
      // ref: AUDIT-008#scanner-05
      description:
        "ALLOWALL has its own dedicated check — not double-reported here",
      url: "https://example.com/",
      headers: { "x-frame-options": "ALLOWALL" },
      expect: "skip",
    },
  ],

  // ── Cross-domain / Timing ────────────────────────────────────────────

  "timing-allow-origin-wide": [
    {
      description: "Timing-Allow-Origin: * (permissive)",
      url: "https://example.com/",
      headers: { "timing-allow-origin": "*" },
      expect: "fire",
    },
    {
      description: "specific origin",
      url: "https://example.com/",
      headers: { "timing-allow-origin": "https://example.com" },
      expect: "skip",
    },
  ],

  "server-timing-exposure": [
    {
      description: "generic cache timing is not sensitive",
      url: "https://example.com/",
      headers: { "server-timing": "cache;dur=100" },
      expect: "skip",
    },
    {
      description: "db timing name reveals sensitive backend operation",
      url: "https://example.com/",
      headers: { "server-timing": "db;dur=42" },
      expect: "fire",
      evidenceIncludes: "db",
    },
  ],

  "server-timing-sensitive-key-leak": [
    {
      // Disabled: duplicate of server-timing-exposure, and its keyword list
      // included "cache" — which matched the benign, extremely common
      // cache;dur=NN CDN timing entry. ref: AUDIT-008#scanner-05
      description: "disabled duplicate of server-timing-exposure — never fires",
      url: "https://example.com/",
      headers: { "server-timing": "db;dur=42" },
      expect: "skip",
    },
  ],

  "cf-ray-header": [
    {
      description: "CF-Ray is standard Cloudflare header, not a finding",
      url: "https://example.com/",
      headers: { "cf-ray": "12345abc-SJC" },
      expect: "skip",
    },
  ],

  // ── Deprecated / bad ────────────────────────────────────────────────

  "x-xss-protection-disabled": [
    {
      // X-XSS-Protection: 0 is the OWASP/Mozilla-recommended value (and
      // Helmet.js's default) -- the legacy filter it disables was itself an
      // XSS/info-disclosure risk and no modern browser implements it anymore.
      description:
        "X-XSS-Protection: 0 (current best-practice value) does not fire",
      url: "https://example.com/",
      headers: { "x-xss-protection": "0" },
      expect: "skip",
    },
    {
      description: "X-XSS-Protection: 1; mode=block (older XSS auditor)",
      url: "https://example.com/",
      headers: { "x-xss-protection": "1; mode=block" },
      expect: "skip",
    },
  ],

  // ── CSP substrategies ───────────────────────────────────────────────

  "csp-unsafe-inline-script": [
    {
      description:
        "CSP script-src has unsafe-inline WITHOUT nonce/hash (vulnerable)",
      url: "https://example.com/",
      headers: {
        "content-security-policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline'",
      },
      expect: "fire",
      evidenceIncludes: "unsafe-inline",
    },
    {
      description: "CSP with nonce (unsafe-inline compensated)",
      url: "https://example.com/",
      headers: {
        "content-security-policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'nonce-abc123'",
      },
      expect: "skip",
    },
  ],

  "csp-unsafe-eval-detected": [
    {
      description: "CSP allows 'unsafe-eval'",
      url: "https://example.com/",
      headers: {
        "content-security-policy": "default-src 'self' 'unsafe-eval'",
      },
      expect: "fire",
    },
  ],

  "csp-form-action-missing": [
    {
      description: "CSP without form-action directive",
      url: "https://example.com/",
      headers: { "content-security-policy": "default-src 'self'" },
      expect: "fire",
    },
    {
      description: "form-action set only via meta-tag CSP is not missing",
      url: "https://example.com/",
      body: "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; form-action 'self'\">",
      expect: "skip",
    },
  ],

  "csp-no-default-src": [
    {
      description: "CSP without default-src directive",
      url: "https://example.com/",
      headers: { "content-security-policy": "script-src 'self'" },
      expect: "fire",
    },
    {
      description: "default-src set only via meta-tag CSP is not missing",
      url: "https://example.com/",
      body: '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">',
      expect: "skip",
    },
  ],

  "csp-wildcard-source": [
    {
      description: "CSP default-src *",
      url: "https://example.com/",
      headers: { "content-security-policy": "default-src *" },
      expect: "fire",
    },
    {
      description: "wildcard set via meta-tag CSP (no header CSP at all)",
      url: "https://example.com/",
      body: '<meta http-equiv="Content-Security-Policy" content="default-src *">',
      expect: "fire",
    },
  ],

  "csp-base-uri-missing": [
    {
      description: "CSP without base-uri directive",
      url: "https://example.com/",
      headers: { "content-security-policy": "default-src 'self'" },
      expect: "fire",
    },
    {
      description: "CSP with base-uri 'self'",
      url: "https://example.com/",
      headers: {
        "content-security-policy": "default-src 'self'; base-uri 'self'",
      },
      expect: "skip",
    },
    {
      description:
        "base-uri set only via meta-tag CSP is not reported as missing",
      url: "https://example.com/",
      body: "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; base-uri 'self'\">",
      expect: "skip",
    },
  ],

  "csp-frame-src-missing": [
    {
      description:
        "no CSP anywhere (header or meta) and frame-src absent fires",
      url: "https://example.com/",
      headers: { "content-security-policy": "default-src 'self'" },
      expect: "fire",
      evidenceIncludes: "frame-src",
    },
    {
      description: "header CSP itself declares frame-src",
      url: "https://example.com/",
      headers: {
        "content-security-policy": "default-src 'self'; frame-src 'self'",
      },
      expect: "skip",
    },
    {
      description:
        "HTTP header CSP lacks frame-src, but a <meta http-equiv> CSP in the body sets it -- the browser still enforces it, so this is not missing",
      url: "https://example.com/",
      headers: { "content-security-policy": "default-src 'self'" },
      body: '<meta http-equiv="Content-Security-Policy" content="frame-src https://www.youtube.com https://player.vimeo.com">',
      expect: "skip",
    },
    {
      description:
        "meta CSP value containing single-quoted tokens ('self') is read in full, not truncated at the first quote",
      url: "https://example.com/",
      body: "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; frame-src 'self'\">",
      expect: "skip",
    },
  ],

  "csp-frame-ancestors": [
    {
      // Disabled: every case this fired was a strict subset of
      // clickjack-missing's condition, so it always double-counted the same
      // "no clickjacking protection at all" evidence.
      // ref: AUDIT-008#scanner-05
      description:
        "disabled duplicate of clickjack-missing — never fires even with no CSP frame-ancestors and no X-Frame-Options",
      url: "https://example.com/",
      headers: { "content-security-policy": "default-src 'self'" },
      expect: "skip",
    },
  ],

  "csp-no-upgrade-insecure": [
    {
      description: "CSP without upgrade-insecure-requests",
      url: "https://example.com/",
      headers: { "content-security-policy": "default-src 'self'" },
      expect: "fire",
    },
  ],

  // ── Mixed content / Forms ───────────────────────────────────────────

  "mixed-content": [
    {
      description: "https page with http:// scripts",
      url: "https://example.com/",
      body: '<html><body><script src="http://cdn.example.com/lib.js"></script></body></html>',
      expect: "fire",
    },
    {
      description: "https page with all https://",
      url: "https://example.com/",
      body: '<html><body><script src="https://cdn.example.com/lib.js"></script></body></html>',
      expect: "skip",
    },
  ],

  "form-action-http": [
    {
      description: "form posts to http://",
      url: "https://example.com/",
      body: '<html><body><form action="http://example.com/submit" method="POST"></form></body></html>',
      expect: "fire",
    },
  ],

  // ── Cache-Control: public on sensitive content ──────────────────────

  "cache-control-public-sensitive": [
    {
      description: "Cache-Control: public on a page with a password input",
      url: "https://example.com/account/settings",
      headers: { "cache-control": "public, max-age=3600" },
      body: '<html><body><form method="post"><input type="password" name="pw"></form></body></html>',
      expect: "fire",
      evidenceIncludes: "sensitive forms",
    },
    {
      // The concrete trigger from the bug report: an ordinary marketing
      // homepage's newsletter signup, a completely public POST form with no
      // sensitive fields, served with a standard CDN caching policy.
      description:
        "SaaS marketing homepage with a public newsletter-signup POST form — no fire",
      url: "https://example.com/",
      headers: { "cache-control": "public, max-age=3600" },
      body: '<html><body><form method="post" action="/newsletter-signup"><input name="email"></form></body></html>',
      expect: "skip",
    },
    {
      description:
        "a POST form that collects a card number is still flagged even without a password field",
      url: "https://example.com/checkout",
      headers: { "cache-control": "public, max-age=3600" },
      body: '<html><body><form method="post"><input name="card_number"></form></body></html>',
      expect: "fire",
      evidenceIncludes: "sensitive forms",
    },
    {
      description: "/login page with Cache-Control: public — pre-auth, no fire",
      url: "https://example.com/login",
      headers: { "cache-control": "public, max-age=3600" },
      body: '<html><body><form method="post"><input type="password" name="pw"></form></body></html>',
      expect: "skip",
    },
  ],

  // ── SRI ───────────────────────────────────────────────────────────────

  "sri-missing": [
    {
      description: "external script without integrity attribute fires",
      url: "https://example.com/",
      body: '<html><body><script src="https://cdn.example.com/lib.js"></script></body></html>',
      expect: "fire",
      evidenceIncludes: "external script",
    },
    {
      description: "external script with integrity attribute — no fire",
      url: "https://example.com/",
      body: '<html><body><script src="https://cdn.example.com/lib.js" integrity="sha384-abc"></script></body></html>',
      expect: "skip",
    },
    {
      description:
        "Google Tag Manager script — exempt, GTM is served mutable/unversioned by design",
      url: "https://example.com/",
      body: '<html><body><script async src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXXXXX"></script></body></html>',
      expect: "skip",
    },
    {
      description:
        "Stripe.js — exempt, Stripe's own docs require this exact tag",
      url: "https://example.com/checkout",
      body: '<html><body><script src="https://js.stripe.com/v3/"></script></body></html>',
      expect: "skip",
    },
    {
      // ref: AUDIT-010#scanner-11 — bare googletagmanager.com/google-analytics.com,
      // Google Ads (googlesyndication.com), PayPal SDK, Facebook Pixel, Segment,
      // Hotjar, and LinkedIn Insight all serve mutable, unversioned scripts by
      // design and are documented as SRI-incompatible by their vendors.
      description: "Google Analytics (bare host) — exempt, dynamically served",
      url: "https://example.com/",
      body: '<html><body><script src="https://google-analytics.com/analytics.js"></script></body></html>',
      expect: "skip",
    },
    {
      description: "Google Tag Manager (bare host) — exempt",
      url: "https://example.com/",
      body: '<html><body><script src="https://googletagmanager.com/gtm.js?id=GTM-XXXXXXX"></script></body></html>',
      expect: "skip",
    },
    {
      description: "Google Ads (googlesyndication.com) — exempt",
      url: "https://example.com/",
      body: '<html><body><script src="https://googlesyndication.com/pagead/js/adsbygoogle.js"></script></body></html>',
      expect: "skip",
    },
    {
      description: "PayPal SDK (www.paypalobjects.com) — exempt",
      url: "https://example.com/checkout",
      body: '<html><body><script src="https://www.paypalobjects.com/api/checkout.js"></script></body></html>',
      expect: "skip",
    },
    {
      description: "Facebook Pixel (connect.facebook.net) — exempt",
      url: "https://example.com/",
      body: '<html><body><script src="https://connect.facebook.net/en_US/fbevents.js"></script></body></html>',
      expect: "skip",
    },
    {
      description: "Segment (cdn.segment.com) — exempt",
      url: "https://example.com/",
      body: '<html><body><script src="https://cdn.segment.com/analytics.js/v1/abc/analytics.min.js"></script></body></html>',
      expect: "skip",
    },
    {
      description: "Hotjar (static.hotjar.com) — exempt",
      url: "https://example.com/",
      body: '<html><body><script src="https://static.hotjar.com/c/hotjar-123.js"></script></body></html>',
      expect: "skip",
    },
    {
      description: "LinkedIn Insight Tag (snap.licdn.com) — exempt",
      url: "https://example.com/",
      body: '<html><body><script src="https://snap.licdn.com/li.lms-analytics/insight.min.js"></script></body></html>',
      expect: "skip",
    },
    {
      // A genuine positive stays a positive: an ordinary self-hosted CDN
      // script is not on any exempt list and must still fire.
      description:
        "unrelated third-party CDN script (not on the exempt list) still fires",
      url: "https://example.com/",
      body: '<html><body><script src="https://cdn.some-random-vendor.com/widget.js"></script></body></html>',
      expect: "fire",
      evidenceIncludes: "external script",
    },
  ],

  "sri-stylesheet-missing": [
    {
      description: "external stylesheet without integrity attribute fires",
      url: "https://example.com/",
      body: '<html><head><link rel="stylesheet" href="https://cdn.example.com/style.css"></head></html>',
      expect: "fire",
      evidenceIncludes: "stylesheet",
    },
    {
      description:
        "Google Fonts stylesheet — exempt, served per-User-Agent with no stable hash",
      url: "https://example.com/",
      body: '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto"></head></html>',
      expect: "skip",
    },
    {
      // ref: AUDIT-010#scanner-12 — Typekit/Adobe Fonts is the same
      // UA-negotiated-CSS class of CDN as Google Fonts.
      description:
        "Typekit/Adobe Fonts stylesheet (use.typekit.net) — exempt, same UA-negotiated-CSS problem as Google Fonts",
      url: "https://example.com/",
      body: '<html><head><link rel="stylesheet" href="https://use.typekit.net/abc123.css"></head></html>',
      expect: "skip",
    },
    {
      // A genuine positive stays a positive.
      description:
        "unrelated third-party stylesheet CDN (not exempt) still fires",
      url: "https://example.com/",
      body: '<html><head><link rel="stylesheet" href="https://cdn.some-random-vendor.com/theme.css"></head></html>',
      expect: "fire",
      evidenceIncludes: "stylesheet",
    },
  ],

  // ── DOCTYPE / charset / viewport / canonical / autocomplete ────────

  "doctype-missing": [
    {
      description: "HTML body without <!DOCTYPE>",
      url: "https://example.com/",
      body: "<html><body>Hi</body></html>",
      expect: "fire",
    },
    {
      description: "HTML body with DOCTYPE",
      url: "https://example.com/",
      body: "<!DOCTYPE html><html><body>Hi</body></html>",
      expect: "skip",
    },
  ],

  "charset-meta-missing": [
    {
      description: "HTML without charset (no header, no meta tag)",
      url: "https://example.com/",
      body: "<html><body>Hi</body></html>",
      expect: "fire",
    },
    {
      description: "HTML with charset meta tag",
      url: "https://example.com/",
      body: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>Hi</body></html>',
      expect: "skip",
    },
    {
      // Express's res.send/res.type and common Nginx configs set charset via
      // the Content-Type header by default -- equally authoritative for the
      // HTML5 encoding-sniffing algorithm, no inline <meta charset> required.
      description:
        "charset declared via Content-Type header, no inline <meta charset> — no fire",
      url: "https://example.com/",
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<html><body>Hi</body></html>",
      expect: "skip",
    },
  ],

  "autocomplete-username": [
    {
      description: "login form: username input without autocomplete",
      url: "https://example.com/login",
      body: '<html><body><form><input name="user"><input type="password" name="pass"></form></body></html>',
      expect: "fire",
    },
    {
      description: "login form: username with autocomplete=username",
      url: "https://example.com/login",
      body: '<html><body><form><input name="user" autocomplete="username"><input type="password" name="pass"></form></body></html>',
      expect: "skip",
    },
    {
      description:
        "newsletter signup: email input with no password field in the form — not a login form",
      url: "https://example.com/",
      body: '<html><body><form><input type="email" name="email" autocomplete="email"></form></body></html>',
      expect: "skip",
    },
  ],

  // ── img / iframe / link ─────────────────────────────────────────────

  "iframe-third-party-without-sandbox": [
    {
      description: "third-party iframe without sandbox (non-exempt host)",
      url: "https://example.com/",
      body: '<html><body><iframe src="https://widget.chat-example.com/embed"></iframe></body></html>',
      expect: "fire",
    },
    {
      description: "third-party iframe WITH sandbox attribute",
      url: "https://example.com/",
      body: '<html><body><iframe src="https://widget.chat-example.com/embed" sandbox=""></iframe></body></html>',
      expect: "skip",
    },
    {
      // YouTube/Maps/Stripe/reCAPTCHA embeds are widely deployed and
      // documented to break under sandbox (postMessage, popups, same-origin
      // storage) -- developers omit sandbox on these by design, not by
      // oversight, so they must not be treated as a missing-sandbox finding.
      description:
        "YouTube embed without sandbox — exempt, YouTube requires unsandboxed operation",
      url: "https://example.com/",
      body: '<html><body><iframe src="https://www.youtube.com/embed/VIDEO_ID"></iframe></body></html>',
      expect: "skip",
    },
    {
      description:
        "Google Maps embed without sandbox — exempt, Maps requires unsandboxed operation",
      url: "https://example.com/",
      body: '<html><body><iframe src="https://www.google.com/maps/embed?pb=abc"></iframe></body></html>',
      expect: "skip",
    },
    {
      description:
        "unrelated google.com content (not maps/recaptcha) is NOT exempted just for being on google.com",
      url: "https://example.com/",
      body: '<html><body><iframe src="https://www.google.com/some/other/embed"></iframe></body></html>',
      expect: "fire",
    },
    {
      // ref: AUDIT-012#inj-05. An IPv6 target's host is the literal
      // "[::1]:8080"; interpolated into a regex that became a character
      // class, so the site's own same-origin frames were classified as
      // third-party embeds on every self-hosted IPv6 target.
      description:
        "IPv6 target framing its own same-origin page is not third-party",
      url: "http://[::1]:8080/dashboard",
      body: '<html><body><iframe src="http://[::1]:8080/panel"></iframe></body></html>',
      expect: "skip",
    },
    {
      description:
        "IPv6 target framing a genuine cross-origin embed still fires",
      url: "http://[::1]:8080/dashboard",
      body: '<html><body><iframe src="https://widget.chat-example.com/embed"></iframe></body></html>',
      expect: "fire",
    },
    {
      // The src the browser loads is same-origin; only the lazy-load
      // data-src attribute points elsewhere, and it is never rendered.
      description:
        "same-origin iframe whose data-src points at a third party is not flagged",
      url: "https://example.com/",
      body: '<html><body><iframe data-src="https://widget.chat-example.com/embed" src="https://example.com/frame"></iframe></body></html>',
      expect: "skip",
    },
  ],

  "image-protocol-relative": [
    {
      description: "img src is a plain protocol-relative URL",
      url: "https://example.com/",
      body: '<html><body><img src="//cdn.example.com/logo.png" alt="Logo"></body></html>',
      expect: "fire",
      evidenceIncludes: "//cdn.example.com/logo.png",
    },
    {
      description:
        "lazy-loaded img whose real src is a base64 placeholder and whose data-src (never rendered as src) happens to be protocol-relative does not fire",
      url: "https://example.com/",
      body: '<html><body><img class="lazy" data-src="//cdn.example.com/lazy.jpg" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7"></body></html>',
      expect: "skip",
    },
    {
      description: "img src uses https:// explicitly",
      url: "https://example.com/",
      body: '<html><body><img src="https://cdn.example.com/logo.png"></body></html>',
      expect: "skip",
    },
  ],

  "meta-redirect-no-url": [
    {
      description: "meta refresh with empty content (broken redirect)",
      url: "https://example.com/",
      body: '<html><head><meta http-equiv="refresh" content=""></head></html>',
      expect: "fire",
    },
    {
      description:
        "meta refresh with url= present but empty target (broken redirect)",
      url: "https://example.com/",
      body: '<html><head><meta http-equiv="refresh" content="0;url="></head></html>',
      expect: "fire",
    },
    {
      description: "meta refresh WITH url (proper redirect)",
      url: "https://example.com/",
      body: '<html><head><meta http-equiv="refresh" content="0;url=https://example.com/new"></head></html>',
      expect: "skip",
    },
    {
      description:
        "plain self-refresh idiom with no url segment (dashboards, queue pages) — not broken",
      url: "https://example.com/",
      body: '<html><head><meta http-equiv="refresh" content="5"></head></html>',
      expect: "skip",
    },
    {
      // Reading only the first refresh tag let a benign self-reload at the
      // top of the document hide a broken redirect further down.
      description:
        "benign self-refresh first, broken empty-url refresh second - still fires",
      url: "https://example.com/",
      body: '<html><head><meta http-equiv="refresh" content="30"><meta http-equiv="refresh" content="0;url="></head></html>',
      expect: "fire",
      evidenceIncludes: "empty URL target",
    },
  ],

  "target-blank-no-noopener": [
    {
      description: "target=_blank without rel=noopener",
      url: "https://example.com/",
      body: '<html><body><a href="https://example.com/" target="_blank">x</a></body></html>',
      expect: "fire",
    },
    {
      description: "target=_blank with rel=noopener",
      url: "https://example.com/",
      body: '<html><body><a href="https://example.com/" target="_blank" rel="noopener">x</a></body></html>',
      expect: "skip",
    },
    {
      description: "target=_blank with rel=noreferrer (implies noopener)",
      url: "https://example.com/",
      body: '<html><body><a href="https://example.com/" target="_blank" rel="noreferrer">x</a></body></html>',
      expect: "skip",
    },
  ],

  // ── Origin-Agent-Cluster value validation ───────────────────────────

  "origin-agent-cluster-invalid-value": [
    {
      description: "invalid value 'true' instead of a structured boolean",
      url: "https://example.com/",
      headers: { "origin-agent-cluster": "true" },
      expect: "fire",
      evidenceIncludes: "invalid value",
    },
    {
      description: "valid ?1",
      url: "https://example.com/",
      headers: { "origin-agent-cluster": "?1" },
      expect: "skip",
    },
    {
      description: "valid ?0",
      url: "https://example.com/",
      headers: { "origin-agent-cluster": "?0" },
      expect: "skip",
    },
    {
      description:
        "header absent entirely is covered by origin-agent-cluster-missing, not this check",
      url: "https://example.com/",
      expect: "skip",
    },
  ],

  // ── Cross-origin isolation (SharedArrayBuffer) ──────────────────────

  "shared-array-buffer-not-isolated": [
    {
      description:
        "inline script constructs a SharedArrayBuffer with no COOP/COEP",
      url: "https://example.com/",
      body: "<html><body><script>const buf = new SharedArrayBuffer(1024);</script></body></html>",
      expect: "fire",
      evidenceIncludes: "SharedArrayBuffer",
    },
    {
      description: "SharedArrayBuffer with correct COOP + COEP require-corp",
      url: "https://example.com/",
      headers: {
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-embedder-policy": "require-corp",
      },
      body: "<html><body><script>const buf = new SharedArrayBuffer(1024);</script></body></html>",
      expect: "skip",
    },
    {
      description:
        "typeof feature-detection only, no actual construction — not flagged",
      url: "https://example.com/",
      body: "<html><body><script>if (typeof SharedArrayBuffer !== 'undefined') {}</script></body></html>",
      expect: "skip",
    },
    {
      description:
        "SharedArrayBuffer shown as example text inside a <pre><code> docs block, not a live script",
      url: "https://example.com/",
      body: "<html><body><pre><code>const buf = new SharedArrayBuffer(1024);</code></pre></body></html>",
      expect: "skip",
    },
  ],

  // ── Reporting API endpoint transport ─────────────────────────────────

  "reporting-endpoints-insecure-url": [
    {
      description: "Reporting-Endpoints defines an http:// collector",
      url: "https://example.com/",
      headers: {
        "reporting-endpoints": 'default="http://reports.example.com/collect"',
      },
      expect: "fire",
      evidenceIncludes: "http://",
    },
    {
      description: "Reporting-Endpoints defines an https:// collector",
      url: "https://example.com/",
      headers: {
        "reporting-endpoints": 'default="https://reports.example.com/collect"',
      },
      expect: "skip",
    },
  ],

  // ── CORS cache-key correctness ───────────────────────────────────────

  "cors-reflected-origin-no-vary": [
    {
      description: "ACAO reflects a specific origin with no Vary: Origin",
      url: "https://api.example.com/",
      headers: { "access-control-allow-origin": "https://app.example.com" },
      expect: "fire",
      evidenceIncludes: "Vary",
    },
    {
      description: "ACAO reflects origin AND Vary: Origin is set correctly",
      url: "https://api.example.com/",
      headers: {
        "access-control-allow-origin": "https://app.example.com",
        vary: "Origin",
      },
      expect: "skip",
    },
    {
      description: "ACAO reflects origin but Cache-Control: no-store applies",
      url: "https://api.example.com/",
      headers: {
        "access-control-allow-origin": "https://app.example.com",
        "cache-control": "no-store",
      },
      expect: "skip",
    },
    {
      description: "wildcard ACAO is not a reflection",
      url: "https://api.example.com/",
      headers: { "access-control-allow-origin": "*" },
      expect: "skip",
    },
  ],

  // ── Cache-Control on credential-bearing JSON bodies ──────────────────

  "cache-control-no-store-missing-tokens": [
    {
      description: "JSON token endpoint response without no-store",
      url: "https://api.example.com/oauth/token",
      headers: { "content-type": "application/json" },
      body: '{"access_token":"sk_live_abc123def456ghi789","token_type":"bearer"}',
      expect: "fire",
      evidenceIncludes: "access_token",
    },
    {
      description:
        "JSON token endpoint response WITH Cache-Control: no-store (RFC 6749 compliant)",
      url: "https://api.example.com/oauth/token",
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: '{"access_token":"sk_live_abc123def456ghi789","token_type":"bearer"}',
      expect: "skip",
    },
    {
      description: "placeholder token value in documentation JSON is ignored",
      url: "https://api.example.com/docs/example",
      headers: { "content-type": "application/json" },
      body: '{"access_token":"your_access_token_here"}',
      expect: "skip",
    },
    {
      description: "ordinary JSON response with no token-shaped keys",
      url: "https://api.example.com/users/1",
      headers: { "content-type": "application/json" },
      body: '{"id":1,"name":"Ada Lovelace"}',
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);
