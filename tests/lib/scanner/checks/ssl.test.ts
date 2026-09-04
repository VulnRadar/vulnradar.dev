/**
 * Per-detector tests for the SSL/TLS-at-the-edge category.
 *
 * Covers 7 detectors in lib/scanner/checks/ssl.ts. Every detector
 * is exercised by the smoke harness; the positive/negative fixtures
 * below cover the high-signal checks: HSTS, mixed content, deprecated
 * HTTP, ssl-strip, expect-ct, ocsp-stapling, etc.
 */

import { detectors } from "@/lib/scanner/checks/ssl";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  // ── URL-level ──────────────────────────────────────────────────────
  "unencrypted-connection": [
    {
      description: "plain HTTP page",
      url: "http://example.com/",
      expect: "fire",
      evidenceIncludes: "HTTP",
    },
    {
      description: "TLS page",
      url: "https://example.com/",
      expect: "skip",
    },
  ],

  "ssl-strip-detected": [
    {
      description: "http:// page with HSTS header (strip indicator)",
      url: "http://example.com/",
      headers: { "strict-transport-security": "max-age=31536000" },
      expect: "fire",
      evidenceIncludes: "ssl-strip",
    },
    {
      description: "http:// page WITHOUT HSTS (can't be sure)",
      url: "http://example.com/",
      headers: {},
      expect: "skip",
    },
    {
      description: "https:// page (no strip possible)",
      url: "https://example.com/",
      headers: { "strict-transport-security": "max-age=31536000" },
      expect: "skip",
    },
  ],

  // ── Mixed content ──────────────────────────────────────────────────
  "mixed-protocol-content": [
    {
      description: "https page with http:// scripts",
      url: "https://example.com/",
      body: '<html><body><script src="http://cdn.example.com/lib.js"></script></body></html>',
      expect: "fire",
      evidenceIncludes: "mixed-content",
    },
    {
      description: "https page with all https://",
      url: "https://example.com/",
      body: '<html><body><script src="https://cdn.example.com/lib.js"></script></body></html>',
      expect: "skip",
    },
    {
      description: "https page with no subresources",
      url: "https://example.com/",
      body: "<html><body><p>Hello</p></body></html>",
      expect: "skip",
    },
    {
      description:
        "https page with a plain <a href> citation link to an http:// page is regular navigation, not mixed content",
      url: "https://example.com/",
      body: '<html><body><p>Read the older report at <a href="http://legacy.example-vendor.io/report.pdf">this link</a> for background.</p></body></html>',
      expect: "skip",
    },
    {
      description:
        "https page with a plain <form action> to http:// is covered separately by form-action-http, not here",
      url: "https://example.com/",
      body: '<html><body><form action="http://example.com/submit" method="post"></form></body></html>',
      expect: "skip",
    },
    {
      description:
        "http:// stylesheet <link rel=stylesheet> is a real subresource load and counts",
      url: "https://example.com/",
      body: '<html><head><link rel="stylesheet" href="http://cdn.example.com/site.css"></head></html>',
      expect: "fire",
      evidenceIncludes: "mixed-content",
    },
    {
      description:
        "the identical tag shown first inside <pre><code> and then loaded for real further down the page must still fire: judging every copy at the first occurrence's offset silently cleared the page",
      url: "https://example.com/",
      body:
        '<html><body><pre><code><script src="http://cdn.example.com/lib.js"></script></code></pre>' +
        "<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>" +
        '<script src="http://cdn.example.com/lib.js"></script></body></html>',
      expect: "fire",
      evidenceIncludes: "mixed-content",
    },
    {
      description:
        "a tag that only appears inside a <pre><code> documentation block is still not counted",
      url: "https://example.com/",
      body: '<html><body><pre><code><script src="http://cdn.example.com/lib.js"></script></code></pre></body></html>',
      expect: "skip",
    },
    {
      description:
        "plain http:// page referencing other http:// subresources is not mixed content at all",
      url: "http://example.com/",
      body: '<html><body><script src="http://cdn.example.com/lib.js"></script></body></html>',
      expect: "skip",
    },
  ],

  // ── HSTS / Expect-CT ──────────────────────────────────────────────
  "expect-ct-missing": [
    {
      description:
        "deprecated header, no longer honored by any browser -- never fires, even on a plain https site with no header at all",
      url: "https://example.com/",
      expect: "skip",
    },
    {
      description: "https site WITH Expect-CT still does not fire",
      url: "https://example.com/",
      headers: { "expect-ct": "max-age=86400, enforce" },
      expect: "skip",
    },
    {
      description: "http site (Expect-CT doesn't apply)",
      url: "http://example.com/",
      expect: "skip",
    },
  ],

  // ── HTTP method override ──────────────────────────────────────────
  "x-forwarded-method-override": [
    {
      description: "X-HTTP-Method-Override present",
      url: "https://example.com/",
      headers: { "x-http-method-override": "DELETE" },
      expect: "fire",
      evidenceIncludes: "X-HTTP-Method-Override",
    },
    {
      description: "X-Forwarded-Method present",
      url: "https://example.com/",
      headers: { "x-forwarded-method": "PATCH" },
      expect: "fire",
      evidenceIncludes: "X-Forwarded-Method",
    },
    {
      description: "neither present",
      url: "https://example.com/",
      headers: {},
      expect: "skip",
    },
  ],

  // ── HTTPS on unusual port ─────────────────────────────────────────
  "https-unusual-port": [
    {
      description: "https on 8443",
      url: "https://example.com:8443/",
      expect: "fire",
      evidenceIncludes: "8443",
    },
    {
      description: "https on 443 (default)",
      url: "https://example.com/",
      expect: "skip",
    },
    {
      description: "http on 8080 (not https, not flagged here)",
      url: "http://example.com:8080/",
      expect: "skip",
    },
    {
      description: "unparseable URL: skipped rather than crashing the scan",
      url: "not-a-valid-url",
      expect: "skip",
    },
  ],

  // ── Secure cookie on HTTP endpoint ────────────────────────────────
  "ssl-https-only-cookie-on-http": [
    {
      description: "http endpoint with Secure cookie",
      url: "http://example.com/",
      headers: { "set-cookie": "session=abc; Secure; HttpOnly" },
      expect: "fire",
      evidenceIncludes: "Secure",
    },
    {
      description: "http endpoint with non-secure cookie",
      url: "http://example.com/",
      headers: { "set-cookie": "session=abc; HttpOnly" },
      expect: "skip",
    },
    {
      description: "https endpoint (Secure cookie is correct)",
      url: "https://example.com/",
      headers: { "set-cookie": "session=abc; Secure; HttpOnly" },
      expect: "skip",
    },
  ],

  // ── HSTS delivered where browsers ignore it ───────────────────────
  "ssl-hsts-meta-tag-ineffective": [
    {
      description: "HSTS declared in a meta http-equiv tag",
      url: "https://example.com/",
      body: '<html><head><meta http-equiv="Strict-Transport-Security" content="max-age=31536000; includeSubDomains"></head><body></body></html>',
      expect: "fire",
      evidenceIncludes: "meta",
    },
    {
      description: "HSTS delivered correctly as a response header",
      url: "https://example.com/",
      headers: {
        "strict-transport-security": "max-age=31536000; includeSubDomains",
      },
      body: "<html><head><title>Home</title></head><body></body></html>",
      expect: "skip",
    },
  ],

  // ── Cleartext protocol advertised alongside the TLS one ───────────
  "ssl-alt-svc-cleartext-h2c": [
    {
      description: "Alt-Svc advertising h2c on an HTTPS response",
      url: "https://example.com/",
      headers: { "alt-svc": 'h2c=":8080"; ma=86400' },
      expect: "fire",
      evidenceIncludes: "h2c",
    },
    {
      description: "Alt-Svc advertising HTTP/3 only",
      url: "https://example.com/",
      headers: { "alt-svc": 'h3=":443"; ma=86400' },
      expect: "skip",
    },
  ],

  // ── Cleartext subresources the tag-based checks miss ──────────────
  "ssl-link-header-http-subresource": [
    {
      description: "Link header preloading a script over http",
      url: "https://example.com/",
      headers: {
        link: "<http://cdn.example.net/app.js>; rel=preload; as=script",
      },
      expect: "fire",
      evidenceIncludes: "cleartext",
    },
    {
      description: "Link header preloading over https",
      url: "https://example.com/",
      headers: {
        link: "<https://cdn.example.net/app.js>; rel=preload; as=script",
      },
      expect: "skip",
    },
    {
      description: "Link header with a non-subresource relation (canonical)",
      url: "https://example.com/",
      headers: { link: '<http://example.com/page>; rel="canonical"' },
      expect: "skip",
    },
  ],

  "ssl-http-resource-hint-tag": [
    {
      description: "preconnect to a cleartext origin on an HTTPS page",
      url: "https://example.com/",
      body: '<html><head><link rel="preconnect" href="http://cdn.example.net"></head><body></body></html>',
      expect: "fire",
      evidenceIncludes: "cleartext",
    },
    {
      description: "all hints over https",
      url: "https://example.com/",
      body: '<html><head><link rel="preconnect" href="https://cdn.example.net"><link rel="manifest" href="/site.webmanifest"></head><body></body></html>',
      expect: "skip",
    },
    {
      description: "the same cleartext hint on a plain HTTP page",
      url: "http://example.com/",
      body: '<html><head><link rel="preconnect" href="http://cdn.example.net"></head><body></body></html>',
      expect: "skip",
    },
  ],

  "ssl-mixed-content-non-src-attribute": [
    {
      description: "one cleartext candidate hidden in an https srcset",
      url: "https://example.com/",
      body: '<html><body><img src="https://cdn.example.net/h-800.jpg" srcset="https://cdn.example.net/h-400.jpg 400w, http://cdn.example.net/h-800.jpg 800w" alt=""></body></html>',
      expect: "fire",
      evidenceIncludes: "srcset",
    },
    {
      description: "video poster over http",
      url: "https://example.com/",
      body: '<html><body><video poster="http://cdn.example.net/poster.jpg" controls></video></body></html>',
      expect: "fire",
      evidenceIncludes: "poster",
    },
    {
      description: "every srcset candidate and the poster over https",
      url: "https://example.com/",
      body: '<html><body><img srcset="https://cdn.example.net/h-400.jpg 400w, https://cdn.example.net/h-800.jpg 800w" alt=""><video poster="https://cdn.example.net/poster.jpg"></video></body></html>',
      expect: "skip",
    },
  ],

  "ssl-canonical-link-http": [
    {
      description: "canonical URL left on http after an HTTPS migration",
      url: "https://example.com/articles/tls",
      body: '<html><head><link rel="canonical" href="http://example.com/articles/tls"></head><body></body></html>',
      expect: "fire",
      evidenceIncludes: "canonical",
    },
    {
      description: "canonical URL over https",
      url: "https://example.com/articles/tls",
      body: '<html><head><link rel="canonical" href="https://example.com/articles/tls"></head><body></body></html>',
      expect: "skip",
    },
  ],

  "ssl-meta-refresh-http-target": [
    {
      description: "meta refresh from an HTTPS page to a cleartext URL",
      url: "https://example.com/logout",
      body: '<html><head><meta http-equiv="refresh" content="0; url=http://example.com/goodbye"></head><body></body></html>',
      expect: "fire",
      evidenceIncludes: "cleartext",
    },
    {
      description: "meta refresh to an https URL",
      url: "https://example.com/logout",
      body: '<html><head><meta http-equiv="refresh" content="0; url=https://example.com/goodbye"></head><body></body></html>',
      expect: "skip",
    },
    {
      description: "meta refresh to a relative path",
      url: "https://example.com/logout",
      body: '<html><head><meta http-equiv="refresh" content="3; url=/goodbye"></head><body></body></html>',
      expect: "skip",
    },
  ],

  "ssl-http-fetch-endpoint-in-script": [
    {
      description: "inline fetch() to a cleartext API on an HTTPS page",
      url: "https://example.com/app",
      body: '<html><body><script>fetch("http://api.example.net/v1/items").then(r => r.json());</script></body></html>',
      expect: "fire",
      evidenceIncludes: "cleartext",
    },
    {
      description: "inline fetch() to an https API",
      url: "https://example.com/app",
      body: '<html><body><script>fetch("https://api.example.net/v1/items").then(r => r.json());</script></body></html>',
      expect: "skip",
    },
    {
      description:
        "inline SVG namespace URLs, which are http:// but are never fetched",
      url: "https://example.com/app",
      body: '<html><body><svg xmlns="http://www.w3.org/2000/svg"></svg><script>const NS = "http://www.w3.org/2000/svg";</script></body></html>',
      expect: "skip",
    },
    {
      description: "loopback endpoint in a development build",
      url: "https://example.com/app",
      body: '<html><body><script>fetch("http://localhost:3000/api/dev");</script></body></html>',
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);
