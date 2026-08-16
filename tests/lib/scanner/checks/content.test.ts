/**
 * Per-detector tests for the content category.
 *
 * "sensitive-meta-tags", "service-worker-scope", "bearer-token-exposed",
 * "sensitive-form-no-csrf", "form-method-get-sensitive", and
 * "env-file-reference" have curated fixtures
 * (each added alongside a real bug fix -- see lib/scanner/checks/content.ts).
 * The rest of this category's detectors still get smoke coverage only,
 * same as before this file existed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// checkSourceMapSourcesExposed makes a real follow-up fetch via safeFetch,
// which resolves the target hostname through dns/promises' lookup before
// ever calling fetch(). Mocked here to a public IP so tests exercise the
// real fetch/parse logic instead of failing on DNS resolution in the test
// sandbox -- same mock async-checks.test.ts uses for the same reason.
vi.mock("dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

import {
  detectors,
  checkSourceMapSourcesExposed,
} from "@/lib/scanner/checks/content";
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
      description: "Server: Vercel -- same as cloudflare, does not fire",
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
  "form-method-get-sensitive": [
    {
      description:
        'explicit method="get" with a password field is a real credential-in-URL bug and fires',
      body: '<form method="get" action="/login"><input type="password" name="password"></form>',
      expect: "fire",
      evidenceIncludes: "GET method",
    },
    {
      description:
        "no method attribute at all with a password field, on a plain (non-framework) page, defaults to native GET and fires",
      body: '<form action="/login"><input type="password" name="password"></form>',
      expect: "fire",
      evidenceIncludes: "GET method",
    },
    {
      description:
        "React/Next.js login form with no method attribute does not fire -- onSubmit+preventDefault() intercepts native submission and posts via fetch() instead, the exact shape that misfired on VulnRadar's own /login",
      body: '<div id="__next"><script>window.__NEXT_DATA__ = {}</script><form><input type="password" name="password"></form></div>',
      expect: "skip",
    },
    {
      description:
        'explicit method="get" still fires even on a framework page -- a developer wrote it, real signal regardless of any JS layer on top',
      body: '<div id="__next"><script>window.__NEXT_DATA__ = {}</script><form method="get"><input type="password" name="password"></form></div>',
      expect: "fire",
      evidenceIncludes: "GET method",
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
  "stripe-key-exposed": [
    {
      description: "sk_live_ secret key in source fires",
      body: "<script>const stripe = require('stripe')('sk_live_51H8xJKLQWERTYUIOPASDFGHJKLZXCVB');</script>",
      expect: "fire",
      evidenceIncludes: "stripe secret key",
    },
    {
      description:
        "standard Stripe.js client-side init with only a pk_live_ publishable key (the required, documented pattern for every Stripe Checkout/Elements integration) does not fire -- publishable keys are meant to be public",
      body: "<script>Stripe('pk_live_51H8xJKLQWERTYUIOPASDFGHJKLZXCVB').elements();</script>",
      expect: "skip",
    },
  ],
  "phishing-lookalike-domain": [
    {
      description: "actual brand homoglyph in a link fires",
      body: '<a href="http://secure.faceb00k.com/login">Verify your account</a>',
      expect: "fire",
      evidenceIncludes: "lookalike",
    },
    {
      description:
        "legitimate IDN domain (xn-- ACE prefix, e.g. a German umlaut domain's own canonical link) does not fire -- xn-- alone isn't a brand-lookalike signal",
      body: '<link rel="canonical" href="https://www.xn--mnchen-3ya.de/">',
      expect: "skip",
    },
  ],
  "graphql-introspection": [
    {
      description:
        "__schema{ reference on an actual /graphql endpoint response fires",
      url: "https://example.com/graphql",
      body: '{"query":"query IntrospectionQuery { __schema { types { name } } }"}',
      expect: "fire",
      evidenceIncludes: "introspection",
    },
    {
      description:
        "query IntrospectionQuery reference alongside a real GraphQL data/errors envelope (non-/graphql URL) fires",
      url: "https://example.com/api/proxy",
      body: '{"data":null,"errors":[{"message":"Blocked: run a query IntrospectionQuery to inspect the schema"}]}',
      expect: "fire",
      evidenceIncludes: "introspection",
    },
    {
      description:
        "Apollo Client bundle mentioning getIntrospectionQuery on an ordinary marketing page (not /graphql, no GraphQL response envelope nearby) does not fire",
      url: "https://example.com/about",
      body: '<script>function getIntrospectionQuery(){}; var __schema=\'reserved for internal fragment matching\';</script><p>__NEXT_DATA__ style blob: {"props":{"pageProps":{"data":{"title":"About us"}}}}</p>',
      expect: "skip",
    },
    {
      description:
        "blog post prose discussing GraphQL introspection (documentation, no live endpoint context) does not fire",
      url: "https://example.com/blog/api-security-tips",
      body: "<p>Disabling __schema introspection with a query IntrospectionQuery hardening step is common GraphQL advice.</p>",
      expect: "skip",
    },
  ],
  "clipboard-hijack-pattern": [
    {
      description:
        "copy listener that discards the selection and substitutes a static string (e.g. a crypto address swap) fires",
      body: "<script>document.addEventListener('copy', function(e){ e.clipboardData.setData('text/plain', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'); e.preventDefault(); });</script>",
      expect: "fire",
      evidenceIncludes: "clipboard-hijacking",
    },
    {
      description:
        "common 'Read more at <url>' copy-attribution snippet that appends to the original getSelection() text does not fire",
      body: "<script>document.addEventListener('copy', function(e){ e.clipboardData.setData('text/plain', document.getSelection() + '\\n\\nRead more at ' + location.href); e.preventDefault(); });</script>",
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);

// checkSourceMapSourcesExposed is exported separately from `detectors`
// (see the comment above its definition in content.ts): it needs a real
// follow-up HTTP fetch, which the synchronous detector map's contract
// can't support, so it isn't covered by runDetectorTests above.
describe("checkSourceMapSourcesExposed", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when the body has no sourceMappingURL comment at all", async () => {
    const result = await checkSourceMapSourcesExposed(
      "https://example.com/static/app.js",
      new Headers(),
      "console.log('no map reference here');",
    );
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fires when the referenced .map file is fetched and contains non-empty sourcesContent", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: () =>
        Promise.resolve(
          JSON.stringify({
            version: 3,
            sources: ["webpack:///src/app.js"],
            sourcesContent: ["export function secretLogic() { return 42; }"],
          }),
        ),
    });
    const body = "console.log(1);\n//# sourceMappingURL=app.js.map";
    const result = await checkSourceMapSourcesExposed(
      "https://example.com/static/app.js",
      new Headers(),
      body,
    );
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toContain("sourcescontent");
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/static/app.js.map",
      expect.anything(),
    );
  });

  it("does not fire when the .map file 404s -- leaves the reference-only finding as the only signal", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
    });
    const body = "console.log(1);\n//# sourceMappingURL=app.js.map";
    const result = await checkSourceMapSourcesExposed(
      "https://example.com/static/app.js",
      new Headers(),
      body,
    );
    expect(result).toBeNull();
  });

  it("does not fire when the map is reachable but has no sourcesContent field", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: () =>
        Promise.resolve(
          JSON.stringify({
            version: 3,
            sources: ["src/app.js"],
            mappings: "AAAA",
          }),
        ),
    });
    const body = "console.log(1);\n//# sourceMappingURL=app.js.map";
    const result = await checkSourceMapSourcesExposed(
      "https://example.com/static/app.js",
      new Headers(),
      body,
    );
    expect(result).toBeNull();
  });

  it("does not fire when sourcesContent is present but every entry is empty/null", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: () =>
        Promise.resolve(
          JSON.stringify({
            version: 3,
            sources: ["src/app.js"],
            sourcesContent: [null, ""],
          }),
        ),
    });
    const body = "console.log(1);\n//# sourceMappingURL=app.js.map";
    const result = await checkSourceMapSourcesExposed(
      "https://example.com/static/app.js",
      new Headers(),
      body,
    );
    expect(result).toBeNull();
  });

  it("does not fire on a fetch that throws (timeout/network error) -- falls back to the reference-only finding", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error"),
    );
    const body = "console.log(1);\n//# sourceMappingURL=app.js.map";
    const result = await checkSourceMapSourcesExposed(
      "https://example.com/static/app.js",
      new Headers(),
      body,
    );
    expect(result).toBeNull();
  });

  it("does not attempt a network fetch for an inline data: source map reference", async () => {
    // Contrived (real data: URIs don't naturally end in ".map"), but
    // exercises the explicit data: guard rather than relying on the
    // capture regex to reject it for an unrelated reason.
    const body =
      "console.log(1);\n//# sourceMappingURL=data:text/plain;base64,Zm9v.map";
    const result = await checkSourceMapSourcesExposed(
      "https://example.com/static/app.js",
      new Headers(),
      body,
    );
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
