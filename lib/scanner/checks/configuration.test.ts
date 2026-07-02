/**
 * Per-detector tests for the configuration category.
 *
 * Covers 49 detectors in lib/scanner/checks/configuration.ts. Every
 * detector is exercised by the smoke harness (callable, no-throw,
 * deterministic); the curated fixtures below cover the high-signal
 * server-identity and debug-header checks.
 */

import { detectors } from "./configuration";
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
      description: "X-Request-Id header exposed",
      headers: { "x-request-id": "abc-123" },
      expect: "fire",
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
      description: "Age: 300",
      headers: { age: "300" },
      expect: "fire",
    },
    {
      description: "Age: 0 (just fetched)",
      headers: { age: "0" },
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
  ],

  "etag-inode": [
    {
      description: "ETag reveals inode",
      headers: { etag: '"65d4a-1234-5f0a9bcd"' },
      expect: "fire",
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
      description: "CF-Ray header exposed",
      headers: { "cf-ray": "12345abc-SJC" },
      expect: "fire",
    },
  ],

  "x-vercel-id": [
    {
      description: "X-Vercel-Id header",
      headers: { "x-vercel-id": "iad1::abc123" },
      expect: "fire",
    },
  ],

  "x-cache-header": [
    {
      description: "X-Cache: HIT",
      headers: { "x-cache": "HIT from cache.example.com" },
      expect: "fire",
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
      description: "HTML response with no Vary header",
      headers: { "content-type": "text/html; charset=utf-8" },
      expect: "fire",
    },
    {
      description: "Vary: Accept-Encoding present",
      headers: {
        "content-type": "text/html; charset=utf-8",
        vary: "Accept-Encoding",
      },
      expect: "skip",
    },
  ],

  "vary-header-missing-user-agent": [
    {
      description: "HTML response with no Vary header",
      url: "https://example.com/mobile",
      headers: { "content-type": "text/html; charset=utf-8" },
      expect: "fire",
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
      description: "no Origin-Agent-Cluster",
      expect: "fire",
    },
    {
      description: "Origin-Agent-Cluster: ?1",
      headers: { "origin-agent-cluster": "?1" },
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
      description: "no NEL header",
      expect: "fire",
    },
  ],

  "report-to-header-missing": [
    {
      description: "no Report-To header",
      expect: "fire",
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
      description: "Transfer-Encoding: chunked",
      headers: { "transfer-encoding": "chunked" },
      expect: "fire",
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
      description: "Server: nginx/1.18.0 (detailed version)",
      headers: { server: "nginx/1.18.0" },
      expect: "fire",
    },
    {
      description: "Server: nginx (no version)",
      headers: { server: "nginx" },
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
  ],

  "document-policy-missing": [
    {
      description: "no Document-Policy header",
      expect: "fire",
    },
    {
      description: "Document-Policy present",
      headers: { "document-policy": "force-load-at-top" },
      expect: "skip",
    },
  ],

  "ratelimit-policy-missing": [
    {
      description: "no RateLimit-Policy header on API",
      url: "https://api.example.com/v1/users",
      expect: "fire",
    },
  ],
};

runDetectorTests(detectors, fixtures);
