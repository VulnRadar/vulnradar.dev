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
  // ── GraphQL ──────────────────────────────────────────────────────────

  "graphql-endpoint-exposed": [
    {
      description: "GraphQL endpoint referenced",
      body: '<html><body>Visit <a href="/graphql">GraphQL API</a></body></html>',
      expect: "fire",
    },
  ],

  // ── CORS ─────────────────────────────────────────────────────────────

  "cors-wildcard": [
    {
      description: "Access-Control-Allow-Origin: *",
      headers: { "access-control-allow-origin": "*" },
      expect: "fire",
    },
  ],

  "cors-credentials-wildcard": [
    {
      description: "* with credentials",
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-credentials": "true",
      },
      expect: "fire",
    },
  ],

  "api-cors-credentials-with-wildcard-origin": [
    {
      description: "* with credentials (api-specific detector)",
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-credentials": "true",
      },
      expect: "fire",
    },
  ],

  "api-cors-null-origin-reflected": [
    {
      description: "ACAO: null (api-specific detector)",
      headers: { "access-control-allow-origin": "null" },
      expect: "fire",
    },
  ],

  "api-cors-origin-allow-all": [
    {
      description: "ACAO: * (api-specific detector)",
      headers: { "access-control-allow-origin": "*" },
      expect: "fire",
    },
  ],

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

  // ── Swagger ──────────────────────────────────────────────────────────

  "swagger-docs-exposed": [
    {
      description: "Swagger UI link",
      body: '<html><body><a href="/swagger-ui">API docs</a></body></html>',
      expect: "fire",
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

  "api-websocket-no-max-message-size": [
    {
      description: "WebSocket endpoint without max-message-size",
      url: "wss://api.example.com/socket",
      expect: "fire",
    },
  ],

  "api-websocket-no-idle-timeout": [
    {
      description: "WebSocket endpoint without idle-timeout",
      url: "wss://api.example.com/socket",
      expect: "fire",
    },
  ],

  // ── REST semantics ───────────────────────────────────────────────────

  "api-rest-pagination-headers-missing": [
    {
      description: "no pagination headers on list endpoint",
      url: "https://api.example.com/v1/users",
      expect: "fire",
    },
  ],

  "api-rest-etag-missing": [
    {
      description: "no ETag on GET endpoint",
      url: "https://api.example.com/v1/users/1",
      expect: "fire",
    },
  ],

  "api-rest-no-idempotency-key": [
    {
      description: "POST endpoint without idempotency key",
      url: "https://api.example.com/v1/charge",
      headers: { allow: "POST" },
      expect: "fire",
    },
  ],

  // ── Debug/admin endpoints ───────────────────────────────────────────

  "debug-endpoint": [
    {
      description: "/debug endpoint",
      body: '<html><body>Visit <a href="/debug/pprof">debug</a></body></html>',
      expect: "fire",
    },
  ],

  "admin-endpoint": [
    {
      description: "/admin endpoint",
      body: '<html><body>Visit <a href="/admin/login">admin</a></body></html>',
      expect: "fire",
    },
  ],
};

runDetectorTests(detectors, fixtures);
