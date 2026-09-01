/**
 * Per-detector tests for the secrets-extended category.
 *
 * Covers 74 detectors in lib/scanner/checks/secrets-extended.ts. Every
 * detector is exercised by the smoke harness (callable, no-throw,
 * deterministic). Most secret detectors look for vendor-specific key
 * patterns (Stripe, AWS, Google Maps, etc.) in source code; we rely on
 * the smoke harness for broad coverage and add positive fixtures only
 * for the most common patterns.
 */

import { describe, it, expect } from "vitest";
import { detectors } from "@/lib/scanner/checks/secrets-extended";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  // ssn-pattern requires ≥3 SSN-shaped values, easier to verify by reading
  // the regex than by hand-crafting a fixture. Smoke-only.

  "credit-card-pattern": [
    {
      description:
        "a real card-network-prefixed but Luhn-invalid 16-digit number (order ID, tracking param, etc. that happens to look card-shaped) does not fire",
      body: "order-ref: 4532015112830367",
      expect: "skip",
    },
    {
      description:
        "Stripe's published test card (docs.stripe.com/testing) does not fire even though it's Luhn-valid, since it's a documented test number, not a live leak",
      body: "Use test card 4242 4242 4242 4242 to simulate a successful payment.",
      expect: "skip",
    },
    {
      description:
        "a Luhn-valid card-shaped number that is NOT in the known-test-card list fires",
      body: "leaked: 4532015112830366",
      expect: "fire",
    },
  ],

  "secret-cloudflare-r2-access-key": [
    {
      description:
        "R2 secretAccessKey assignment near an r2.cloudflarestorage.com endpoint",
      body: 'const endpoint = "https://abc123.r2.cloudflarestorage.com"; const secretAccessKey = "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e";',
      expect: "fire",
      evidenceIncludes: "r2.cloudflarestorage.com",
    },
    {
      description: "bare r2.cloudflarestorage.com endpoint with no key nearby",
      body: "Connect to https://abc123.r2.cloudflarestorage.com using the AWS SDK v3 S3Client.",
      expect: "skip",
    },
    {
      description:
        "secretAccessKey-shaped value with no R2 endpoint anywhere in the page",
      body: 'const secretAccessKey = "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e";',
      expect: "skip",
    },
  ],

  "secret-sentry-dsn-public": [
    {
      description: "Sentry DSN with a real 32-hex public key and ingest host",
      body: 'Sentry.init({dsn: "https://abcd1234abcd1234abcd1234abcd1234@o123456.ingest.sentry.io/6543210"})',
      expect: "fire",
      evidenceIncludes: "sentry dsn",
    },
    {
      description: "regional ingest host variant (ingest.us.sentry.io)",
      body: "dsn=https://1111222233334444555566667777888a@o987654.ingest.us.sentry.io/1234567",
      expect: "fire",
    },
    {
      description: "non-hex placeholder DSN from a tutorial",
      body: "Set your dsn to https://examplePublicKey@o0.ingest.sentry.io/0 in your config.",
      expect: "skip",
    },
  ],

  "secret-posthog-project-api-key": [
    {
      description: "phc_ project key passed to posthog.init",
      body: 'posthog.init("phc_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V", {api_host: "https://us.i.posthog.com"})',
      expect: "fire",
      evidenceIncludes: "posthog",
    },
    {
      description: "placeholder phc_ key (your_)",
      body: 'posthog.init("phc_your_project_api_key_goes_here_padding")',
      expect: "skip",
    },
  ],

  "secret-perplexity-api-key": [
    {
      description: "pplx- key in an Authorization header",
      body: "Authorization: Bearer pplx-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expect: "fire",
      evidenceIncludes: "perplexity",
    },
    {
      description: "placeholder pplx- key (xxxx)",
      body: "Authorization: Bearer pplx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      expect: "skip",
    },
  ],

  "secret-resend-api-key": [
    {
      description: "re_ key next to the RESEND_API_KEY env var name",
      body: "RESEND_API_KEY=re_NOT_A_REAL_SECRET_JUST_A_FIXTURE_VALUE",
      expect: "fire",
      evidenceIncludes: "resend",
    },
    {
      description: "placeholder re_ key (your_)",
      body: "RESEND_API_KEY=re_your_resend_api_key_padding_x",
      expect: "skip",
    },
    {
      description: "re_-shaped token with no resend context anywhere nearby",
      body: "session_token=re_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f",
      expect: "skip",
    },
  ],

  "s3-bucket-exposed": [
    {
      description:
        "public S3 URL used to host a logo/image asset (normal, deliberate CDN usage) does not fire",
      body: '<img src="https://mybucket.s3.amazonaws.com/logo.png">',
      expect: "skip",
    },
    {
      description: "S3 URL with no path at all does not fire",
      body: "Assets are served from https://assets.s3.amazonaws.com",
      expect: "skip",
    },
    {
      description:
        "S3 URL whose object path suggests a backup/credentials dump fires",
      body: '<a href="https://mybucket.s3.amazonaws.com/backups/db-dump.sql">backup</a>',
      expect: "fire",
      evidenceIncludes: "sensitive path",
    },
  ],

  "firebase-config-exposed": [
    {
      description:
        "standard Firebase SDK init boilerplate with the API key sourced from an env var (no literal key in the response) does not fire",
      body: 'const firebaseConfig = { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: "myapp.firebaseapp.com", projectId: "myapp" }; firebase.initializeApp(firebaseConfig);',
      expect: "skip",
    },
    {
      description:
        "firebase.initializeApp call with an inline literal API key fires",
      body: 'firebase.initializeApp({ apiKey: "AIzaFk9mQ2wZpL7xR4tN8bC1eH6jV3sD0gA5uK2", authDomain: "myapp.firebaseapp.com" });',
      expect: "fire",
      evidenceIncludes: "firebase configuration",
    },
  ],

  "secret-generic-high-entropy-value": [
    {
      description:
        "a high-entropy value assigned to a secret-shaped variable name, no known vendor format",
      body: 'const token = "aZ3kQ9mVxT7wLp2RcN8eH1bY6uJ4gD0sK5f";',
      expect: "fire",
      evidenceIncludes: "high-entropy",
    },
    {
      description:
        "a value that already matches a known vendor format (Stripe secret key) is left to the dedicated check, not double-reported here",
      body: 'const secret = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";',
      expect: "skip",
    },
    {
      description:
        "a placeholder value is masked by maskPlaceholderSecrets before this detector runs",
      body: 'const apiKey = "your_api_key_goes_here_1234567890";',
      expect: "skip",
    },
    {
      description:
        "a low-entropy, digit-repeating value assigned to a secret-shaped name does not fire",
      body: 'const authKey = "12121212121212121212";',
      expect: "skip",
    },
  ],

  "secret-linear-api-key": [
    {
      description: "lin_api_ key assigned to LINEAR_API_KEY",
      body: "LINEAR_API_KEY=lin_api_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V2",
      expect: "fire",
      evidenceIncludes: "linear",
    },
    {
      description: "placeholder lin_api_ key (your_)",
      body: "LINEAR_API_KEY=lin_api_your_key_here_padding_needed_xx",
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);

// AUDIT-002#scanner-02: email-exposure's address regex backtracked
// catastrophically. "." and "-" are in its local-part class, so on a long run
// of them it matched the whole run from every starting offset before failing
// to find an "@". Measured on the old pattern: 0.5s at 16k characters and
// 10.3s at 64k, against a body capped at a megabyte, with no way to interrupt
// it (every scan timeout in this codebase is a setTimeout, which cannot fire
// while the event loop is blocked).
describe("email-exposure address matching", () => {
  const detect = detectors["email-exposure"];
  const headers = new Headers();

  it("stays linear on a long run of local-part characters", () => {
    // 200k characters of "a." pairs: no "@" anywhere, so every offset is a
    // failed start. The old pattern did not finish this in any usable time.
    const body = "a.".repeat(100_000);
    const started = performance.now();
    const result = detect("https://example.com/", headers, body);
    const elapsed = performance.now() - started;

    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(1000);
  });

  it("still finds a real address, including one after a long run", () => {
    const body =
      "a.".repeat(50_000) + " contact ops@mail-server.acme-corp.co.uk";
    expect(detect("https://example.com/", headers, body)).toContain(
      "ops@mail-server.acme-corp.co.uk",
    );
  });

  it("does not treat a malformed domain as an address", () => {
    // A label has to start and end alphanumeric, so neither of these is one.
    expect(
      detect("https://example.com/", headers, "reach me at x@-broken.com"),
    ).toBeNull();
    expect(
      detect("https://example.com/", headers, "reach me at x@a..com"),
    ).toBeNull();
  });
});
