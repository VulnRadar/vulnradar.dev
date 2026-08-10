/**
 * Per-detector tests for the API category.
 *
 * Covers 59 detectors in lib/scanner/checks/api.ts. Every detector is
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
      expect: "fire",
    },
    {
      description: "rate-limit headers present",
      url: "https://api.example.com/v1/users",
      headers: { "x-ratelimit-limit": "100" },
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
};

runDetectorTests(detectors, fixtures);
