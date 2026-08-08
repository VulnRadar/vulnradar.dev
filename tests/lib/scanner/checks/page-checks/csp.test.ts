import { describe } from "vitest";
import { cspChecks } from "@/lib/scanner/checks/page-checks/csp";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";

const fixtures: PageCheckFixtures = {
  "page-csp-unsafe-inline-effective": [
    {
      description: "unsafe-inline with no nonce or hash",
      headers: {
        "content-security-policy": "script-src 'self' 'unsafe-inline'",
      },
      expect: "fire",
      evidenceIncludes: "unsafe-inline",
    },
    {
      description: "unsafe-inline alongside a nonce",
      headers: {
        "content-security-policy":
          "script-src 'self' 'unsafe-inline' 'nonce-abc123'",
      },
      expect: "skip",
    },
    {
      description: "no unsafe-inline at all",
      headers: { "content-security-policy": "script-src 'self'" },
      expect: "skip",
    },
    {
      description: "report-only policy is not enforced",
      headers: {
        "content-security-policy-report-only": "script-src 'unsafe-inline'",
      },
      expect: "skip",
    },
  ],
  "page-csp-unsafe-eval-effective": [
    {
      description: "unsafe-eval present",
      headers: {
        "content-security-policy": "script-src 'self' 'unsafe-eval'",
      },
      expect: "fire",
      evidenceIncludes: "unsafe-eval",
    },
    {
      description: "no unsafe-eval",
      headers: { "content-security-policy": "script-src 'self'" },
      expect: "skip",
    },
  ],
  "page-csp-wildcard-host-source": [
    {
      description: "wildcard script-src",
      headers: { "content-security-policy": "script-src *" },
      expect: "fire",
      evidenceIncludes: "script-src",
    },
    {
      description: "wildcard subdomain source",
      headers: { "content-security-policy": "script-src *.example.com" },
      expect: "fire",
    },
    {
      description: "specific host, no wildcard",
      headers: {
        "content-security-policy": "script-src 'self' https://cdn.example.com",
      },
      expect: "skip",
    },
  ],
  "page-csp-object-src-unrestricted": [
    {
      description: "object-src not set and no default-src fallback",
      headers: { "content-security-policy": "script-src 'self'" },
      expect: "fire",
    },
    {
      description: "default-src 'none' covers object-src",
      headers: { "content-security-policy": "default-src 'none'" },
      expect: "skip",
    },
    {
      description: "object-src explicitly 'none'",
      headers: {
        "content-security-policy": "script-src 'self'; object-src 'none'",
      },
      expect: "skip",
    },
  ],
  "page-csp-http-source-on-https-page": [
    {
      description: "script-src allows an http:// origin on an https page",
      url: "https://example.com/",
      headers: {
        "content-security-policy": "script-src 'self' http://insecure.example",
      },
      expect: "fire",
      evidenceIncludes: "http",
    },
    {
      description: "all sources are https",
      url: "https://example.com/",
      headers: {
        "content-security-policy": "script-src 'self' https://cdn.example.com",
      },
      expect: "skip",
    },
  ],
  "page-clickjacking-xfo-csp-contradiction": [
    {
      description:
        "X-Frame-Options: DENY contradicted by a permissive frame-ancestors",
      headers: {
        "x-frame-options": "DENY",
        "content-security-policy": "frame-ancestors https://embed.example.net",
      },
      expect: "fire",
      evidenceIncludes: "deny",
    },
    {
      description:
        "X-Frame-Options: SAMEORIGIN with a wildcard frame-ancestors",
      headers: {
        "x-frame-options": "SAMEORIGIN",
        "content-security-policy": "frame-ancestors *",
      },
      expect: "fire",
    },
    {
      description: "X-Frame-Options: DENY and frame-ancestors 'none' agree",
      headers: {
        "x-frame-options": "DENY",
        "content-security-policy": "frame-ancestors 'none'",
      },
      expect: "skip",
    },
    {
      description:
        "X-Frame-Options: SAMEORIGIN and frame-ancestors 'self' agree",
      headers: {
        "x-frame-options": "SAMEORIGIN",
        "content-security-policy": "frame-ancestors 'self'",
      },
      expect: "skip",
    },
    {
      description: "no X-Frame-Options header present",
      headers: {
        "content-security-policy": "frame-ancestors *",
      },
      expect: "skip",
    },
  ],
  "page-csp-frame-ancestors-wildcard": [
    {
      description: "frame-ancestors allows any host",
      headers: { "content-security-policy": "frame-ancestors *" },
      expect: "fire",
      evidenceIncludes: "frame-ancestors",
    },
    {
      description: "frame-ancestors allows a wildcard subdomain",
      headers: {
        "content-security-policy": "frame-ancestors *.example.com",
      },
      expect: "fire",
    },
    {
      description: "frame-ancestors restricted to self",
      headers: { "content-security-policy": "frame-ancestors 'self'" },
      expect: "skip",
    },
    {
      description: "no frame-ancestors directive set",
      headers: { "content-security-policy": "script-src 'self'" },
      expect: "skip",
    },
  ],
};

describe("page-checks/csp", () => {
  runPageCheckTests(cspChecks, fixtures);
});
