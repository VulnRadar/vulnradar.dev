/**
 * Per-detector tests for the content category.
 *
 * Only "sensitive-meta-tags" has curated fixtures right now (added
 * alongside a real bug fix -- see lib/scanner/checks/content.ts). The rest
 * of this category's detectors still get smoke coverage only, same as
 * before this file existed.
 */

import { detectors } from "@/lib/scanner/checks/content";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  "sensitive-meta-tags": [
    {
      description: "meta tag whose name identifies it as a CSRF token",
      body: '<html><head><meta name="csrf-token" content="abc123"></head></html>',
      expect: "fire",
      evidenceIncludes: "sensitive data",
    },
    {
      description:
        "ordinary meta description mentioning 'secrets' as a scan category, not a leaked credential",
      body:
        '<html><head><meta name="description" content="650+ deterministic checks across headers, TLS, cookies, DNS, and secrets.">' +
        '<meta property="og:description" content="650+ deterministic checks across headers, TLS, cookies, DNS, and secrets.">' +
        "</head></html>",
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);
