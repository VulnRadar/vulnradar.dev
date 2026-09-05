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
    // The payload alternation was split into one pattern per shape to remove
    // the whitespace splice point, so both shapes need their own case: an
    // object literal (above) and a bare identifier (here). A body of
    // `jwt.sign(` and nothing else took 3.5 seconds through the old single
    // pattern at 2 KB.
    {
      description:
        "a bare identifier payload rather than an object literal still fires",
      body: '<html><body><script>const t = jwt.sign(payload, "hunter2");</script></body></html>',
      expect: "fire",
      evidenceIncludes: "HS256",
    },
    {
      description:
        "an env-var secret with explicit algorithm and expiry options does not fire",
      body: "<html><body><script>const t = jwt.sign({ sub: 1 }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });</script></body></html>",
      expect: "skip",
    },
    {
      description:
        "an unterminated jwt.sign( call with nothing after it does not fire",
      body: `<html><body><script>jwt.sign(${" ".repeat(4000)}</script></body></html>`,
      expect: "skip",
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

  // ── API description documents served in production ────────────────────

  "api-graphql-ide-exposed": [
    {
      description: "GraphiQL bundle loaded from the /graphql endpoint",
      url: "https://example.com/graphql",
      body: '<html><head><title>GraphiQL</title><script src="/static/graphiql.min.js"></script></head><body><div id="graphiql"></div></body></html>',
      expect: "fire",
      evidenceIncludes: "graphiql",
    },
    {
      description: "Apollo Server landing page plugin rendered in production",
      url: "https://api.example.com/graphql",
      body: '<html><body><div id="embeddable-sandbox"></div><script src="https://embeddable-sandbox.cdn.apollographql.com/_latest/embeddable-sandbox.umd.production.min.js"></script></body></html>',
      expect: "fire",
      evidenceIncludes: "sandbox",
    },
    {
      description:
        "marketing page that only mentions GraphQL Playground in prose",
      url: "https://example.com/blog/graphql-tooling",
      body: "<html><body><p>We used to ship GraphQL Playground with every service, and GraphiQL before that.</p></body></html>",
      expect: "skip",
    },
    {
      description: "ordinary GraphQL JSON response with no IDE",
      url: "https://example.com/graphql",
      body: '{"data":{"viewer":{"id":"1"}}}',
      expect: "skip",
    },
  ],

  "api-graphql-schema-sdl-exposed": [
    {
      description: "schema.graphql served as text/plain",
      url: "https://example.com/schema.graphql",
      headers: { "content-type": "text/plain" },
      body: "type Query {\n  user(id: ID!): User\n}\n\ntype Mutation {\n  createUser(input: CreateUserInput!): User\n}\n\ninput CreateUserInput {\n  email: String!\n}\n",
      expect: "fire",
      evidenceIncludes: "sdl",
    },
    {
      description:
        "HTML documentation page rendering the same schema as example text",
      url: "https://example.com/docs/schema",
      headers: { "content-type": "text/html" },
      body: "<html><body><pre>type Query {\n  user(id: ID!): User\n}\ntype Mutation {\n  createUser(input: CreateUserInput!): User\n}</pre></body></html>",
      expect: "skip",
    },
    {
      description: "plain-text file that mentions type Query in prose only",
      url: "https://example.com/notes.txt",
      headers: { "content-type": "text/plain" },
      body: "Remember to check the type Query fields before the release.",
      expect: "skip",
    },
  ],

  "api-openapi-no-security-declared": [
    {
      description: "OpenAPI 3 document with a POST and no security anywhere",
      url: "https://example.com/openapi.json",
      body: '{"openapi":"3.0.3","info":{"title":"Orders","version":"1"},"paths":{"/orders":{"post":{"responses":{"201":{"description":"created"}}}}}}',
      expect: "fire",
      evidenceIncludes: "no security schemes",
    },
    {
      description: "OpenAPI 3 document that declares a bearer scheme",
      url: "https://example.com/openapi.json",
      body: '{"openapi":"3.0.3","info":{"title":"Orders","version":"1"},"security":[{"bearerAuth":[]}],"components":{"securitySchemes":{"bearerAuth":{"type":"http","scheme":"bearer"}}},"paths":{"/orders":{"post":{"responses":{"201":{"description":"created"}}}}}}',
      expect: "skip",
    },
    {
      description: "read-only OpenAPI document with no write operations",
      url: "https://example.com/openapi.json",
      body: '{"openapi":"3.1.0","info":{"title":"Catalogue","version":"1"},"paths":{"/items":{"get":{"responses":{"200":{"description":"ok"}}}}}}',
      expect: "skip",
    },
  ],

  "api-openapi-server-url-plain-http": [
    {
      description: "OpenAPI 3 servers array with a public http base URL",
      url: "https://example.com/openapi.json",
      body: '{"openapi":"3.0.3","paths":{"/x":{}},"servers":[{"url":"http://api.example.com/v1","description":"Production"}]}',
      expect: "fire",
      evidenceIncludes: "cleartext",
    },
    {
      description: "Swagger 2.0 declaring only the http scheme",
      url: "https://example.com/swagger.json",
      body: '{"swagger":"2.0","host":"api.example.com","basePath":"/v1","schemes":["http"],"paths":{"/x":{}}}',
      expect: "fire",
      evidenceIncludes: "cleartext",
    },
    {
      description: "servers array over https only",
      url: "https://example.com/openapi.json",
      body: '{"openapi":"3.0.3","paths":{"/x":{}},"servers":[{"url":"https://api.example.com/v1"}]}',
      expect: "skip",
    },
    {
      description:
        "localhost http server URL, which is the internal-URL check's finding",
      url: "https://example.com/openapi.json",
      body: '{"openapi":"3.0.3","paths":{"/x":{}},"servers":[{"url":"http://localhost:3000"}]}',
      expect: "skip",
    },
  ],

  "api-openapi-swagger-2-document": [
    {
      description: "document declaring swagger 2.0",
      url: "https://example.com/swagger.json",
      body: '{"swagger":"2.0","info":{"title":"Legacy","version":"1"},"paths":{"/x":{"get":{}}}}',
      expect: "fire",
      evidenceIncludes: "2.0",
    },
    {
      description: "OpenAPI 3 document",
      url: "https://example.com/openapi.json",
      body: '{"openapi":"3.1.0","info":{"title":"Modern","version":"1"},"paths":{"/x":{"get":{}}}}',
      expect: "skip",
    },
  ],

  "api-openapi-deprecated-operations-exposed": [
    {
      description: "OpenAPI document with a deprecated operation",
      url: "https://example.com/openapi.json",
      body: '{"openapi":"3.0.3","paths":{"/v1/search":{"get":{"deprecated":true,"responses":{"200":{"description":"ok"}}}}}}',
      expect: "fire",
      evidenceIncludes: "deprecated",
    },
    {
      description: "OpenAPI document with nothing deprecated",
      url: "https://example.com/openapi.json",
      body: '{"openapi":"3.0.3","paths":{"/v2/query":{"post":{"responses":{"200":{"description":"ok"}}}}}}',
      expect: "skip",
    },
  ],

  "api-openapi-oauth2-implicit-flow-declared": [
    {
      description: "OpenAPI 3 securityScheme declaring an implicit flow",
      url: "https://example.com/openapi.json",
      body: '{"openapi":"3.0.3","paths":{"/x":{}},"components":{"securitySchemes":{"oauth2":{"type":"oauth2","flows":{"implicit":{"authorizationUrl":"https://auth.example.com/authorize","scopes":{}}}}}}}',
      expect: "fire",
      evidenceIncludes: "implicit",
    },
    {
      description: "OpenAPI 3 securityScheme using authorizationCode",
      url: "https://example.com/openapi.json",
      body: '{"openapi":"3.0.3","paths":{"/x":{}},"components":{"securitySchemes":{"oauth2":{"type":"oauth2","flows":{"authorizationCode":{"authorizationUrl":"https://auth.example.com/authorize","tokenUrl":"https://auth.example.com/token","scopes":{}}}}}}}',
      expect: "skip",
    },
  ],

  "api-asyncapi-document-exposed": [
    {
      description: "AsyncAPI 2.x JSON document with channels",
      url: "https://example.com/asyncapi.json",
      body: '{"asyncapi":"2.6.0","info":{"title":"Events","version":"1"},"servers":{"prod":{"url":"kafka.internal:9092","protocol":"kafka"}},"channels":{"user/signedup":{"subscribe":{}}}}',
      expect: "fire",
      evidenceIncludes: "asyncapi",
    },
    {
      description: "OpenAPI document, not AsyncAPI",
      url: "https://example.com/openapi.json",
      body: '{"openapi":"3.0.3","paths":{"/x":{"get":{}}}}',
      expect: "skip",
    },
  ],

  "api-postman-collection-exposed": [
    {
      description: "Postman collection export with a _postman_id",
      url: "https://example.com/api.postman_collection.json",
      body: '{"info":{"_postman_id":"a1b2c3d4-1111-2222-3333-444455556666","name":"Internal API","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"item":[]}',
      expect: "fire",
      evidenceIncludes: "postman",
    },
    {
      description: "blog post that merely mentions Postman",
      url: "https://example.com/blog/api-testing",
      body: "<html><body><p>We keep our request library in Postman rather than in the repo.</p></body></html>",
      expect: "skip",
    },
  ],

  "api-insomnia-export-exposed": [
    {
      description: "Insomnia export identified by __export_source",
      url: "https://example.com/insomnia.json",
      body: '{"_type":"export","__export_format":4,"__export_date":"2026-01-02T00:00:00.000Z","__export_source":"insomnia.desktop.app:v8.6.1","resources":[]}',
      expect: "fire",
      evidenceIncludes: "insomnia",
    },
    {
      description: "unrelated JSON that happens to contain the word insomnia",
      url: "https://example.com/api/articles",
      body: '{"articles":[{"title":"Sleep, insomnia and developer burnout"}]}',
      expect: "skip",
    },
  ],

  "api-wadl-document-exposed": [
    {
      description: "Jersey-generated application.wadl",
      url: "https://example.com/application.wadl",
      body: '<?xml version="1.0"?><application xmlns="http://wadl.dev.java.net/2009/02"><resources base="https://example.com/api/"><resource path="users"><method name="GET"/></resource></resources></application>',
      expect: "fire",
      evidenceIncludes: "wadl",
    },
    {
      description: "ordinary XML sitemap",
      url: "https://example.com/sitemap.xml",
      body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url></urlset>',
      expect: "skip",
    },
  ],

  "api-raml-document-exposed": [
    {
      description: "RAML 1.0 definition served as text",
      url: "https://example.com/api.raml",
      headers: { "content-type": "text/plain" },
      body: "#%RAML 1.0\ntitle: Orders API\nbaseUri: https://api.example.com/v1\n/orders:\n  get:\n",
      expect: "fire",
      evidenceIncludes: "raml",
    },
    {
      description: "documentation page that mentions RAML in prose",
      url: "https://example.com/docs",
      body: "<html><body><p>Our older services were described with RAML 1.0 before we moved to OpenAPI.</p></body></html>",
      expect: "skip",
    },
  ],

  "api-odata-metadata-document-exposed": [
    {
      description: "OData EDMX metadata document",
      url: "https://example.com/odata/$metadata",
      body: '<?xml version="1.0"?><edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><edmx:DataServices><Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Example"><EntityType Name="Customer"><Key><PropertyRef Name="Id"/></Key></EntityType></Schema></edmx:DataServices></edmx:Edmx>',
      expect: "fire",
      evidenceIncludes: "metadata",
    },
    {
      description: "a $metadata URL that returns an error page, not EDMX",
      url: "https://example.com/odata/$metadata",
      body: "<html><body><h1>404 Not Found</h1></body></html>",
      expect: "skip",
    },
  ],

  // ── OpenID Connect / OAuth 2.0 discovery ──────────────────────────────

  "api-oidc-discovery-alg-none-supported": [
    {
      description: 'discovery document listing "none" as a signing algorithm',
      url: "https://auth.example.com/.well-known/openid-configuration",
      body: '{"issuer":"https://auth.example.com","authorization_endpoint":"https://auth.example.com/authorize","token_endpoint":"https://auth.example.com/token","id_token_signing_alg_values_supported":["RS256","none"]}',
      expect: "fire",
      evidenceIncludes: "none",
    },
    {
      description: "discovery document listing only RS256",
      url: "https://auth.example.com/.well-known/openid-configuration",
      body: '{"issuer":"https://auth.example.com","authorization_endpoint":"https://auth.example.com/authorize","id_token_signing_alg_values_supported":["RS256","ES256"]}',
      expect: "skip",
    },
  ],

  "api-oidc-discovery-implicit-flow-supported": [
    {
      description: "discovery document advertising id_token token",
      url: "https://auth.example.com/.well-known/openid-configuration",
      body: '{"issuer":"https://auth.example.com","authorization_endpoint":"https://auth.example.com/authorize","response_types_supported":["code","id_token token"]}',
      expect: "fire",
      evidenceIncludes: "implicit",
    },
    {
      description: "discovery document advertising code only",
      url: "https://auth.example.com/.well-known/openid-configuration",
      body: '{"issuer":"https://auth.example.com","authorization_endpoint":"https://auth.example.com/authorize","response_types_supported":["code"]}',
      expect: "skip",
    },
  ],

  "api-oidc-discovery-pkce-not-advertised": [
    {
      description:
        "discovery document with the code response type and no PKCE methods",
      url: "https://auth.example.com/.well-known/openid-configuration",
      body: '{"issuer":"https://auth.example.com","authorization_endpoint":"https://auth.example.com/authorize","token_endpoint":"https://auth.example.com/token","response_types_supported":["code"]}',
      expect: "fire",
      evidenceIncludes: "code_challenge_methods_supported",
    },
    {
      description: "discovery document advertising S256",
      url: "https://auth.example.com/.well-known/openid-configuration",
      body: '{"issuer":"https://auth.example.com","authorization_endpoint":"https://auth.example.com/authorize","response_types_supported":["code"],"code_challenge_methods_supported":["S256"]}',
      expect: "skip",
    },
  ],

  // ── OAuth authorization requests ──────────────────────────────────────

  "api-oauth-authorize-redirect-uri-insecure": [
    {
      description: "authorize request with an http redirect_uri on a real host",
      url: "https://auth.example.com/authorize?response_type=code&client_id=web&redirect_uri=http%3A%2F%2Fapp.example.com%2Fcallback",
      expect: "fire",
      evidenceIncludes: "redirect_uri",
    },
    {
      description:
        "loopback http redirect_uri, explicitly permitted by RFC 8252 for native apps",
      url: "https://auth.example.com/authorize?response_type=code&client_id=native&redirect_uri=http%3A%2F%2F127.0.0.1%3A8080%2Fcb",
      expect: "skip",
    },
    {
      description: "https redirect_uri",
      url: "https://auth.example.com/authorize?response_type=code&client_id=web&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback",
      expect: "skip",
    },
  ],

  "api-oauth-authorize-oidc-nonce-missing": [
    {
      description: "hybrid flow asking for an id_token with no nonce",
      url: "https://auth.example.com/authorize?response_type=code%20id_token&client_id=web&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb",
      expect: "fire",
      evidenceIncludes: "nonce",
    },
    {
      description: "same request carrying a nonce",
      url: "https://auth.example.com/authorize?response_type=code%20id_token&client_id=web&nonce=8f3a1c&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb",
      expect: "skip",
    },
    {
      description: "plain authorization-code request, no id_token involved",
      url: "https://auth.example.com/authorize?response_type=code&client_id=web&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb",
      expect: "skip",
    },
  ],

  "api-jwt-long-lived-token": [
    {
      description: "JWT whose exp is a year after its iat",
      // {"alg":"HS256","typ":"JWT"} . {"sub":"1","iat":1700000000,"exp":1731536000}
      body: '<script>window.token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjE3MzE1MzYwMDB9.c2lnbmF0dXJl";</script>',
      expect: "fire",
      evidenceIncludes: "day lifetime",
    },
    {
      description: "JWT with a one-hour lifetime",
      // {"sub":"1","iat":1700000000,"exp":1700003600}
      body: '<script>window.token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjE3MDAwMDM2MDB9.c2lnbmF0dXJl";</script>',
      expect: "skip",
    },
  ],

  // ── Response-header correctness ───────────────────────────────────────

  "api-retry-after-invalid-value": [
    {
      description: 'Retry-After given a unit suffix ("60s")',
      headers: { "retry-after": "60s" },
      expect: "fire",
      evidenceIncludes: "retry-after",
    },
    {
      description: "Retry-After as an integer number of seconds",
      headers: { "retry-after": "120" },
      expect: "skip",
    },
    {
      description: "Retry-After as an IMF-fixdate",
      headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
      expect: "skip",
    },
  ],

  "api-sunset-header-in-past": [
    {
      description: "Sunset date well in the past",
      headers: { sunset: "Sat, 01 Jan 2022 00:00:00 GMT" },
      expect: "fire",
      evidenceIncludes: "sunset",
    },
    {
      description: "Sunset date in the future",
      headers: { sunset: "Fri, 01 Jan 2100 00:00:00 GMT" },
      expect: "skip",
    },
    {
      description: "no Sunset header at all",
      headers: { "content-type": "application/json" },
      expect: "skip",
    },
  ],

  "api-json-response-content-type-mismatch": [
    {
      description: "JSON body served as text/html",
      url: "https://example.com/api/me",
      headers: { "content-type": "text/html; charset=utf-8" },
      body: '{"id":1,"name":"<img src=x onerror=alert(1)>"}',
      expect: "fire",
      evidenceIncludes: "text/html",
    },
    {
      description: "JSON body served with the correct content type",
      url: "https://example.com/api/me",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: '{"id":1,"name":"ada"}',
      expect: "skip",
    },
    {
      description: "ordinary HTML page",
      url: "https://example.com/",
      headers: { "content-type": "text/html" },
      body: "<!DOCTYPE html><html><body><h1>Hello</h1></body></html>",
      expect: "skip",
    },
  ],

  "api-response-header-internal-host": [
    {
      description: "Location header pointing at an RFC1918 address",
      headers: { location: "http://10.0.3.14:8080/next" },
      expect: "fire",
      evidenceIncludes: "internal host",
    },
    {
      description: "Link pagination header pointing at a .internal hostname",
      headers: {
        link: '<https://orders.svc.internal/v1/items?page=2>; rel="next"',
      },
      expect: "fire",
      evidenceIncludes: "internal host",
    },
    {
      description: "Link pagination header on the public origin",
      headers: {
        link: '<https://api.example.com/v1/items?page=2>; rel="next"',
      },
      expect: "skip",
    },
  ],

  "api-www-authenticate-realm-internal-detail": [
    {
      description: "Basic realm naming a filesystem path",
      headers: { "www-authenticate": 'Basic realm="/var/www/internal-admin"' },
      expect: "fire",
      evidenceIncludes: "realm",
    },
    {
      description: "opaque realm",
      headers: { "www-authenticate": 'Basic realm="restricted"' },
      expect: "skip",
    },
  ],

  "api-problem-json-trace-exposed": [
    {
      description: "problem+json carrying a Java stack trace",
      url: "https://example.com/api/orders",
      headers: { "content-type": "application/problem+json" },
      body: '{"type":"about:blank","title":"Internal Server Error","status":500,"trace":"java.lang.NullPointerException\\n\\tat com.example.OrderService.load(/opt/app/OrderService.java:88:4)\\n\\tat com.example.Api.handle(/opt/app/Api.java:31:9)"}',
      expect: "fire",
      evidenceIncludes: "stack trace",
    },
    {
      description: "problem+json naming the internal exception class",
      url: "https://example.com/api/orders",
      headers: { "content-type": "application/problem+json" },
      body: '{"type":"about:blank","title":"Internal Server Error","status":500,"exception":"com.example.orders.OrderNotFoundException"}',
      expect: "fire",
      evidenceIncludes: "exception class",
    },
    {
      description: "well-formed problem document with no internals",
      url: "https://example.com/api/orders",
      headers: { "content-type": "application/problem+json" },
      body: '{"type":"https://api.example.com/errors/invalid-parameter","title":"Invalid parameter","status":400,"detail":"startDate must be before endDate","correlationId":"0f2c1b7e"}',
      expect: "skip",
    },
  ],

  "api-swagger-ui-outdated-version": [
    {
      description: "swagger-ui-dist pinned to 3.52.5",
      url: "https://example.com/docs",
      body: '<html><body><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@3.52.5/swagger-ui-bundle.js"></script></body></html>',
      expect: "fire",
      evidenceIncludes: "3.52.5",
    },
    {
      description: "current swagger-ui-dist release",
      url: "https://example.com/docs",
      body: '<html><body><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script></body></html>',
      expect: "skip",
    },
  ],

  "api-cors-allow-origin-multiple-values": [
    {
      description: "the whole allowlist concatenated into one header",
      headers: {
        "access-control-allow-origin":
          "https://app.example.com, https://admin.example.com",
      },
      expect: "fire",
      evidenceIncludes: "2 values",
    },
    {
      description: "a single echoed origin",
      headers: { "access-control-allow-origin": "https://app.example.com" },
      expect: "skip",
    },
    {
      description: "the wildcard token",
      headers: { "access-control-allow-origin": "*" },
      expect: "skip",
    },
  ],

  "api-cors-credentials-without-allow-origin": [
    {
      description: "credentials flag with no allowed origin",
      headers: { "access-control-allow-credentials": "true" },
      expect: "fire",
      evidenceIncludes: "credentials",
    },
    {
      description: "both halves set together",
      headers: {
        "access-control-allow-credentials": "true",
        "access-control-allow-origin": "https://app.example.com",
      },
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);
