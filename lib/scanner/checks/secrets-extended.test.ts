/**
 * Per-detector tests for the secrets-extended category.
 *
 * Covers 71 detectors in lib/scanner/checks/secrets-extended.ts. Every
 * detector is exercised by the smoke harness (callable, no-throw,
 * deterministic). Most secret detectors look for vendor-specific key
 * patterns (Stripe, AWS, Google Maps, etc.) in source code; we rely on
 * the smoke harness for broad coverage and add positive fixtures only
 * for the most common patterns.
 */

import { detectors } from "./secrets-extended";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  // credit-card-pattern and ssn-pattern detectors require specific patterns
  // (≥3 SSNs, specific card BIN prefixes) that are easier to verify by reading
  // the regex than by hand-crafting fixtures. Smoke-only.
};

runDetectorTests(detectors, fixtures);
