/**
 * Per-detector tests for the API category.
 *
 * Covers 40 detectors in lib/scanner/checks/api.ts. Every detector is
 * exercised by the smoke harness (callable, no-throw, deterministic).
 *
 * Most API detectors rely on very narrow patterns (specific GraphQL
 * shape, specific CORS configurations, etc.) that are easier to verify
 * by reading the detector source than by writing hand-crafted fixtures.
 * We rely on the smoke harness for broad coverage and only add fixtures
 * for the highest-signal detectors whose patterns we can verify at a
 * glance.
 */

import { detectors } from "@/lib/scanner/checks/api";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  // graphql-endpoint-exposed, swagger-docs-exposed, debug-endpoint, admin-endpoint
  // — moved to content.ts; tested in content.test.ts

  // ── CORS ─────────────────────────────────────────────────────────────
  // Removed: api-cors-credentials-with-wildcard-origin, api-cors-null-origin-reflected,
  // api-cors-origin-allow-all — duplicates of cors-credentials-wildcard,
  // cors-null-origin-allowed, cors-wildcard in headers.ts.

  // ── Rate limiting ────────────────────────────────────────────────────

  "rate-limiting": [
    {
      description: "API endpoint without rate-limit headers",
      url: "https://api.example.com/v1/users",
      headers: { "content-type": "application/json" },
      expect: "fire",
      evidenceIncludes: "rate-limiting",
    },
    {
      description: "rate-limit headers present",
      url: "https://api.example.com/v1/users",
      headers: { "x-ratelimit-limit": "100" },
      expect: "skip",
    },
    {
      description:
        "static HTML docs page whose URL merely contains /api/ (docs.stripe.com/api/authentication shape)",
      url: "https://docs.stripe.com/api/authentication",
      headers: { "content-type": "text/html; charset=utf-8" },
      expect: "skip",
    },
  ],

  // ── WebSocket ────────────────────────────────────────────────────────

  "api-websocket-no-origin-validation": [
    {
      description: "WebSocket endpoint with no origin check",
      url: "wss://api.example.com/socket",
      expect: "fire",
    },
  ],

  // ── GraphQL batch queries ────────────────────────────────────────────
  // Previously had no gate requiring the response to actually be
  // GraphQL-shaped, so it fired on any JSON array of objects that happened
  // to contain a "query"/"mutation" key anywhere in an ordinary HTML page's
  // hydration data (router state, search state, etc.) — a real false
  // positive seen against a Next.js-based production site with no GraphQL
  // present at all.

  "api-graphql-batch-queries": [
    {
      description: "real batch array on an actual /graphql endpoint response",
      url: "https://example.com/graphql",
      body: '[{"query":"{ a }"},{"query":"{ b }"}]',
      expect: "fire",
    },
    {
      description:
        "GraphQL error envelope elsewhere carries a batch-shaped array",
      url: "https://example.com/api/gateway",
      body: '{"errors":[{"message":"x"}]}[{"query":"{ a }"},{"query":"{ b }"}]',
      expect: "fire",
    },
    {
      description:
        "plain HTML page (not /graphql, no GraphQL error envelope) whose hydration JSON happens to contain an array of objects with unrelated 'query' keys",
      url: "https://example.com/",
      body: '<html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"routes":[{"query":{"page":1}},{"query":{"page":2}}]}}}</script></body></html>',
      expect: "skip",
    },
  ],

  // ── GraphQL introspection / suggestions / error envelope ─────────────
  // All three used to fire on any page: introspection on the bare text
  // `"__schema" {` that every GraphQL client library bundles, suggestions on
  // the ubiquitous search-UI phrase "did you mean", and the stack-trace check
  // on a bare "stacktrace" key from any API at all. Each is now gated on real
  // GraphQL context, and these fixtures pin both sides of that gate.

  "api-graphql-introspection-enabled": [
    {
      description: "__schema resolved by an actual /graphql endpoint",
      url: "https://example.com/graphql",
      body: '{"data":{"__schema":{"queryType":{"name":"Query"}}}}',
      expect: "fire",
      evidenceIncludes: "introspection",
    },
    {
      description:
        "ordinary page whose bundled GraphQL client ships the literal __schema fragment text",
      url: "https://example.com/",
      body: "<html><body><script>var q = 'query IntrospectionQuery { __schema { types { name } } }';</script></body></html>",
      expect: "skip",
    },
  ],

  "api-graphql-suggestions-enabled": [
    {
      description:
        "graphql-js suggestion inside a real JSON error response (quotes arrive backslash-escaped)",
      url: "https://example.com/graphql",
      body: '{"errors":[{"message":"Cannot query field \\"usr\\" on type \\"Query\\". Did you mean \\"user\\"?"}]}',
      expect: "fire",
      evidenceIncludes: "suggestion",
    },
    {
      description: "didYouMean key on a GraphQL error envelope",
      url: "https://api.example.com/gateway",
      body: '{"errors":[{"message":"Unknown field","extensions":{"didYouMean":["user"]}}]}',
      expect: "fire",
      evidenceIncludes: "suggestion",
    },
    {
      description:
        "e-commerce search page showing the ordinary 'did you mean' typo suggestion, no GraphQL anywhere",
      url: "https://shop.example.com/search?q=shose",
      body: '<html><body><p>Did you mean "shoes"?</p></body></html>',
      expect: "skip",
    },
  ],

  "api-graphql-error-stack-trace": [
    {
      description: "stacktrace inside a GraphQL error's extensions object",
      url: "https://example.com/graphql",
      body: '{"errors":[{"message":"boom","extensions":{"stacktrace":"Error: boom\\n    at resolve (/app/src/index.js:10:5)"}}]}',
      expect: "fire",
      evidenceIncludes: "stacktrace",
    },
    {
      description:
        "plain REST API leaking a stacktrace key with no GraphQL context (a different check's concern)",
      url: "https://api.example.com/api/orders",
      body: '{"error":"failed","stacktrace":"Error: boom at /app/index.js:1:1"}',
      expect: "skip",
    },
  ],

  // ── Rate-limit evidence honesty ──────────────────────────────────────
  // x-forwarded-for used to count as evidence that limits are keyed on
  // client IP; the two facts are unrelated, so only x-ratelimit-limit fires.

  "api-rate-limit-per-ip-no-auth": [
    {
      description: "API response advertises x-ratelimit-limit",
      url: "https://example.com/api/users",
      headers: { "x-ratelimit-limit": "100" },
      expect: "fire",
      evidenceIncludes: "verify",
    },
    {
      description:
        "API response carries x-forwarded-for but no rate-limit header at all",
      url: "https://example.com/api/users",
      headers: { "x-forwarded-for": "203.0.113.7" },
      expect: "skip",
    },
  ],

  "api-rest-mass-assignment-risk": [
    {
      description:
        "response exposes a privileged field; evidence must ask for verification, not assert a confirmed vulnerability",
      url: "https://example.com/api/me",
      body: '{"id":1,"email":"a@example.com","role":"admin"}',
      expect: "fire",
      evidenceIncludes: "verify",
      evidenceExcludes: "without filtering",
    },
  ],

  // ── Documentation/tutorial pages must not self-trigger ───────────────
  // Every detector in api.ts is wrapped in stripDocBlocks(), so example
  // payloads rendered as literal text inside <pre>/<code> are removed
  // before matching. A raw API/config response has no such tags, so the
  // primary detection path is unaffected.

  "soap-endpoint": [
    {
      description: "raw SOAP response body",
      body: '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body/></soap:Envelope>',
      expect: "fire",
      evidenceIncludes: "SOAP",
    },
    {
      description:
        "docs page rendering the same envelope as an example inside <pre>",
      url: "https://docs.example.com/guides/soap",
      body: '<html><body><h2>Example request</h2><pre><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body/></soap:Envelope></pre></body></html>',
      expect: "skip",
    },
  ],

  "api-jwt-hs256-weak-secret": [
    {
      description: "inline script signs a JWT with a short hardcoded secret",
      body: "<html><body><script>const t = jwt.sign({ sub: 1 }, 'secret123');</script></body></html>",
      expect: "fire",
      evidenceIncludes: "HS256",
    },
    {
      description:
        "tutorial page showing the same call as an example inside <code>",
      url: "https://blog.example.com/posts/jwt-mistakes",
      body: "<html><body><p>Never do this:</p><code>jwt.sign({ sub: 1 }, 'secret123')</code></body></html>",
      expect: "skip",
    },
  ],

  // ── A benign FIRST occurrence must not mask a real one ───────────────
  // These three detectors judged only the first regex hit and then rejected
  // the whole response on a context/plausibility guard, so an innocent
  // leading occurrence silently cleared a page that really was affected.
  // Each fixture puts the benign occurrence first and the real one second.

  "xml-rpc": [
    {
      description:
        "doc-context mention first, a real xmlrpc.php reference further down the same page",
      url: "https://example.com/",
      body:
        "<html><body><p>For example, older sites still ship xmlrpc.php.</p>" +
        "<p>".repeat(60) +
        "filler paragraph text with nothing notable in it</p>".repeat(4) +
        '<a href="/xmlrpc.php">endpoint</a></body></html>',
      expect: "fire",
      evidenceIncludes: "XML-RPC",
    },
    {
      description: "only a doc-context mention, no real reference",
      url: "https://blog.example.com/posts/wordpress-hardening",
      body: "<html><body><p>For example, xmlrpc.php should be disabled.</p></body></html>",
      expect: "skip",
    },
  ],

  "api-bearer-header-leak": [
    {
      description:
        "short non-credential token param first, a real JWT access_token second",
      url: "https://example.com/api/data?token=1&access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0",
      expect: "fire",
      evidenceIncludes: "Bearer token",
    },
    {
      description: "only a short non-credential token param",
      url: "https://example.com/api/data?token=1&page=2",
      expect: "skip",
    },
  ],

  // ── Modern auth/session + API hardening ─────────────────────────────────
  // Generated fixtures, decoded here for reference:
  //   JKU_TOKEN:    header {"alg":"RS256","typ":"JWT","jku":"https://attacker.example.com/keys.json"}, payload {"sub":"123"}
  //   NO_JKU_TOKEN: header {"alg":"RS256","typ":"JWT"}, payload {"sub":"123"}

  "api-jwt-jku-x5u-header-claim": [
    {
      description: "JWT in a JSON response declares a jku pointing off-host",
      body: '{"token":"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImprdSI6Imh0dHBzOi8vYXR0YWNrZXIuZXhhbXBsZS5jb20va2V5cy5qc29uIn0.eyJzdWIiOiIxMjMifQ.sig123abc"}',
      expect: "fire",
      evidenceIncludes: "jku",
    },
    {
      description: "JWT with no jku/x5u claim in its header",
      body: '{"token":"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.sig123abc"}',
      expect: "skip",
    },
    {
      description: "no JWT-shaped value present at all",
      body: "The jku header claim points to a JSON Web Key Set URL and must be validated.",
      expect: "skip",
    },
  ],

  "api-oauth-authorize-missing-pkce": [
    {
      description:
        "authorize request with response_type=code and client_id, no code_challenge",
      url: "https://idp.example.com/oauth2/v1/authorize?response_type=code&client_id=abc123&redirect_uri=https://app.example.com/cb&state=xyz",
      expect: "fire",
      evidenceIncludes: "code_challenge",
    },
    {
      description: "same request but with a code_challenge present (PKCE used)",
      url: "https://idp.example.com/oauth2/v1/authorize?response_type=code&client_id=abc123&redirect_uri=https://app.example.com/cb&state=xyz&code_challenge=abc&code_challenge_method=S256",
      expect: "skip",
    },
    {
      description:
        "response_type=code on a URL that isn't an authorize endpoint",
      url: "https://app.example.com/dashboard?response_type=code&client_id=abc123",
      expect: "skip",
    },
  ],

  "api-oauth-implicit-flow-response-type-token": [
    {
      description:
        "authorize request with response_type=token (implicit grant)",
      url: "https://idp.example.com/authorize?response_type=token&client_id=abc123&redirect_uri=https://app.example.com/cb",
      expect: "fire",
      evidenceIncludes: "implicit",
    },
    {
      description:
        "hybrid flow (code id_token) still uses a code, not pure implicit",
      url: "https://idp.example.com/authorize?response_type=code%20id_token&client_id=abc123",
      expect: "skip",
    },
    {
      description:
        "authorization code flow with PKCE, no token in response_type",
      url: "https://idp.example.com/authorize?response_type=code&client_id=abc123&code_challenge=abc&code_challenge_method=S256",
      expect: "skip",
    },
  ],

  "api-verbose-error-internal-path": [
    {
      description: "JSON error response includes a real Node.js stack trace",
      url: "https://api.example.com/api/users/1",
      headers: { "content-type": "application/json" },
      body: '{"error":"Internal Server Error","stack":"TypeError: Cannot read properties of undefined\\n    at Object.<anonymous> (/usr/src/app/routes/users.js:42:17)"}',
      expect: "fire",
      evidenceIncludes: "stack",
    },
    {
      description: "JSON error message leaks an internal filesystem path",
      url: "https://api.example.com/api/config",
      headers: { "content-type": "application/json" },
      body: '{"error":true,"message":"ENOENT: no such file or directory, open \'/usr/src/app/config/database.yml\'"}',
      expect: "fire",
      evidenceIncludes: "path",
    },
    {
      description: "generic JSON error with no stack or path",
      url: "https://api.example.com/api/users/999",
      headers: { "content-type": "application/json" },
      body: '{"error":"Not Found","message":"The requested resource does not exist."}',
      expect: "skip",
    },
    {
      description:
        "blog post prose (text/html, non-/api/ URL) describing the same vulnerability",
      url: "https://blog.example.com/posts/error-handling",
      headers: { "content-type": "text/html" },
      body: 'A vulnerable response looks like this: {"error": true, "message": "failed", "stack": "at Object.<anonymous> (/usr/src/app/index.js:1:1)"} which is bad practice.',
      expect: "skip",
    },
    {
      description:
        'empty "stack" placeholder appears first, the real stack trace is on a later element',
      url: "https://api.example.com/api/batch",
      headers: { "content-type": "application/json" },
      body: '{"results":[{"ok":true,"stack":""},{"ok":false,"stack":"TypeError: x\\n    at Object.<anonymous> (/usr/src/app/routes/users.js:42:17)"}]}',
      expect: "fire",
      evidenceIncludes: "stack",
    },
    {
      description:
        'benign "message" field first, the internal-path leak is in a nested error object',
      url: "https://api.example.com/api/config",
      headers: { "content-type": "application/json" },
      body: '{"message":"Request failed","error":{"message":"ENOENT: no such file or directory, open \'/usr/src/app/config/database.yml\'"}}',
      expect: "fire",
      evidenceIncludes: "path",
    },
  ],

  "api-deprecation-header-missing": [
    {
      description:
        "JSON body reports deprecated:true, no Deprecation/Sunset header",
      headers: { "content-type": "application/json" },
      body: '{"deprecated":true,"data":[]}',
      expect: "fire",
      evidenceIncludes: "deprecated",
    },
    {
      description: "same body but a Deprecation header is present",
      headers: { "content-type": "application/json", deprecation: "true" },
      body: '{"deprecated":true,"data":[]}',
      expect: "skip",
    },
    {
      description: "ordinary JSON API response, nothing about deprecation",
      headers: { "content-type": "application/json" },
      body: '{"data":[1,2,3]}',
      expect: "skip",
    },
    {
      description:
        "HTML docs page prose mentioning deprecation, not a JSON response",
      headers: { "content-type": "text/html" },
      body: "<p>This endpoint is deprecated and will be removed in v3.</p>",
      expect: "skip",
    },
  ],

  "api-graphql-introspection-mutation-heavy": [
    {
      description:
        "introspection resolves a Mutation type with 5 mutation fields",
      url: "https://example.com/graphql",
      body: '{"data":{"__schema":{"queryType":{"name":"Query"},"mutationType":{"name":"Mutation"},"types":[{"kind":"OBJECT","name":"Query","fields":[]},{"kind":"OBJECT","name":"Mutation","fields":[{"name":"createUser","description":null,"args":[{"name":"input","description":null,"type":{"kind":"NON_NULL","name":null,"ofType":{"kind":"INPUT_OBJECT","name":"createUserInput"}},"defaultValue":null}],"type":{"kind":"OBJECT","name":"User","ofType":null},"isDeprecated":false,"deprecationReason":null},{"name":"deleteUser","description":null,"args":[{"name":"input","description":null,"type":{"kind":"NON_NULL","name":null,"ofType":{"kind":"INPUT_OBJECT","name":"deleteUserInput"}},"defaultValue":null}],"type":{"kind":"OBJECT","name":"User","ofType":null},"isDeprecated":false,"deprecationReason":null},{"name":"updateUser","description":null,"args":[{"name":"input","description":null,"type":{"kind":"NON_NULL","name":null,"ofType":{"kind":"INPUT_OBJECT","name":"updateUserInput"}},"defaultValue":null}],"type":{"kind":"OBJECT","name":"User","ofType":null},"isDeprecated":false,"deprecationReason":null},{"name":"resetPassword","description":null,"args":[{"name":"input","description":null,"type":{"kind":"NON_NULL","name":null,"ofType":{"kind":"INPUT_OBJECT","name":"resetPasswordInput"}},"defaultValue":null}],"type":{"kind":"OBJECT","name":"Boolean","ofType":null},"isDeprecated":false,"deprecationReason":null},{"name":"grantAdminRole","description":null,"args":[{"name":"input","description":null,"type":{"kind":"NON_NULL","name":null,"ofType":{"kind":"INPUT_OBJECT","name":"grantAdminRoleInput"}},"defaultValue":null}],"type":{"kind":"OBJECT","name":"User","ofType":null},"isDeprecated":false,"deprecationReason":null}]}]}}}',
      expect: "fire",
      evidenceIncludes: "mutation",
    },
    {
      description:
        "introspection enabled but only 2 mutations (below threshold)",
      url: "https://example.com/graphql",
      body: '{"data":{"__schema":{"queryType":{"name":"Query"},"mutationType":{"name":"Mutation"},"types":[{"kind":"OBJECT","name":"Mutation","fields":[{"name":"login","description":null,"args":[{"name":"input","description":null,"type":{"kind":"NON_NULL","name":null,"ofType":{"kind":"INPUT_OBJECT","name":"loginInput"}},"defaultValue":null}],"type":{"kind":"OBJECT","name":"AuthPayload","ofType":null},"isDeprecated":false,"deprecationReason":null},{"name":"logout","description":null,"args":[{"name":"input","description":null,"type":{"kind":"NON_NULL","name":null,"ofType":{"kind":"INPUT_OBJECT","name":"logoutInput"}},"defaultValue":null}],"type":{"kind":"OBJECT","name":"Boolean","ofType":null},"isDeprecated":false,"deprecationReason":null}]}]}}}',
      expect: "skip",
    },
    {
      description: "no __schema present, ordinary GraphQL error response",
      url: "https://example.com/graphql",
      body: '{"errors":[{"message":"Cannot query field x"}]}',
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);
