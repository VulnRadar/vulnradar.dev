import { describe } from "vitest";
import { frameworkFingerprintChecks } from "@/lib/scanner/checks/page-checks/framework-fingerprint";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";

const fixtures: PageCheckFixtures = {
  "page-cms-version-disclosed": [
    {
      description: "WordPress generator meta tag with version",
      body: `<meta name="generator" content="WordPress 5.4.2">`,
      expect: "fire",
      evidenceIncludes: "wordpress",
    },
    {
      description: "Drupal generator meta tag with version",
      body: `<meta name="generator" content="Drupal 7 (https://www.drupal.org)">`,
      expect: "fire",
      evidenceIncludes: "drupal",
    },
    {
      description: "Joomla generator meta tag with version",
      body: `<meta name="generator" content="Joomla! 3.9 - Open Source Content Management">`,
      expect: "fire",
      evidenceIncludes: "joomla",
    },
    {
      description: "Drupal disclosed via X-Generator header",
      headers: { "x-generator": "Drupal 7 (https://www.drupal.org)" },
      expect: "fire",
    },
    {
      description: "generator tag with no recognized CMS/version",
      body: `<meta name="generator" content="Hugo 0.111.0">`,
      expect: "skip",
    },
    {
      description: "no generator tag at all",
      body: `<html><body>Hello</body></html>`,
      expect: "skip",
    },
  ],
  "page-cms-core-severely-outdated": [
    {
      description: "WordPress well below the 6.0 threshold",
      body: `<meta name="generator" content="WordPress 4.9.1">`,
      expect: "fire",
      evidenceIncludes: "wordpress",
    },
    {
      description: "Drupal 7 is past its documented end of life",
      body: `<meta name="generator" content="Drupal 7 (https://www.drupal.org)">`,
      expect: "fire",
      evidenceIncludes: "end-of-life",
    },
    {
      description: "Joomla 3.x is past its documented end of life",
      body: `<meta name="generator" content="Joomla! 3.9 - Open Source Content Management">`,
      expect: "fire",
      evidenceIncludes: "end of life",
    },
    {
      description: "WordPress at/above the threshold is not flagged",
      body: `<meta name="generator" content="WordPress 6.4.3">`,
      expect: "skip",
    },
    {
      description: "Drupal 9 is not flagged",
      body: `<meta name="generator" content="Drupal 9 (https://www.drupal.org)">`,
      expect: "skip",
    },
    {
      description: "no generator tag at all",
      body: `<html><body>Hello</body></html>`,
      expect: "skip",
    },
  ],
};

describe("page-checks/framework-fingerprint", () => {
  runPageCheckTests(frameworkFingerprintChecks, fixtures);
});
