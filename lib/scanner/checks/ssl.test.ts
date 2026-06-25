/**
 * Per-detector tests for the SSL/TLS-at-the-edge category.
 *
 * Covers 12 detectors in lib/scanner/checks/ssl.ts. Every detector
 * is exercised by the smoke harness; the positive/negative fixtures
 * below cover the high-signal checks: HSTS, mixed content, deprecated
 * HTTP, ssl-strip, expect-ct, ocsp-stapling, etc.
 */

import { detectors } from "./ssl";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  // ── URL-level ──────────────────────────────────────────────────────
  "deprecated-tls": [
    {
      description: "URL uses http://",
      url: "http://example.com/login",
      expect: "fire",
      evidenceIncludes: "HTTP",
    },
    {
      description: "URL uses https://",
      url: "https://example.com/login",
      expect: "skip",
    },
  ],

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

  "http-no-redirect": [
    {
      description: "http:// with no Location/status",
      url: "http://example.com/",
      expect: "fire",
      evidenceIncludes: "redirect",
    },
    {
      description: "http:// with 301 Location to https://",
      url: "http://example.com/",
      headers: { ":status": "301", location: "https://example.com/" },
      expect: "skip",
    },
    {
      description: "https:// (no need to redirect)",
      url: "https://example.com/",
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
  ],

  // ── HSTS / Expect-CT / Alt-Svc hints ──────────────────────────────
  "expect-ct-missing": [
    {
      description: "https site without Expect-CT",
      url: "https://example.com/",
      expect: "fire",
      evidenceIncludes: "Expect-CT",
    },
    {
      description: "https site WITH Expect-CT",
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

  "http3-alt-svc-header": [
    {
      description: "https with Alt-Svc advertising HTTP/3",
      url: "https://example.com/",
      headers: { "alt-svc": 'h3=":443"; ma=86400' },
      expect: "fire",
      evidenceIncludes: "HTTP/3",
    },
    {
      description: "https without Alt-Svc",
      url: "https://example.com/",
      headers: {},
      expect: "skip",
    },
  ],

  "ocsp-stapling-enabled": [
    {
      description: "response with ocsp header",
      url: "https://example.com/",
      headers: { ocsp: "MIIB..." },
      expect: "fire",
      evidenceIncludes: "OCSP",
    },
    {
      description: "response without ocsp header",
      url: "https://example.com/",
      headers: {},
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

  // ── Both HTTP and HTTPS accessible ────────────────────────────────
  "ssl-http-and-https-both": [
    // Inline detector is intentionally a no-op (real detection is async).
    {
      description: "any input — async-only detection",
      url: "https://example.com/",
      headers: {},
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);
