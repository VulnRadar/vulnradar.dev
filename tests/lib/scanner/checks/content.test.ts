/**
 * Per-detector tests for the content category.
 *
 * "sensitive-meta-tags", "service-worker-scope", "bearer-token-exposed",
 * "sensitive-form-no-csrf", and "env-file-reference" have curated fixtures
 * (each added alongside a real bug fix -- see lib/scanner/checks/content.ts).
 * The rest of this category's detectors still get smoke coverage only,
 * same as before this file existed.
 */

import { detectors } from "@/lib/scanner/checks/content";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  "server-info": [
    {
      description: "Server: nginx/1.18.0 -- real version disclosure fires",
      headers: { server: "nginx/1.18.0" },
      expect: "fire",
      evidenceIncludes: "nginx",
    },
    {
      description:
        "Server: cloudflare -- names the CDN, not the origin, does not fire",
      headers: { server: "cloudflare" },
      expect: "skip",
    },
    {
      description:
        "Server: Vercel -- same as cloudflare, does not fire",
      headers: { server: "Vercel" },
      expect: "skip",
    },
    {
      description:
        "X-Powered-By still fires even when Server is the exempted cloudflare value",
      headers: { server: "cloudflare", "x-powered-by": "Express" },
      expect: "fire",
      evidenceIncludes: "x-powered-by",
    },
  ],
  "sensitive-meta-tags": [
    {
      description: "meta tag whose name identifies it as a CSRF token",
      body: '<html><head><meta name="csrf-token" content="abc123"></head></html>',
      expect: "fire",
      evidenceIncludes: "sensitive data",
    },
    {
      description:
        "ordinary meta description mentioning 'secrets' as a scan category, not a leaked credential",
      body:
        '<html><head><meta name="description" content="650+ deterministic checks across headers, TLS, cookies, DNS, and secrets.">' +
        '<meta property="og:description" content="650+ deterministic checks across headers, TLS, cookies, DNS, and secrets.">' +
        "</head></html>",
      expect: "skip",
    },
  ],
  "env-file-reference": [
    {
      description: ".env file reference in href attribute",
      body: '<html><body><a href="/.env.local">backup</a></body></html>',
      expect: "fire",
      evidenceIncludes: ".env",
    },
    {
      description:
        "bare .env mention in text (not in attribute, no longer fires -- e.g. docs/README prose)",
      body: "<html><body>Cannot load /.env.local</body></html>",
      expect: "skip",
    },
    {
      description:
        "nginx remediation snippet mentioning /.env (documentation, not a real link, no longer fires)",
      body: "<html><body><pre>location ~ /\\.env { deny all; }</pre></body></html>",
      expect: "skip",
    },
  ],
  "service-worker-scope": [
    {
      description:
        "plain register('/sw.js') with an explicit narrow scope option does not fire",
      body: "<script>navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' })</script>",
      expect: "skip",
    },
    {
      description:
        "register('/sw.js') with no options object -- the ordinary, expected PWA pattern -- still flags as broad but at low severity (checked via checks-data, not here)",
      body: "<script>navigator.serviceWorker.register('/sw.js')</script>",
      expect: "fire",
      evidenceIncludes: "narrow scope",
    },
  ],
  "bearer-token-exposed": [
    {
      description:
        "API docs placeholder 'Bearer YOUR_ACCESS_TOKEN_HERE' does not fire",
      body: "<pre>Authorization: Bearer YOUR_ACCESS_TOKEN_HERE</pre>",
      expect: "skip",
    },
    {
      description: "a real-looking mixed-case bearer token fires",
      body: "<script>headers.Authorization = 'Bearer aZ9x.k3Lp8qRstuVwXyz012345'</script>",
      expect: "fire",
      evidenceIncludes: "bearer token",
    },
  ],
  "sensitive-form-no-csrf": [
    {
      description:
        "POST form submitting to a third-party domain (Mailchimp-style newsletter signup) is not flagged for missing CSRF",
      body: '<form method="post" action="https://example.us1.list-manage.com/subscribe/post"><input name="EMAIL"></form>',
      expect: "skip",
    },
    {
      description: "same-origin POST form without a CSRF field still fires",
      body: '<form method="post" action="/api/update-profile"><input name="name"></form>',
      expect: "fire",
      evidenceIncludes: "csrf",
    },
  ],
  "google-api-key-exposed": [
    {
      description:
        "real-format key embedded in a <script src> query string (the common Google Maps JS loader pattern) fires",
      body: '<script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe"></script>',
      expect: "fire",
      evidenceIncludes: "google api key",
    },
    {
      description:
        "a bare maps.googleapis.com reference with no key at all does not fire",
      body: '<link rel="dns-prefetch" href="https://maps.googleapis.com">',
      expect: "skip",
    },
    {
      description:
        "a tutorial/docs page showing the key format as literal sample text inside <pre> does not fire",
      body: "<p>Your key will look like this:</p><pre>AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe</pre>",
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);
