/**
 * Per-detector tests for the host-validation category.
 *
 * Every detector in lib/scanner/checks/host-validation.ts now has curated
 * fire/skip fixtures rather than smoke-only coverage. The earlier fixture
 * set only covered the six detectors that had shipped a false-positive fix,
 * which left this module at ~43% branch coverage: over half the arms that
 * decide whether a finding is emitted never ran in a test. An unexercised
 * arm that stops emitting is the worst failure mode this product has, since
 * the user sees a completed scan with fewer findings and no error, so the
 * fixtures below deliberately walk both sides of every emit/suppress
 * decision (reflection present vs absent, private vs public webhook target,
 * same-origin vs off-domain redirect, validated vs unvalidated SSRF sink)
 * instead of only the headline positive case.
 */

import { detectors } from "@/lib/scanner/checks/host-validation";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  "host-header-injection": [
    {
      description:
        "Location header echoes back the X-Forwarded-Host value: redirect target is attacker-controlled",
      headers: {
        "x-forwarded-host": "attacker.example.net",
        location: "https://attacker.example.net/reset",
      },
      expect: "fire",
      evidenceIncludes: "Location header reflects X-Forwarded-Host",
    },
    {
      description:
        "response body echoes back the X-Forwarded-Host value (absolute links built from the header)",
      headers: { "x-forwarded-host": "attacker.example.net" },
      body: '<html><body><a href="https://attacker.example.net/reset">Reset your password</a></body></html>',
      expect: "fire",
      evidenceIncludes: "Response body reflects X-Forwarded-Host",
    },
    {
      description:
        "X-Forwarded-Host present on the response but reflected nowhere: a proxy passing the header through is not itself a finding",
      headers: {
        "x-forwarded-host": "edge.example.com",
        location: "https://example.com/home",
      },
      body: "<html><body><p>Welcome back.</p></body></html>",
      expect: "skip",
    },
    {
      description: "no X-Forwarded-Host header at all",
      headers: { location: "https://example.com/home" },
      expect: "skip",
    },
  ],

  "symfony-debug-token": [
    {
      description:
        "X-Debug-Token with its profiler link: Symfony debug profiler left enabled in production",
      headers: {
        "x-debug-token": "a1b2c3",
        "x-debug-token-link": "/_profiler/a1b2c3",
      },
      expect: "fire",
      evidenceIncludes: "/_profiler/a1b2c3",
    },
    {
      description:
        "X-Debug-Token with no accompanying link header still fires, without an empty link fragment in the evidence",
      headers: { "x-debug-token": "a1b2c3" },
      expect: "fire",
      evidenceIncludes: "x-debug-token: a1b2c3",
      evidenceExcludes: "link:",
    },
    {
      description: "ordinary response with no Symfony debug headers",
      headers: { "x-powered-by": "PHP/8.2" },
      expect: "skip",
    },
  ],

  "http-request-smuggling": [
    {
      description:
        "both Transfer-Encoding: chunked and Content-Length present on the same response",
      headers: { "transfer-encoding": "chunked", "content-length": "42" },
      expect: "fire",
      evidenceIncludes: "smuggling",
    },
    {
      description:
        "Transfer-Encoding present but not chunked (e.g. gzip) alongside Content-Length is not the smuggling shape",
      headers: { "transfer-encoding": "gzip", "content-length": "42" },
      expect: "skip",
    },
    {
      description: "Content-Length alone, the normal case",
      headers: { "content-length": "42" },
      expect: "skip",
    },
  ],

  "basic-auth-over-http": [
    {
      description:
        "WWW-Authenticate: Basic challenge issued over plain HTTP: credentials go out as base64 in the clear",
      url: "http://example.com/admin",
      headers: { "www-authenticate": 'Basic realm="Admin"' },
      expect: "fire",
      evidenceIncludes: "plaintext Base64",
    },
    {
      description:
        "the same Basic challenge over HTTPS is the ordinary, correctly protected case",
      url: "https://example.com/admin",
      headers: { "www-authenticate": 'Basic realm="Admin"' },
      expect: "skip",
    },
    {
      description:
        "Bearer challenge over HTTP is a different scheme and not this detector's job",
      url: "http://example.com/api",
      headers: { "www-authenticate": 'Bearer realm="api"' },
      expect: "skip",
    },
    {
      description: "no WWW-Authenticate header",
      url: "http://example.com/",
      expect: "skip",
    },
  ],

  "aspnet-viewstate-no-mac": [
    {
      description:
        "enableViewStateMac explicitly set to false: confirmed misconfiguration, not an inference",
      body: '<form><input type="hidden" name="__VIEWSTATE" value="/wEPDwUK" /><!-- enableViewStateMac="false" --></form>',
      expect: "fire",
      evidenceIncludes: "explicitly disabled",
    },
    {
      description:
        "ViewStateEncryptionMode=Never is the other explicit-disable spelling",
      body: '<form><input type="hidden" name="__VIEWSTATE" value="/wEPDwUK" /><!-- ViewStateEncryptionMode="Never" --></form>',
      expect: "fire",
      evidenceIncludes: "explicitly disabled",
    },
    {
      description:
        "__VIEWSTATE with no sibling MAC field: reported as unconfirmed, since some ASP.NET versions embed the MAC inside __VIEWSTATE itself",
      body: '<form><input type="hidden" name="__VIEWSTATE" value="/wEPDwUK" /></form>',
      expect: "fire",
      evidenceIncludes: "could not be confirmed",
    },
    {
      description: "__VIEWSTATE accompanied by a __VIEWSTATEMAC field",
      body: '<form><input type="hidden" name="__VIEWSTATE" value="/wEPDwUK" /><input type="hidden" name="__VIEWSTATEMAC" value="abc" /></form>',
      expect: "skip",
    },
    {
      description:
        'enableViewStateMac="true" declared in the markup is the other way a MAC is confirmed present',
      body: '<form><input type="hidden" name="__VIEWSTATE" value="/wEPDwUK" /><!-- enableViewStateMac="true" --></form>',
      expect: "skip",
    },
    {
      description:
        "page with no ViewState at all (not an ASP.NET WebForms page)",
      body: "<html><body><p>Hello</p></body></html>",
      expect: "skip",
    },
  ],

  "cache-poisoning-unkeyed-header": [
    {
      description:
        "cache HIT on a response that also reflects X-Forwarded-Host: a poisoned entry would be served to everyone",
      headers: { "x-cache": "HIT", "x-forwarded-host": "attacker.example.net" },
      expect: "fire",
      evidenceIncludes: "cache poisoning risk",
    },
    {
      description:
        "the X-Cache-Status spelling (nginx/Cloudflare) with X-Original-URL is the same condition",
      headers: {
        "x-cache-status": "HIT",
        "x-original-url": "/admin/secret",
      },
      expect: "fire",
      evidenceIncludes: "cache poisoning risk",
    },
    {
      description:
        "cache MISS: nothing was stored, so an unkeyed routing header cannot have poisoned an entry",
      headers: { "x-cache": "MISS", "x-forwarded-host": "edge.example.com" },
      expect: "skip",
    },
    {
      description:
        "cache HIT with no routing headers reflected: an ordinary CDN hit",
      headers: { "x-cache": "HIT" },
      expect: "skip",
    },
  ],

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
    {
      description:
        "/item/{n} names a public catalog resource with no ownership concept, so it is not an IDOR signal -- does not fire",
      url: "https://shop.example.com/item/42",
      expect: "skip",
    },
    {
      description:
        "a UUID rather than a sequential integer is not enumerable -- does not fire",
      url: "https://example.com/account/6f1b9d2e-5a1c-4f4e-9a3b-2c8d0e7f1a55",
      expect: "skip",
    },
    {
      description:
        "a high (non-enumerable) user id earlier in a nested REST path must not clear a low order id later in it: the first pattern's failed range gate used to stop the second pattern running at all",
      url: "https://api.example.com/api/user/12345/orders/7",
      expect: "fire",
      evidenceIncludes: "(7)",
    },
    {
      description:
        "a five-digit id on its own is not trivially enumerable -- does not fire",
      url: "https://api.example.com/api/user/12345",
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
    {
      description:
        "no Location header at all: nothing was confirmed, so nothing is reported",
      url: "https://example.com/login?redirect=https://evil.com/phish",
      expect: "skip",
    },
    {
      description:
        "same-host redirect, the overwhelming majority of real traffic",
      url: "https://example.com/login?redirect=https://evil.com/phish",
      headers: { location: "https://example.com/dashboard" },
      expect: "skip",
    },
    {
      description:
        "cross-subdomain redirect within the same organizational domain is normal SSO routing, not a phishing vector",
      url: "https://app.example.com/login?redirect=https://accounts.example.com/sso",
      headers: { location: "https://accounts.example.com/sso" },
      expect: "skip",
    },
    {
      description:
        "the external Location target came from somewhere other than a redirect-shaped query param",
      url: "https://example.com/login?tracking=https://evil.com/phish",
      headers: { location: "https://evil.com/phish" },
      expect: "skip",
    },
    {
      description:
        "redirect param holds a relative path, so it cannot be what sent the browser off-domain",
      url: "https://example.com/login?redirect=/dashboard",
      headers: { location: "https://evil.com/phish" },
      expect: "skip",
    },
    {
      description:
        "redirect param points at a different external host than the Location header: the param did not drive the redirect",
      url: "https://example.com/login?redirect=https://partner.example.org/",
      headers: { location: "https://evil.com/phish" },
      expect: "skip",
    },
    {
      description:
        "redirect param value is not parseable as a URL: skipped rather than crashing the scan",
      url: "https://example.com/login?redirect=%2F%2F%5B",
      headers: { location: "https://evil.com/phish" },
      expect: "skip",
    },
    {
      description:
        "unparseable Location header value: skipped rather than crashing the scan",
      url: "https://example.com/login?redirect=https://evil.com/phish",
      headers: { location: "http://[" },
      expect: "skip",
    },
    {
      description: "unparseable request URL: skipped rather than crashing",
      url: "not-a-valid-url",
      headers: { location: "https://evil.com/phish" },
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
    {
      description:
        "documentation page showing a meta-refresh tag inside <pre><code> is describing the pattern, not performing it",
      url: "https://example.com/docs?redirect=https://evil.com/phish",
      body: '<html><body><pre><code>&lt;meta http-equiv="refresh" content="0;url=https://evil.com/phish"&gt;</code><meta http-equiv="refresh" content="0;url=https://evil.com/phish"></pre></body></html>',
      expect: "skip",
    },
    {
      description:
        "meta-refresh to the same host is an ordinary in-app redirect page",
      url: "https://example.com/go?redirect=https://example.com/home",
      body: '<html><head><meta http-equiv="refresh" content="0;url=https://example.com/home"></head></html>',
      expect: "skip",
    },
    {
      description:
        "meta-refresh across subdomains of the same organizational domain is normal routing",
      url: "https://app.example.com/go?redirect=https://accounts.example.com/sso",
      body: '<html><head><meta http-equiv="refresh" content="0;url=https://accounts.example.com/sso"></head></html>',
      expect: "skip",
    },
    {
      description:
        "external meta-refresh target with no matching redirect-shaped query param: the redirect is hardcoded, not attacker-controlled",
      url: "https://example.com/go?campaign=spring",
      body: '<html><head><meta http-equiv="refresh" content="0;url=https://evil.com/phish"></head></html>',
      expect: "skip",
    },
    {
      description:
        "redirect param value is not parseable as a URL: skipped rather than crashing the scan",
      url: "https://example.com/go?redirect=%2F%2F%5B",
      body: '<html><head><meta http-equiv="refresh" content="0;url=https://evil.com/phish"></head></html>',
      expect: "skip",
    },
    {
      description:
        "meta-refresh target is not parseable as a URL: skipped rather than crashing the scan",
      url: "https://example.com/go?redirect=https://evil.com/phish",
      body: '<html><head><meta http-equiv="refresh" content="0;url=http://["></head></html>',
      expect: "skip",
    },
    {
      description: "unparseable request URL: skipped rather than crashing",
      url: "not-a-valid-url",
      body: '<html><head><meta http-equiv="refresh" content="0;url=https://evil.com/phish"></head></html>',
      expect: "skip",
    },
  ],

  "webhook-callback-private-ip-target": [
    {
      description:
        "settings JSON shows a saved webhook pointed at loopback: the app accepted a private target, so no host validation ran",
      body: '{"notificationsEnabled": true, "webhookUrl": "http://localhost:3000/hook"}',
      expect: "fire",
      evidenceIncludes: "localhost",
    },
    {
      description:
        "saved callback pointed at an RFC1918 address (rendered form field rather than JSON)",
      body: '<form><input type="url" name="webhook_url" value="http://10.0.0.5/notify"></form>',
      expect: "fire",
      evidenceIncludes: "10.0.0.5",
    },
    {
      description:
        "saved callback pointed at an internal-only hostname suffix (.internal)",
      body: '{"callbackUrl": "http://build-agent.internal/notify"}',
      expect: "fire",
      evidenceIncludes: "build-agent.internal",
    },
    {
      description:
        "saved callback pointed at the cloud metadata endpoint (169.254.169.254)",
      body: '{"callbackUrl": "http://169.254.169.254/latest/meta-data/"}',
      expect: "fire",
      evidenceIncludes: "169.254.169.254",
    },
    {
      description:
        "ordinary public webhook target: the normal, correctly configured case",
      body: '{"webhookUrl": "https://hooks.example.com/services/T000/B000"}',
      expect: "skip",
    },
    {
      description:
        "API documentation showing a localhost webhook inside a <pre><code> example block is not a live configuration",
      body: '<html><body><pre><code>{"webhookUrl": "http://127.0.0.1:9000/hook"}</code></pre></body></html>',
      expect: "skip",
    },
    {
      description:
        "webhook-named input field with no value attribute (an empty settings form) has nothing to evaluate",
      body: '<form><input type="url" name="webhook_url" placeholder="https://..."></form>',
      expect: "skip",
    },
    {
      description:
        "an input field whose name has nothing to do with webhooks is ignored even when it holds a private address",
      body: '<form><input type="url" name="proxy_host" value="http://10.0.0.5/"></form>',
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
    {
      description:
        "the same vulnerable snippet rendered as a <pre><code> documentation example, not live source",
      body: "<html><body><pre><code>const webhookUrl = req.body.webhookUrl;\nawait fetch(webhookUrl);</code></pre></body></html>",
      expect: "skip",
    },
    {
      description:
        "webhook URL taken off the request but only persisted, never fetched: no outbound call, so no SSRF sink",
      body: "const webhookUrl = req.body.webhookUrl; await db.settings.update({ webhookUrl });",
      expect: "skip",
    },
    {
      description:
        "webhook URL taken off the request but validated against private ranges before the outbound call -- the correctly hardened case",
      body: "const webhookUrl = req.body.webhookUrl; if (isPrivateHostname(new URL(webhookUrl).hostname)) throw new Error('blocked'); await fetch(webhookUrl);",
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
    {
      description:
        "avatar URL stored but never fetched server-side: no outbound call, so no SSRF sink",
      body: "const avatarUrl = req.body.avatarUrl; await db.users.update({ avatarUrl });",
      expect: "skip",
    },
    {
      description:
        "avatar URL validated against private ranges before the outbound call -- the correctly hardened case",
      body: "const avatarUrl = req.body.avatarUrl; assertNotPrivateIP(avatarUrl); await fetch(avatarUrl);",
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
        "the OIDC /openid-connect/auth endpoint spelling (Keycloak) is recognised as an authorize endpoint too",
      url: "https://sso.example.com/realms/main/protocol/openid-connect/auth?response_type=code&client_id=abc123",
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
    {
      description:
        "response_type present but no client_id: not a complete authorization request, so nothing is confirmed",
      url: "https://accounts.example.com/oauth2/authorize?response_type=code",
      expect: "skip",
    },
    {
      description: "an ordinary page path that is not an authorize endpoint",
      url: "https://example.com/dashboard?response_type=code&client_id=abc123",
      expect: "skip",
    },
    {
      description: "unparseable request URL: skipped rather than crashing",
      url: "not-a-valid-url",
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);
