/**
 * Per-detector tests for the cookies category.
 *
 * Covers every detector in lib/scanner/checks/cookies.ts. Every detector
 * is exercised by the smoke harness (callable, no-throw, deterministic);
 * the curated fixtures below cover the most common cookie patterns.
 */

import { detectors } from "@/lib/scanner/checks/cookies";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  "cookie-maxage-expires-conflict": [
    {
      // Dead code from the day it was written. The Expires class was
      // [^;,]+ and every RFC 1123 cookie date has a comma in it
      // ("Wed, 09 Jun 2027 10:18:14 GMT"), so the capture stopped at "Wed"
      // and Date.parse rejected it. The same mistake had already been fixed
      // twice in this file.
      description:
        "regression: a comma in the cookie date no longer ends the capture",
      cookies: [
        "sid=abc; Max-Age=60; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Path=/",
      ],
      expect: "fire",
      evidenceIncludes: "Max-Age",
    },
    {
      description: "Max-Age and Expires that agree do not fire",
      cookies: [
        `sid=abc; Max-Age=3600; Expires=${new Date(Date.now() + 3600_000).toUTCString()}; Path=/`,
      ],
      expect: "skip",
    },
    {
      description: "a cookie with only one of the two says nothing",
      cookies: ["sid=abc; Max-Age=3600; Path=/"],
      expect: "skip",
    },
  ],

  // ── Flag presence ───────────────────────────────────────────────────

  // "cookie-security" is deliberately absent here: its live implementation is
  // in headers.ts (the definition's category is "headers"), and the dead copy
  // that used to sit in cookies.ts was deleted. headers.test.ts covers it.
  // ref: AUDIT-009#dup-09

  "cookie-httponly-missing": [
    {
      // Django's csrftoken and Laravel's XSRF-TOKEN are readable by design:
      // the double-submit pattern needs the page's own script to echo them
      // into a header, and HttpOnly would break CSRF protection rather than
      // add to it. Both names contain "token", so the sensitive filter caught
      // every correctly configured Django and Laravel site.
      description: "Django csrftoken is readable by design",
      cookies: ["csrftoken=abc; Secure; SameSite=Lax"],
      expect: "skip",
    },
    {
      description: "Laravel XSRF-TOKEN is readable by design",
      cookies: ["XSRF-TOKEN=abc; Secure; SameSite=Lax"],
      expect: "skip",
    },
    {
      // The exclusion is scoped to HttpOnly only. A CSRF token sent over
      // plain HTTP is still a real finding, on the Secure check.
      description: "a real session cookie beside a CSRF token still fires",
      cookies: ["csrftoken=abc; Secure; SameSite=Lax", "sessionid=xyz; Secure"],
      expect: "fire",
      evidenceIncludes: "sessionid",
    },
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
      description:
        "cookie with Domain but no leading dot -- RFC 6265bis treats it identically to the leading-dot form",
      cookies: ["session=abc; Domain=example.com"],
      expect: "fire",
      evidenceIncludes: "Domain",
    },
    {
      description: "cookie with no Domain (recommended — host-only scope)",
      cookies: ["session=abc"],
      expect: "skip",
    },
    {
      description:
        "Google Analytics' _ga with a site-wide Domain does not fire -- cross-subdomain is the entire point of that cookie and it authenticates nobody",
      cookies: ["_ga=GA1.1.1234567890.1700000000; Domain=.example.com; Path=/"],
      expect: "skip",
    },
    {
      description:
        "a consent-banner cookie with a site-wide Domain does not fire",
      cookies: ["OptanonConsent=groups=C0001%3A1; Domain=.example.com"],
      expect: "skip",
    },
    {
      description:
        "a locale preference cookie with a site-wide Domain does not fire",
      cookies: ["NEXT_LOCALE=en-GB; Domain=.example.com"],
      expect: "skip",
    },
    {
      description:
        "an analytics cookie alongside a session cookie still fires for the session cookie",
      cookies: [
        "_ga=GA1.1.1234567890.1700000000; Domain=.example.com",
        "session=abc; Domain=.example.com",
      ],
      expect: "fire",
      evidenceIncludes: "session",
    },
  ],

  // ── Expires / Max-Age ───────────────────────────────────────────────

  "cookie-expires-too-far": [
    {
      description: "Max-Age > 1 year (40 years) on a session cookie",
      cookies: ["session=abc; Max-Age=1261440000"],
      expect: "fire",
      evidenceIncludes: "max-age",
    },
    {
      description: "max-age 1 day",
      cookies: ["session=abc; Max-Age=86400"],
      expect: "skip",
    },
    {
      description:
        "non-sensitive analytics cookie with a 2-year Max-Age is not flagged (_ga-style)",
      cookies: ["_ga=GA1.2.123456789.987654321; Max-Age=63072000"],
      expect: "skip",
    },
    {
      description:
        "non-sensitive marketing cookie with a multi-year Expires date is not flagged (hubspotutk-style)",
      cookies: ["hubspotutk=abc123; Expires=Fri, 01 Jan 2100 00:00:00 GMT"],
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

  // ── Session / CSRF ──────────────────────────────────────────────────

  "cookie-no-csrf-token": [
    {
      description:
        "session cookies but no CSRF token and no SameSite at all (not protected)",
      cookies: ["SESSIONID=abc; HttpOnly; Secure"],
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
    {
      description:
        "session with SameSite=Lax — mitigates most CSRF, no longer flagged",
      cookies: ["SESSIONID=abc; HttpOnly; Secure; SameSite=Lax"],
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

  "cookie-secure-prefix-not-secure": [
    {
      description: "__Secure- prefix missing Secure attribute",
      cookies: ["__Secure-token=abc"],
      expect: "fire",
      evidenceIncludes: "__Secure-",
    },
  ],

  // ── Partitioned (CHIPS) ─────────────────────────────────────────────

  "cookie-partitioned-without-secure": [
    {
      description: "Partitioned without Secure (browsers reject)",
      cookies: ["tracking=abc; Partitioned"],
      expect: "fire",
      evidenceIncludes: "Secure",
    },
  ],

  // ── Third-party ─────────────────────────────────────────────────────
};

runDetectorTests(detectors, fixtures);
