/**
 * Per-detector tests for the secrets-extended category.
 *
 * Covers 73 detectors in lib/scanner/checks/secrets-extended.ts. Every
 * detector is exercised by the smoke harness (callable, no-throw,
 * deterministic). Most secret detectors look for vendor-specific key
 * patterns (Stripe, AWS, Google Maps, etc.) in source code; we rely on
 * the smoke harness for broad coverage and add positive fixtures only
 * for the most common patterns.
 */

import { detectors } from "@/lib/scanner/checks/secrets-extended";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  // credit-card-pattern and ssn-pattern detectors require specific patterns
  // (≥3 SSNs, specific card BIN prefixes) that are easier to verify by reading
  // the regex than by hand-crafting fixtures. Smoke-only.

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
