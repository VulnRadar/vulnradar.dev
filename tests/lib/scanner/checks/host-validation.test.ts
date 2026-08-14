/**
 * Per-detector tests for the host-validation category.
 *
 * Curated fixtures cover "idor-sequential-id-in-url",
 * "open-redirect-location-confirmed", "open-redirect-meta-refresh-confirmed",
 * "webhook-ssrf-request-input-no-validation",
 * "url-import-ssrf-request-input-no-validation", and
 * "oauth-authorize-missing-state-param" -- each added alongside a real
 * false-positive fix or new detector, see
 * lib/scanner/checks/host-validation.ts. The rest of this category's
 * detectors get smoke coverage only via the shared harness.
 */

import { detectors } from "@/lib/scanner/checks/host-validation";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  "idor-sequential-id-in-url": [
    {
      description:
        "api-prefixed /user/{n} is still a real IDOR-shaped API path and fires",
      url: "https://shop.example.com/api/user/1042",
      expect: "fire",
      evidenceIncludes: "1042",
    },
    {
      description: "version-prefixed /v2/user/{n} still fires",
      url: "https://api.example.com/v2/user/77",
      expect: "fire",
      evidenceIncludes: "77",
    },
    {
      description: "bare /account/{n} still fires with no API prefix required",
      url: "https://example.com/account/42",
      expect: "fire",
      evidenceIncludes: "42",
    },
    {
      description:
        "Drupal's default /user/{uid} entity route (e.g. the site's own /user/1 admin page) is a CMS content-routing path, not an IDOR-shaped API resource -- does not fire",
      url: "https://example.edu/user/1",
      expect: "skip",
    },
    {
      description:
        "bare /profile/{n} with no api/version prefix is the same CMS-routing shape as /user/{n} -- does not fire",
      url: "https://example.com/profile/42",
      expect: "skip",
    },
  ],

  "open-redirect-location-confirmed": [
    {
      description:
        "redirect= param and Location header both resolve to an unrelated external host -- confirmed open redirect fires",
      url: "https://example.com/login?redirect=https://evil.com/phish",
      headers: { location: "https://evil.com/phish" },
      expect: "fire",
      evidenceIncludes: "evil.com",
    },
    {
      description:
        "Microsoft Defender Safe Links (safelinks.protection.outlook.com?url=...) legitimately 302s to the wrapped target after a reputation check -- not the scanned app's own open redirect, does not fire",
      url: "https://nam02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.example.com%2Fpage&data=abc123",
      headers: { location: "https://www.example.com/page" },
      expect: "skip",
    },
  ],

  "open-redirect-meta-refresh-confirmed": [
    {
      description:
        "redirect param matches a client-side meta-refresh to an unrelated external host -- fires",
      url: "https://example.com/go?redirect=https://evil.com/phish",
      body: '<html><head><meta http-equiv="refresh" content="0;url=https://evil.com/phish"></head></html>',
      expect: "fire",
      evidenceIncludes: "evil.com",
    },
    {
      description:
        "link-safety rewriter hostname (safelinks.protection.outlook.com) is excluded the same as the Location-header sibling detector",
      url: "https://nam02.safelinks.protection.outlook.com/?url=https://www.example.com/page",
      body: '<html><head><meta http-equiv="refresh" content="0;url=https://www.example.com/page"></head></html>',
      expect: "skip",
    },
  ],

  "webhook-ssrf-request-input-no-validation": [
    {
      description:
        "canonical Express-shaped req.body.webhookUrl assigned then passed to fetch() with no validation keyword nearby -- fires",
      body: "const webhookUrl = req.body.webhookUrl; await fetch(webhookUrl, { method: 'POST', body: JSON.stringify(payload) });",
      expect: "fire",
      evidenceIncludes: "req.body",
    },
    {
      description:
        "ordinary client-side OAuth/redirect callback handler using a local variable named 'params' (URLSearchParams), not a server req/request object -- does not fire",
      body: '<script>const params = new URLSearchParams(window.location.search); const callbackUrl = params.get("callback_url"); fetch(callbackUrl).then(r => r.json());</script>',
      expect: "skip",
    },
  ],

  "url-import-ssrf-request-input-no-validation": [
    {
      description:
        "avatar-from-URL field assigned from req.body then passed to fetch() with no validation keyword nearby -- fires",
      body: "const avatarUrl = req.body.avatarUrl; await fetch(avatarUrl);",
      expect: "fire",
      evidenceIncludes: "req.body",
    },
    {
      description:
        "link-preview/unfurl field assigned from req.query then passed to axios.get() with no validation keyword nearby -- fires",
      body: "const previewUrl = req.query.previewUrl; const res = await axios.get(previewUrl);",
      expect: "fire",
      evidenceIncludes: "req.query",
    },
    {
      description:
        "this product's own /docs page rendering the exact vulnerable pattern as a <pre><code> example snippet (the same codeExamples text this check's own JSON entry ships) -- does not fire",
      body: "<html><body><h2>Bad example</h2><pre><code>const avatarUrl = req.body.avatarUrl;\nawait fetch(avatarUrl);</code></pre></body></html>",
      expect: "skip",
    },
    {
      description:
        "client-side code reading a URL param into a local variable (not a real server req/request object) -- does not fire",
      body: '<script>const params = new URLSearchParams(window.location.search); const avatarUrl = params.get("avatar_url"); fetch(avatarUrl).then(r => r.blob());</script>',
      expect: "skip",
    },
  ],

  "oauth-authorize-missing-state-param": [
    {
      description:
        "authorize request with response_type and client_id but no state parameter -- fires",
      url: "https://accounts.example.com/oauth2/authorize?response_type=code&client_id=abc123",
      expect: "fire",
      evidenceIncludes: "state",
    },
    {
      description:
        "same authorize request with a state parameter present -- does not fire",
      url: "https://accounts.example.com/oauth2/authorize?response_type=code&client_id=abc123&state=xyz789",
      expect: "skip",
    },
    {
      description:
        "path merely contains /authorize with no response_type/client_id query params -- not a real authorization request, does not fire",
      url: "https://example.com/settings/authorize",
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);
