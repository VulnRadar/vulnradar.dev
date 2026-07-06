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

import { detectors } from "./api";
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
};

runDetectorTests(detectors, fixtures);
