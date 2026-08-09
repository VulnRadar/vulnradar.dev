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
      description: "no cache-control or pragma",
      url: "https://example.com/",
      expect: "fire",
    },
    {
      description: "Cache-Control present",
      url: "https://example.com/",
      headers: { "cache-control": "no-store" },
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
      description: "X-XSS-Protection: 0 (explicitly off in older browsers)",
      url: "https://example.com/",
      headers: { "x-xss-protection": "0" },
      expect: "fire",
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

  "csp-wildcard-source": [
    {
      description: "CSP default-src *",
      url: "https://example.com/",
      headers: { "content-security-policy": "default-src *" },
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
      description: "HTML without charset",
      url: "https://example.com/",
      body: "<html><body>Hi</body></html>",
      expect: "fire",
    },
    {
      description: "HTML with charset",
      url: "https://example.com/",
      body: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>Hi</body></html>',
      expect: "skip",
    },
  ],

  "autocomplete-username": [
    {
      description: "username input without autocomplete",
      url: "https://example.com/login",
      body: '<html><body><form><input name="user"></form></body></html>',
      expect: "fire",
    },
    {
      description: "username with autocomplete=username",
      url: "https://example.com/login",
      body: '<html><body><form><input name="user" autocomplete="username"></form></body></html>',
      expect: "skip",
    },
  ],

  // ── img / iframe / link ─────────────────────────────────────────────

  "iframe-third-party-without-sandbox": [
    {
      description: "third-party iframe without sandbox",
      url: "https://example.com/",
      body: '<html><body><iframe src="https://youtube.com/embed/123"></iframe></body></html>',
      expect: "fire",
    },
    {
      description: "third-party iframe WITH sandbox attribute",
      url: "https://example.com/",
      body: '<html><body><iframe src="https://youtube.com/embed/123" sandbox=""></iframe></body></html>',
      expect: "skip",
    },
  ],

  "meta-redirect-no-url": [
    {
      description: "meta refresh without url (broken redirect)",
      url: "https://example.com/",
      body: '<html><head><meta http-equiv="refresh" content="5"></head></html>',
      expect: "fire",
    },
    {
      description: "meta refresh WITH url (proper redirect)",
      url: "https://example.com/",
      body: '<html><head><meta http-equiv="refresh" content="0;url=https://example.com/new"></head></html>',
      expect: "skip",
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
};

runDetectorTests(detectors, fixtures);
