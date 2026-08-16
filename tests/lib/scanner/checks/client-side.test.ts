/**
 * Per-detector tests for the client-side category.
 *
 * Covers 26 detectors in lib/scanner/checks/client-side.ts. Every
 * detector is exercised by the smoke harness (callable, no-throw,
 * deterministic); the detectors below also get explicit fixtures
 * covering known false-positive classes (vendor-documented example
 * credentials, SSR hydration state carrying domain-restricted client
 * keys) alongside their true-positive counterparts.
 */

import { detectors } from "@/lib/scanner/checks/client-side";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  "api-key-hardcoded-in-js": [
    {
      description:
        "Stripe's own published docs example secret key (sk_test_4eC39HqLyjWDarjtT1zdp7dc), copied verbatim into a tutorial, does not fire",
      body: 'const stripeApiKey = "sk_test_4eC39HqLyjWDarjtT1zdp7dc"; // copied verbatim from Stripe\'s own docs example',
      expect: "skip",
    },
    {
      description:
        "a real-shaped (non-denylisted) Stripe live secret key assigned to a camelCase identifier fires",
      body: 'const stripeSecret = "sk_live_51H8x9zLkjasdlkjalksdjalksjdlkj";',
      expect: "fire",
      evidenceIncludes: "compromised",
    },
    {
      description: "an OpenAI-shaped sk- key assigned to apiKey fires",
      body: 'apiKey: "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890"',
      expect: "fire",
      evidenceIncludes: "hardcoded in client-side",
    },
  ],

  "debug-info-in-page-js": [
    {
      description:
        "Firebase Web SDK config (apiKey included) serialized into window.__INITIAL_STATE__ SSR hydration state does not fire -- apiKey is vendor-documented as safe to expose client-side",
      body: 'window.__INITIAL_STATE__ = {"firebase":{"apiKey":"AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX","authDomain":"myapp.firebaseapp.com","projectId":"myapp"}};',
      expect: "skip",
    },
    {
      description:
        "window.__APP_CONFIG__ carrying only a reCAPTCHA siteKey and a Stripe publishable key does not fire",
      body: 'window.__APP_CONFIG__ = {"siteKey":"6LdXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX","publicKey":"pk_live_abc123"};',
      expect: "skip",
    },
    {
      description: "window.__CONFIG__ carrying an actual password field fires",
      body: 'window.__CONFIG__ = {"dbPassword":"hunter2","apiUrl":"https://x.com"};',
      expect: "fire",
      evidenceIncludes: "sensitive configuration data",
    },
    {
      description: "window.__ENV__ carrying an actual auth token fires",
      body: 'window.__ENV__ = {"authToken":"eyJhbGciOiJIUzI1NiJ9.secretpayload"};',
      expect: "fire",
      evidenceIncludes: "sensitive configuration data",
    },
    {
      description:
        "a raw DATABASE_URL key in serialized page JSON still fires (unrelated pattern, unaffected by the hydration-state fix)",
      body: '"DATABASE_URL": "postgres://user:pass@host/db"',
      expect: "fire",
      evidenceIncludes: "sensitive configuration data",
    },
  ],

  "prototype-pollution-client": [
    {
      description:
        "explicitly nulling __proto__ is a defensive hardening idiom, not a pollution sink -- does not fire",
      body: 'function safeMerge(target, key, value) { if (key === "__proto__") return; target["__proto__"] = null; }',
      expect: "skip",
    },
    {
      description:
        "guarding with Object.create(null) right after the assignment does not fire",
      body: 'obj["__proto__"] = Object.create(null);',
      expect: "skip",
    },
    {
      description:
        "assigning an actual (non-null) value into __proto__ is a real pollution sink and fires",
      body: 'target["__proto__"] = source;',
      expect: "fire",
      evidenceIncludes: "prototype pollution",
    },
  ],
};

runDetectorTests(detectors, fixtures);
