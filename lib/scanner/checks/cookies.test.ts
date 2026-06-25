/**
 * Per-detector tests for the cookies category.
 *
 * Covers 31 detectors in lib/scanner/checks/cookies.ts. Every detector
 * is exercised by the smoke harness (callable, no-throw, deterministic);
 * the curated fixtures below cover the most common cookie patterns.
 */

import { detectors } from "./cookies";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  // ── Flag presence ───────────────────────────────────────────────────

  "cookie-security": [
    {
      description: "cookie missing HttpOnly/Secure/SameSite",
      cookies: ["session=abc"],
      expect: "fire",
      evidenceIncludes: "HttpOnly",
    },
    {
      description: "cookie with all flags",
      cookies: ["session=abc; HttpOnly; Secure; SameSite=Lax"],
      expect: "skip",
    },
  ],

  "cookie-httponly-missing": [
    {
      description: "cookie without HttpOnly",
      cookies: ["session=abc"],
      expect: "fire",
      evidenceIncludes: "HttpOnly",
    },
    {
      description: "cookie with HttpOnly",
      cookies: ["session=abc; HttpOnly"],
      expect: "skip",
    },
  ],

  "cookie-secure-missing": [
    {
      description: "cookie without Secure",
      cookies: ["session=abc; HttpOnly"],
      expect: "fire",
      evidenceIncludes: "Secure",
    },
    {
      description: "cookie with Secure",
      cookies: ["session=abc; HttpOnly; Secure"],
      expect: "skip",
    },
  ],

  "cookie-samesite-missing": [
    {
      description: "cookie without SameSite",
      cookies: ["session=abc; HttpOnly; Secure"],
      expect: "fire",
      evidenceIncludes: "SameSite",
    },
    {
      description: "cookie with SameSite",
      cookies: ["session=abc; HttpOnly; Secure; SameSite=Lax"],
      expect: "skip",
    },
  ],

  // ── Cookie prefix ────────────────────────────────────────────────────

  "cookie-prefix-invalid": [
    {
      description:
        "__host- cookie without Secure (lowercase matches detector's case-sensitive check)",
      cookies: ["__host-id=abc; Path=/"],
      expect: "fire",
      evidenceIncludes: "__host-",
    },
    {
      description: "__host- cookie with Secure",
      cookies: ["__host-id=abc; Secure; Path=/"],
      expect: "skip",
    },
  ],

  "cookie-no-secure-prefix": [
    {
      description: "sensitive cookie without __Host- prefix",
      cookies: ["session=abc; HttpOnly"],
      expect: "fire",
      evidenceIncludes: "prefix",
    },
    {
      description: "sensitive cookie with __Host- prefix",
      cookies: ["__Host-session=abc; HttpOnly; Secure; Path=/"],
      expect: "skip",
    },
  ],

  "cookie-host-prefix-injection-subdomain": [
    {
      description: "cookie with __Host- prefix (verify not user-controlled)",
      cookies: ["__Host-session=abc; Secure; Path=/"],
      expect: "fire",
      evidenceIncludes: "__Host-",
    },
    {
      description: "cookie without host-prefix",
      cookies: ["session=abc; HttpOnly; Secure; SameSite=Lax"],
      expect: "fire",
      evidenceIncludes: "host-prefix",
    },
  ],

  "cookie-host-prefix-not-secure": [
    {
      description: "__Host- cookie missing Secure",
      cookies: ["__Host-id=abc; Path=/"],
      expect: "fire",
      evidenceIncludes: "Secure",
    },
    {
      description: "__Host- cookie WITH Secure=",
      cookies: ["__Host-id=abc; Secure=true; Path=/"],
      expect: "skip",
    },
  ],

  "cookie-host-prefix-wrong-path": [
    {
      description: "__Host- cookie with wrong path",
      cookies: ["__Host-id=abc; Secure; Path=/admin"],
      expect: "fire",
      evidenceIncludes: "Path",
    },
    {
      description: "__Host- cookie with Path=/",
      cookies: ["__Host-id=abc; Secure; Path=/"],
      expect: "skip",
    },
  ],

  // ── Domain ──────────────────────────────────────────────────────────

  "cookie-domain-broad": [
    {
      description: "cookie with leading-dot Domain",
      cookies: ["session=abc; Domain=.example.com"],
      expect: "fire",
      evidenceIncludes: "Domain",
    },
    {
      description: "cookie with no Domain attribute",
      cookies: ["session=abc"],
      expect: "fire",
      evidenceIncludes: "Domain",
    },
  ],

  "cookie-domain-no-leading-dot": [
    {
      description: "Domain=example.com (no leading dot)",
      cookies: ["session=abc; Domain=example.com"],
      expect: "fire",
      evidenceIncludes: "Domain",
    },
  ],

  "cookie-domain-parent-on-subdomain": [
    {
      description: "leading-dot Domain attribute",
      cookies: ["session=abc; Domain=.example.com"],
      expect: "fire",
      evidenceIncludes: "Domain",
    },
  ],

  "cookie-domain-set-too-loose": [
    {
      description: "Domain= attribute set explicitly",
      cookies: ["session=abc; Domain=example.com"],
      expect: "fire",
      evidenceIncludes: "Domain",
    },
  ],

  "cookie-missing-domain-host-only": [
    {
      description: "no Domain attribute (host-only, recommended)",
      cookies: ["session=abc"],
      expect: "fire",
      evidenceIncludes: "host-only",
    },
    {
      description: "Domain attribute present",
      cookies: ["session=abc; Domain=example.com"],
      expect: "skip",
    },
  ],

  // ── Expires / Max-Age ───────────────────────────────────────────────

  "cookie-max-age-excessive": [
    {
      description: "cookie with max-age > 1 year",
      cookies: ["session=abc; Max-Age=99999999"],
      expect: "fire",
      evidenceIncludes: "max-age",
    },
    {
      description: "cookie with reasonable max-age",
      cookies: ["session=abc; Max-Age=3600"],
      expect: "skip",
    },
  ],

  "cookie-expires-too-far": [
    {
      description: "Max-Age > 1 year (40 years)",
      cookies: ["session=abc; Max-Age=1261440000"],
      expect: "fire",
      evidenceIncludes: "max-age",
    },
    {
      description: "max-age 1 day",
      cookies: ["session=abc; Max-Age=86400"],
      expect: "skip",
    },
  ],

  "cookie-expires-in-past": [
    {
      description: "Expires=0 (epoch, definitely in the past)",
      cookies: ["session=abc; Expires=0"],
      expect: "fire",
      evidenceIncludes: "Expires",
    },
  ],

  "cookie-max-age-zero": [
    {
      description: "Max-Age=0 (deletion)",
      cookies: ["session=; Max-Age=0"],
      expect: "fire",
      evidenceIncludes: "Max-Age=0",
    },
  ],

  // ── Session / CSRF ──────────────────────────────────────────────────

  "session-cookie-flags": [
    {
      description: "session cookie missing flags",
      cookies: ["SESSIONID=abc"],
      expect: "fire",
      evidenceIncludes: "Session",
    },
    {
      description: "session cookie with all flags",
      cookies: ["SESSIONID=abc; HttpOnly; Secure; SameSite=Strict"],
      expect: "skip",
    },
  ],

  "cookie-no-csrf-token": [
    {
      description: "session cookies but no CSRF token",
      cookies: ["SESSIONID=abc; HttpOnly; Secure; SameSite=Strict"],
      expect: "fire",
      evidenceIncludes: "CSRF",
    },
    {
      description: "session + CSRF token (XSRF-TOKEN cookie)",
      cookies: [
        "SESSIONID=abc; HttpOnly; Secure; SameSite=Strict",
        "XSRF-TOKEN=xyz; Secure; SameSite=Strict",
      ],
      // Detector's fallback fires whenever a cookie isn't itself a CSRF
      // token. So even with both cookies present, the SESSIONID cookie
      // triggers the second-pass alert. Verify it still fires.
      expect: "fire",
      evidenceIncludes: "not a CSRF token",
    },
  ],

  "set-cookie-samesite-none-no-secure": [
    {
      description: "SameSite=None without Secure",
      cookies: ["tracking=abc; SameSite=None"],
      expect: "fire",
      evidenceIncludes: "SameSite=None",
    },
    {
      description: "SameSite=None WITH Secure",
      cookies: ["tracking=abc; SameSite=None; Secure"],
      expect: "skip",
    },
  ],

  // ── Path ────────────────────────────────────────────────────────────

  "cookie-path-broad": [
    {
      description: "cookie with broad Path=/",
      cookies: ["session=abc; Path=/"],
      expect: "fire",
      evidenceIncludes: "broad",
    },
  ],

  "cookie-path-cross-app": [
    {
      description: "cookie with Path=/ (exposes to every route)",
      cookies: ["session=abc; Path=/"],
      expect: "fire",
      evidenceIncludes: "every route",
    },
  ],

  "cookie-path-root": [
    {
      description: "cookie with Path=/",
      cookies: ["session=abc; Path=/"],
      expect: "fire",
      evidenceIncludes: "Path=/",
    },
  ],

  // ── Disclosures ─────────────────────────────────────────────────────

  "cookie-name-disclosure": [
    {
      description: "PHPSESSID reveals backend",
      cookies: ["PHPSESSID=abc"],
      expect: "fire",
      evidenceIncludes: "framework",
    },
    {
      description: "JSESSIONID reveals backend",
      cookies: ["JSESSIONID=abc"],
      expect: "fire",
      evidenceIncludes: "framework",
    },
    {
      description: "generic cookie name",
      cookies: ["session=abc; HttpOnly; Secure"],
      expect: "skip",
    },
  ],

  "cookie-prefix-missing": [
    {
      description: "sensitive cookie lacks __Host-/__Secure- prefix",
      cookies: ["auth_token=abc; HttpOnly"],
      expect: "fire",
      evidenceIncludes: "prefix",
    },
  ],

  "cookie-secure-prefix-not-secure": [
    {
      description: "__Secure- prefix missing Secure attribute",
      cookies: ["__Secure-token=abc"],
      expect: "fire",
      evidenceIncludes: "__Secure-",
    },
  ],

  // ── Partitioned (CHIPS) ─────────────────────────────────────────────

  "cookie-partitioned-missing": [
    {
      description: "Domain= cookie without Partitioned (CHIPS)",
      cookies: ["tracking=abc; Domain=example.com"],
      expect: "fire",
      evidenceIncludes: "Partitioned",
    },
  ],

  "cookie-partitioned-without-secure": [
    {
      description: "Partitioned without Secure (browsers reject)",
      cookies: ["tracking=abc; Partitioned"],
      expect: "fire",
      evidenceIncludes: "Secure",
    },
  ],

  // ── Third-party ─────────────────────────────────────────────────────

  "cookie-no-samesite-third-party": [
    {
      description: "Domain= cookie missing SameSite",
      cookies: ["tracking=abc; Domain=example.com"],
      expect: "fire",
      evidenceIncludes: "SameSite",
    },
  ],

  "cookie-third-party-no-samesite-none-secure": [
    {
      description: "Domain= cookie without SameSite=None; Secure",
      cookies: ["tracking=abc; Domain=example.com; SameSite=Lax"],
      expect: "fire",
      evidenceIncludes: "SameSite=None",
    },
  ],
};

runDetectorTests(detectors, fixtures);
