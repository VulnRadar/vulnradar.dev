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
};

runDetectorTests(detectors, fixtures);
