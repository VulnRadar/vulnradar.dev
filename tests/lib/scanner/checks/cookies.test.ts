/**
 * Per-detector tests for the cookies category.
 *
 * Covers 31 detectors in lib/scanner/checks/cookies.ts. Every detector
 * is exercised by the smoke harness (callable, no-throw, deterministic);
 * the curated fixtures below cover the most common cookie patterns.
 */

import { detectors } from "@/lib/scanner/checks/cookies";
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
      description: "__Host- cookie is properly secured, not a finding",
      cookies: ["__Host-session=abc; Secure; Path=/"],
      expect: "skip",
    },
    {
      description:
        "cookie without host-prefix (normal; old fallback removed to reduce FPs)",
      cookies: ["session=abc; HttpOnly; Secure; SameSite=Lax"],
      expect: "skip",
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
      description: "cookie with no Domain (recommended — host-only scope)",
      cookies: ["session=abc"],
      expect: "skip",
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
      description: "removed — duplicate of cookie-domain-broad",
      cookies: ["session=abc; Domain=.example.com"],
      expect: "skip",
    },
  ],

  "cookie-domain-set-too-loose": [
    {
      description: "explicit Domain= is common and not a finding on its own",
      cookies: ["session=abc; Domain=example.com"],
      expect: "skip",
    },
  ],

  // ── Expires / Max-Age ───────────────────────────────────────────────

  "cookie-max-age-excessive": [
    {
      description: "removed — duplicate of cookie-expires-too-far",
      cookies: ["session=abc; Max-Age=99999999"],
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
      description: "Max-Age=0 is standard cookie deletion, not a finding",
      cookies: ["session=; Max-Age=0"],
      expect: "skip",
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
      description:
        "session cookies but no CSRF token (SameSite=Lax — not fully protected)",
      cookies: ["SESSIONID=abc; HttpOnly; Secure; SameSite=Lax"],
      expect: "fire",
      evidenceIncludes: "CSRF",
    },
    {
      description: "session + CSRF token (hasCsrf=true, so no finding)",
      cookies: [
        "SESSIONID=abc; HttpOnly; Secure; SameSite=Lax",
        "XSRF-TOKEN=xyz; Secure; SameSite=Lax",
      ],
      expect: "skip",
    },
    {
      description:
        "session with SameSite=Strict — CSRF attacks blocked by browser",
      cookies: ["SESSIONID=abc; HttpOnly; Secure; SameSite=Strict"],
      expect: "skip",
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
      description: "removed — duplicate of cookie-path-cross-app",
      cookies: ["session=abc; Path=/"],
      expect: "skip",
    },
  ],

  "cookie-path-cross-app": [
    {
      description: "Path=/ is the standard correct setting, not a finding",
      cookies: ["session=abc; Path=/"],
      expect: "skip",
    },
  ],

  "cookie-path-root": [
    {
      description: "removed — duplicate of cookie-path-cross-app",
      cookies: ["session=abc; Path=/"],
      expect: "skip",
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
      description: "removed — duplicate of cookie-no-secure-prefix",
      cookies: ["auth_token=abc; HttpOnly"],
      expect: "skip",
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
      // Disabled: a Domain= attribute does not indicate a cookie is used in
      // a genuinely cross-site/third-party iframe context (what Partitioned
      // actually targets) — that can't be determined from a single
      // response. ref: AUDIT-008#cookies-02
      description:
        "disabled — Domain= alone does not imply third-party/CHIPS applicability",
      cookies: ["tracking=abc; Domain=example.com"],
      expect: "skip",
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
      // Disabled: a Domain= attribute alone does not mean a cookie is
      // "third-party" — it's the standard way to share a session cookie
      // across subdomains for first-party SSO, which is completely ordinary
      // at any multi-subdomain company. This condition also always
      // overlapped with cookie-third-party-no-samesite-none-secure.
      // ref: AUDIT-008#cookies-02
      description:
        "disabled — Domain= alone does not imply the cookie is third-party",
      cookies: ["tracking=abc; Domain=example.com"],
      expect: "skip",
    },
  ],

  "cookie-third-party-no-samesite-none-secure": [
    {
      // Disabled: same flawed "Domain= implies third-party" premise. A
      // Domain-scoped SSO cookie using SameSite=Lax is a normal, secure
      // configuration — this check demanded SameSite=None instead, which is
      // worse advice, not better. The precise, real check (SameSite=None
      // declared without Secure) is set-cookie-samesite-none-no-secure.
      // ref: AUDIT-008#cookies-02
      description:
        "disabled — Domain= alone does not imply the cookie needs SameSite=None",
      cookies: ["tracking=abc; Domain=example.com; SameSite=Lax"],
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);
