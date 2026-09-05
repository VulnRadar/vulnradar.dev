/**
 * Per-detector tests for the content category.
 *
 * "sensitive-meta-tags", "service-worker-scope", "bearer-token-exposed",
 * "sensitive-form-no-csrf", "form-method-get-sensitive", "open-form-action",
 * and "env-file-reference" have curated fixtures
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
  // The optional wrapper call sat between two `\s*` runs and could match
  // nothing, leaving the two runs free to split the same whitespace every
  // way: 16.2 seconds on a 128 KB body. The paren is folded into the
  // optional group now, so every form it has to keep matching is listed.
  "open-redirect": [
    {
      description: "a redirect parameter carrying an absolute URL fires",
      body: '<html><body><a href="/go?next=https://evil.example/pwn">continue</a></body></html>',
      expect: "fire",
      evidenceIncludes: "open-redirect",
    },
    {
      description: "assigning location straight from the query string fires",
      body: "<html><body><script>window.location = new URLSearchParams(location.search).get('r')</script></body></html>",
      expect: "fire",
    },
    {
      description: "the decodeURIComponent-wrapped form fires",
      body: "<html><body><script>window.location = decodeURIComponent(location.hash)</script></body></html>",
      expect: "fire",
    },
    {
      description: "a relative in-app redirect target does not fire",
      body: '<html><body><a href="/login?next=/dashboard">sign in</a></body></html>',
      expect: "skip",
    },
    {
      description:
        "a window.location assignment followed by a long whitespace run does not fire",
      body: `<html><body><script>window.location =${" ".repeat(4000)}</script></body></html>`,
      expect: "skip",
    },
  ],

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
  // Moved here from information-disclosure.test.ts: content.ts owns the
  // "content"-category definition, so content.ts's detector is the one a real
  // scan runs. The identical copies in information-disclosure.ts and code.ts
  // were dead and have been deleted. ref: AUDIT-009#dup-07
  "sourcemap-reference": [
    {
      description: "JS with sourceMappingURL",
      body: '<html><body><script src="/app.js">//# sourceMappingURL=/app.js.map</script></body></html>',
      expect: "fire",
      evidenceIncludes: "source map",
    },
    {
      description: "page with no sourceMappingURL comment does not fire",
      body: '<html><body><script src="/app.js"></script></body></html>',
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
    {
      description:
        "regression: repeated-x placeholder ('Bearer vr_live_xxxxxxxxxxxxxxxxxxxxxxxx', our own API docs' example) does not fire -- not ALL-CAPS, so it slipped past that exclusion alone",
      body: "<code>Authorization: Bearer vr_live_xxxxxxxxxxxxxxxxxxxxxxxx</code>",
      expect: "skip",
    },
    {
      description:
        "regression (false negative): a docs placeholder FIRST and a real token second still fires -- the old non-global body.match judged only the first 'Bearer ...' on the page, so the placeholder masked the real leak below it",
      body:
        "<pre>Authorization: Bearer YOUR_ACCESS_TOKEN_HERE</pre>" +
        "<script>h.Authorization = 'Bearer aZ9x.k3Lp8qRstuVwXyz012345'</script>",
      expect: "fire",
      evidenceIncludes: "bearer token",
    },
  ],
  "aws-credentials-exposed": [
    {
      description:
        "AWS's own documentation example key (AKIAIOSFODNN7EXAMPLE) alone does not fire",
      body: "<p>Example credentials: AKIAIOSFODNN7EXAMPLE</p>",
      expect: "skip",
    },
    {
      description:
        "regression (false negative): the EXAMPLE key FIRST and a real access key ID second still fires -- the old non-global body.match judged only the first AKIA match",
      body:
        "<p>Example credentials: AKIAIOSFODNN7EXAMPLE</p>" +
        '<script>var k = "AKIA3XZQ7NPLM2VKD9RT";</script>',
      expect: "fire",
      evidenceIncludes: "access key id",
    },
  ],
  "github-token-exposed": [
    {
      description:
        "a redacted docs placeholder (ghp_ followed by 36 literal x characters) alone does not fire",
      body: `<pre>ghp_${"x".repeat(36)}</pre>`,
      expect: "skip",
    },
    {
      description:
        "regression (false negative): the redacted placeholder FIRST and a real-looking PAT second still fires -- the old non-global body.match judged only the first ghp_ match",
      body:
        `<pre>ghp_${"x".repeat(36)}</pre>` +
        '<script>const t = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";</script>',
      expect: "fire",
      evidenceIncludes: "github pat",
    },
  ],
  "database-connection-string": [
    {
      description:
        "a getting-started placeholder connection string (user:password@) alone does not fire",
      body: "<p>Set DATABASE_URL to postgresql://user:password@localhost:5432/mydb in your env file.</p>",
      expect: "skip",
    },
    {
      description:
        "regression (false negative): the placeholder FIRST and a real connection string second still fires -- the old non-global html.match judged only the first match of each pattern",
      body:
        "<p>Set DATABASE_URL to postgresql://user:password@localhost:5432/mydb in your env file.</p>" +
        "<p>Live value: postgres://appuser:S3cr3tP4ss@db.internal:5432/prod is used in staging.</p>",
      expect: "fire",
      evidenceIncludes: "connection string",
    },
  ],
  "reflected-input": [
    {
      description:
        "a dangerous pattern shown in a syntax-highlighted documentation block does not fire",
      body: '<div class="syntax-highlight">jaVasCript:alert(1)</div>',
      expect: "skip",
    },
    {
      description:
        "regression (false negative): the documentation occurrence FIRST and a real reflected one second still fires -- the old code judged only match[0] and skipped the whole pattern",
      body:
        '<div class="syntax-highlight">jaVasCript:alert(1)</div>' +
        `<p>${"padding text here. ".repeat(20)}</p>` +
        '<a href="jaVasCript:alert(2)">click</a>',
      expect: "fire",
      evidenceIncludes: "dangerous content",
    },
  ],
  "oauth-state-missing": [
    {
      description:
        "regression: a privacy policy describing an OAuth integration in prose ('Discord OAuth (Optional)... whatever repos you authorize') does not fire -- no actual URL present",
      body: "<p><strong>Discord OAuth (Optional)</strong>: connects your account. GitHub OAuth lets you authorize repo access.</p>",
      expect: "skip",
    },
    {
      description:
        "a real authorization URL with client_id but no state parameter fires",
      body: '<a href="https://accounts.example.com/oauth2/authorize?client_id=abc123&redirect_uri=https://app.example.com/callback">Sign in</a>',
      expect: "fire",
      evidenceIncludes: "state parameter",
    },
    {
      description:
        "the same authorization URL WITH a state parameter does not fire",
      body: '<a href="https://accounts.example.com/oauth2/authorize?client_id=abc123&state=xyz789&redirect_uri=https://app.example.com/callback">Sign in</a>',
      expect: "skip",
    },
  ],
  "sql-error-in-page": [
    {
      description:
        "regression: a self-hosting guide mentioning PostgreSQL in one section and an unrelated 'Error: ECONNREFUSED' in a later troubleshooting section does not fire -- the two are far apart on the page, not part of the same error string",
      body: "<p>Configure PostgreSQL for the app.</p><p>Some unrelated paragraph text sits here to separate the two mentions on the page.</p><p>Error: ECONNREFUSED 127.0.0.1:5432</p>",
      expect: "skip",
    },
    {
      description: "a real raw Postgres error string fires",
      body: 'Query failed: PostgreSQL query error: ERROR:  relation "users" does not exist',
      expect: "fire",
      evidenceIncludes: "PostgreSQL",
    },
    {
      description:
        'regression: stripping an unrelated <pre> code example out from between two distant mentions must not collapse them adjacent to each other -- stripExampleContent deletes matched regions to "", which briefly re-broke this exact case on VulnRadar\'s own /docs/setup after the first fix above',
      body: "<p>Configure PostgreSQL for the app.</p><pre>DATABASE_URL=postgresql://user:pass@host/db</pre><p>Error: ECONNREFUSED 127.0.0.1:5432</p>",
      expect: "skip",
    },
  ],
  "postmessage-origin": [
    {
      description:
        "disabled as a strict duplicate of client-side.ts's postmessage-no-origin-check (same evidence, same high severity, better per-handler origin scoping) -- never fires, so one unvalidated listener is no longer scored twice",
      body: "<script>window.addEventListener('message', function(evt){ render(evt.data); });</script>",
      expect: "skip",
    },
  ],
  "open-form-action": [
    {
      description:
        "regression: an absolute action URL back to the page's own site (www. subdomain) is not a third-party submission and does not fire",
      url: "https://example.com/pricing",
      body: '<form method="post" action="https://www.example.com/subscribe"><input name="email"></form>',
      expect: "skip",
    },
    {
      description:
        "regression: a Mailchimp-hosted newsletter signup, whose published embed code requires the cross-origin action, does not fire",
      url: "https://example.com/",
      body: '<form method="post" action="https://example.us1.list-manage.com/subscribe/post?u=abc&id=def"><input name="EMAIL"></form>',
      expect: "skip",
    },
    {
      description:
        "a form posting to an unrelated third-party domain still fires",
      url: "https://example.com/",
      body: '<form method="post" action="https://collector.unknown-vendor.tld/harvest"><input name="email"></form>',
      expect: "fire",
      evidenceIncludes: "third-party domain",
    },
    {
      description:
        "a same-site action over plain HTTP still fires -- cleartext submission is a finding regardless of whose host it targets",
      url: "https://example.com/",
      body: '<form method="post" action="http://example.com/login"><input type="password" name="pw"></form>',
      expect: "fire",
      evidenceIncludes: "plain HTTP",
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
    {
      description:
        "regression (false negative): a benign attribution listener FIRST and a hijacking one second still fires -- the old single exec() judged only the first copy listener on the page",
      body:
        "<script>document.addEventListener('copy', function(e){ e.clipboardData.setData('text/plain', document.getSelection() + ' Read more at ' + location.href); });</script>" +
        `<p>${"spacer ".repeat(60)}</p>` +
        "<script>document.addEventListener('copy', function(e){ e.clipboardData.setData('text/plain', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'); });</script>",
      expect: "fire",
      evidenceIncludes: "clipboard-hijacking",
    },
  ],
  "source-code-comment": [
    {
      description:
        "regression: two unrelated HTML comments (React/Next.js SSR hydration markers) with a code example containing 'console.log' more than 300 chars away does not fire -- the old unbounded [\\s\\S]*? spanned from a content-free marker across real page content to the next one",
      body: `<!--$-->${"padding ".repeat(60)}console.log(result)${"padding ".repeat(60)}<!--/$-->`,
      expect: "skip",
    },
    {
      description: "a real leftover TODO inside one HTML comment fires",
      body: "<!-- TODO: remove this before shipping -->",
      expect: "fire",
      evidenceIncludes: "developer notes",
    },
    {
      description:
        "regression: React's own genuinely-empty '<!-- -->' text-node marker sitting a few dozen chars from real page content (a console.log code example) does not fire -- the marker's own content is just a space, nothing to bridge with; a char-count bound alone (an earlier version of this fix) was still too loose for how densely React emits these",
      body: "<!-- -->temporarily add <code>console.log</code> in your handler<!-- -->",
      expect: "skip",
    },
    {
      description:
        "a comment naming Hacker News does not fire -- HACK had no word boundary, so it matched inside hacker/hackathon/life-hack",
      body: "<!-- Hacker News share button -->",
      expect: "skip",
    },
    {
      description:
        "a comment labelling a to-do list does not fire -- TODO had no word boundary, so it matched inside 'todos'",
      body: "<!-- todos are rendered below -->",
      expect: "skip",
    },
    {
      description:
        "a rule of x characters does not fire -- XXX had no word boundary",
      body: "<!-- xxxxxxxxxxxxxxxx section break xxxxxxxxxxxxxxxx -->",
      expect: "skip",
    },
    {
      description: "a FIXME annotation still fires",
      body: "<!-- FIXME: the retry loop here is wrong -->",
      expect: "fire",
      evidenceIncludes: "developer notes",
    },
  ],

  "exposed-session-id": [
    {
      description:
        "an opaque 32-character PHPSESSID in a link's query string fires",
      body: '<a href="/dashboard?PHPSESSID=a3f9c2e18b7d40f6a5c1e9b2d7f04c83">Dashboard</a>',
      expect: "fire",
      evidenceIncludes: "session fixation",
    },
    {
      description:
        "an API docs snippet with a named placeholder does not fire -- the literal text '?session_id=' on a page is far more often documentation than a leak",
      body: "<pre><code>GET /v1/sessions?session_id=YOUR_SESSION_ID</code></pre>",
      expect: "skip",
    },
    {
      description:
        "?sid= carrying a small integer does not fire -- sid is used for store/section/slide ids all over the web and a real session token is never 2 digits",
      body: '<a href="/catalog?sid=42">Store 42</a>',
      expect: "skip",
    },
    {
      description:
        "a templated href with the id not yet substituted does not fire",
      body: '<a href="/view?session_id={{currentUserSessionIdentifier}}">View</a>',
      expect: "skip",
    },
  ],
  "sensitive-endpoints": [
    {
      description:
        "regression: a docs page whose subject matter IS the webhook endpoint (inside a <pre> code example) does not fire",
      body: "<pre>POST /api/v3/webhook</pre>",
      expect: "skip",
    },
    {
      description: "the same path referenced outside a code block still fires",
      body: "<p>Try hitting /api/v3/webhook directly.</p>",
      expect: "fire",
      evidenceIncludes: "webhook",
    },
  ],
  "debug-endpoint": [
    {
      description:
        "regression: a documented example URL shape inside a <pre> block does not fire",
      body: '<pre>"connectUrl": "wss://connect.browserbase.com/debug/..."</pre>',
      expect: "skip",
    },
    {
      description: "a real /debug/ reference outside a code block fires",
      body: "<p>Visit /debug/console for diagnostics.</p>",
      expect: "fire",
      evidenceIncludes: "Debug endpoints",
    },
  ],
  "email-enumeration": [
    {
      description:
        "regression: 'email' and an unrelated 'already exists' phrase over 60 chars apart does not fire",
      body:
        "<p>Enter your email below.</p>" +
        "<p>padding padding padding padding padding padding padding padding padding</p>" +
        "<p>Note: a Python SDK already exists for this API.</p>",
      expect: "skip",
    },
    {
      description: "a real enumeration-revealing error message fires",
      body: "<p>This email is already registered.</p>",
      expect: "fire",
      evidenceIncludes: "enumeration",
    },
  ],
  "dom-clobbering-vulnerable": [
    {
      description:
        'regression: a docs page heading anchor id="config" does not fire -- a compile-time-constant section anchor can\'t be attacker-clobbered, same noise-vs-signal tradeoff as the already-removed submit/action ids',
      body: '<h2 id="config">Configuration</h2>',
      expect: "skip",
    },
    {
      description:
        'id="form" still fires -- a real DOM-global collision target',
      body: '<div id="form"></div>',
      expect: "fire",
      evidenceIncludes: "clobber",
    },
  ],
  "hardcoded-ip-addresses": [
    {
      description:
        "regression: an RFC 5737 TEST-NET-3 documentation address (203.0.113.x) does not fire -- our own scan-form placeholder text uses 203.0.113.10 for exactly this reason",
      body: '<input placeholder="example.com or 203.0.113.10">',
      expect: "skip",
    },
    {
      description: "a real public IP address fires",
      body: "<p>Connect to 198.18.0.5 directly.</p>",
      expect: "fire",
      evidenceIncludes: "hardcoded public IP",
    },
  ],
  "admin-endpoint": [
    {
      description:
        "regression: evidence text no longer overclaims 'publicly accessible' -- this check only inspects the URL shape and can't verify auth was skipped",
      url: "https://example.com/admin",
      body: "",
      expect: "fire",
      evidenceIncludes: "verify this endpoint",
    },
  ],
  "weak-password-policy": [
    {
      description:
        "regression: minlength=\"12\" does not fire -- the old missing (?!\\d) matched just the leading '1', misreading a strong 12-char minimum as under 6",
      body: '<input type="password" minlength="12">',
      expect: "skip",
    },
    {
      description: "a real weak minlength (under 6) fires",
      body: '<input type="password" minlength="4">',
      expect: "fire",
      evidenceIncludes: "weak minlength",
    },
  ],
};

runDetectorTests(detectors, fixtures);

// checkSourceMapSourcesExposed is exported separately from `detectors`
// (see the comment above its definition in content.ts): it needs a real
// follow-up HTTP fetch, which the synchronous detector map's contract
// can't support, so it isn't covered by runDetectorTests above.
describe("checkSourceMapSourcesExposed", () => {
  // checkSourceMapSourcesExposed now reads the .map through the shared
  // bounded reader (lib/scanner/read-bounded-body.ts) rather than
  // res.text(), so a chunked .map can no longer be buffered without limit
  // and a trickling one can no longer hold the scan open. That means the
  // mocked Response has to expose a real body stream, not just text().
  function mapResponse(payload: unknown) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  }
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
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mapResponse({
        version: 3,
        sources: ["webpack:///src/app.js"],
        sourcesContent: ["export function secretLogic() { return 42; }"],
      }),
    );
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
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mapResponse({
        version: 3,
        sources: ["src/app.js"],
        mappings: "AAAA",
      }),
    );
    const body = "console.log(1);\n//# sourceMappingURL=app.js.map";
    const result = await checkSourceMapSourcesExposed(
      "https://example.com/static/app.js",
      new Headers(),
      body,
    );
    expect(result).toBeNull();
  });

  it("does not fire when sourcesContent is present but every entry is empty/null", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mapResponse({
        version: 3,
        sources: ["src/app.js"],
        sourcesContent: [null, ""],
      }),
    );
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
