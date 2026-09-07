import { describe, it, expect } from "vitest";
import { libraryChecks } from "@/lib/scanner/checks/page-checks/libraries";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";
import { runSyncChecks } from "@/lib/scanner/engine";
import { generateId } from "@/lib/scanner/_helpers";

const fixtures: PageCheckFixtures = {
  "page-outdated-vulnerable-library": [
    {
      // The sanitizer this product's own fix steps point people at, which
      // makes it the worst thing on the page to be outdated.
      description: "DOMPurify 2.3.6 has the mXSS bypasses",
      body: `<script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/2.3.6/purify.min.js"></script>`,
      expect: "fire",
      evidenceIncludes: "DOMPurify",
    },
    {
      description: "DOMPurify 3.2.6 is patched",
      body: `<script src="https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js"></script>`,
      expect: "skip",
    },
    {
      description: "Prism 1.25.0 has the line-highlight XSS",
      body: `<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.25.0/prism.min.js"></script>`,
      expect: "fire",
      evidenceIncludes: "Prism",
    },
    {
      // The moment pattern used to be a bare /moment/i, so it matched a
      // completely different library that has never had this CVE.
      description: "regression: momentum.js is not Moment.js",
      body: `<script src="/vendor/momentum-1.2.3.min.js"></script>`,
      expect: "skip",
    },
    {
      description: "jQuery 1.12.4 is below the fixed version",
      body: `<script src="https://code.jquery.com/jquery-1.12.4.min.js"></script>`,
      expect: "fire",
      evidenceIncludes: "CVE-2020-11022",
    },
    {
      description: "jQuery 3.6.0 is patched",
      body: `<script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>`,
      expect: "skip",
    },
    {
      description: "Lodash 4.17.15 is vulnerable",
      body: `<script src="/vendor/lodash-4.17.15.min.js"></script>`,
      expect: "fire",
      evidenceIncludes: "lodash",
    },
    {
      description: "unversioned script filename is not evaluated",
      body: `<script src="/vendor/jquery.js"></script>`,
      expect: "skip",
    },
  ],
  "page-angularjs-legacy-detected": [
    {
      description: "AngularJS 1.x script filename",
      body: `<script src="https://ajax.googleapis.com/ajax/libs/angularjs/1.7.9/angular.min.js"></script>`,
      expect: "fire",
    },
    {
      description: "modern Angular (2+) is not flagged",
      body: `<script src="https://cdn.example.com/angular/17.0.0/angular.js"></script>`,
      expect: "skip",
    },
    {
      description: "no angular script present",
      body: `<script src="/app.js"></script>`,
      expect: "skip",
    },
  ],
};

describe("page-checks/libraries", () => {
  runPageCheckTests(libraryChecks, fixtures);
});

describe("page-outdated-vulnerable-library: two vulnerable libraries on one page", () => {
  // Regression coverage for a duplicate-id bug: this check's `run()` can
  // return multiple CheckHits (one per vulnerable library found), but
  // generateId used to hash only the check id and the page URL, so every
  // hit from a single run collapsed onto the same finding id. Downstream,
  // that meant a React key collision, a false_positive mark on one library
  // silently suppressing feedback for the other, and a regression alert
  // dropping a still-present high-severity finding because it shared an id
  // with an unrelated, already-dismissed one. This scenario (two
  // co-occurring vulnerable libraries) was previously unexercised: every
  // existing fixture above fires at most one library per page.
  const url = "https://example.com/";
  const headers = new Headers({ "content-type": "text/html" });
  const body = `<html><body>
    <script src="https://code.jquery.com/jquery-1.9.0.min.js"></script>
    <script src="/vendor/lodash-4.17.15.min.js"></script>
  </body></html>`;

  function libraryFindings() {
    return runSyncChecks(url, headers, body).findings.filter((f) =>
      f.id.startsWith("page-outdated-vulnerable-library--"),
    );
  }

  it("produces one finding per vulnerable library", () => {
    const findings = libraryFindings();
    expect(findings).toHaveLength(2);
    const evidence = findings.map((f) => f.evidence);
    expect(evidence.some((e) => e.includes("jQuery"))).toBe(true);
    expect(evidence.some((e) => e.includes("Lodash"))).toBe(true);
  });

  it("gives the two findings different ids", () => {
    const ids = libraryFindings().map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps each finding's id stable across a repeated scan of the unchanged page", () => {
    const first = libraryFindings()
      .map((f) => f.id)
      .sort();
    const second = libraryFindings()
      .map((f) => f.id)
      .sort();
    expect(second).toEqual(first);
  });

  it("keeps a lone hit's id in the original <checkId>--<urlHash> shape, unchanged by this fix", () => {
    const singleLibraryBody = `<script src="https://code.jquery.com/jquery-1.9.0.min.js"></script>`;
    const findings = runSyncChecks(
      url,
      headers,
      singleLibraryBody,
    ).findings.filter((f) =>
      f.id.startsWith("page-outdated-vulnerable-library--"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe(
      generateId("page-outdated-vulnerable-library", url),
    );
  });
});
