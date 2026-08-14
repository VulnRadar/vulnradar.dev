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
