import { describe, it, expect } from "vitest";
import { libraryChecks } from "@/lib/scanner/checks/page-checks/libraries";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";
import { runSyncChecks } from "@/lib/scanner/engine";
import { generateId } from "@/lib/scanner/_helpers";

const fixtures: PageCheckFixtures = {
  "page-outdated-vulnerable-library": [
    {
      // name@version is how jsDelivr and unpkg pin a package, and eight of the
      // version patterns rejected "@".
      description: "regression: jQuery pinned the jsDelivr way (jquery@1.12.4)",
      body: `<script src="https://cdn.jsdelivr.net/npm/jquery@1.12.4/dist/jquery.min.js"></script>`,
      expect: "fire",
    },
    {
      description: "regression: lodash pinned the unpkg way",
      body: `<script src="https://unpkg.com/lodash@4.17.10/lodash.min.js"></script>`,
      expect: "fire",
    },
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
    {
      // The table used to hold one "fixed in" per library, 4.3.1 here, so the
      // 3.x release that fixed CVE-2019-8331 was reported for it.
      description:
        "regression: Bootstrap 3.4.1 fixed CVE-2019-8331 on the 3.x line",
      body: `<script src="https://cdn.jsdelivr.net/npm/bootstrap@3.4.1/dist/js/bootstrap.min.js"></script>`,
      expect: "skip",
    },
    {
      description: "Bootstrap 3.3.7 is affected on the 3.x line",
      body: `<script src="https://cdn.jsdelivr.net/npm/bootstrap@3.3.7/dist/js/bootstrap.min.js"></script>`,
      expect: "fire",
      evidenceIncludes: "3.4.1 or later",
    },
    {
      description: "regression: Underscore 1.12.1 fixed CVE-2021-23358",
      body: `<script src="https://cdn.jsdelivr.net/npm/underscore@1.12.1/underscore-min.js"></script>`,
      expect: "skip",
    },
    {
      // The table said "fixed in 6.7.1" for an advisory fixed in 6.7.3.
      description:
        "regression: TinyMCE 6.7.1 is still affected by CVE-2023-48219",
      body: `<script src="https://cdn.jsdelivr.net/npm/tinymce@6.7.1/tinymce.min.js"></script>`,
      expect: "fire",
      evidenceIncludes: "CVE-2023-48219",
    },
    {
      description:
        "the Handlebars template RCE is critical, not a uniform high",
      body: `<script src="https://cdn.jsdelivr.net/npm/handlebars@4.7.6/dist/handlebars.min.js"></script>`,
      expect: "fire",
      evidenceIncludes: "CVSS 9.8",
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

describe("page-outdated-vulnerable-library: what a finding says", () => {
  const url = "https://example.com";
  const headers = new Headers();
  const find = (body: string) =>
    runSyncChecks(url, headers, body).findings.filter((f) =>
      f.id.startsWith("page-outdated-vulnerable-library--"),
    );

  it("names only the advisories that affect this version", () => {
    // 2.29.2 fixed CVE-2022-24785 and is still inside CVE-2022-31129's range.
    const [finding] = find(
      `<script src="https://cdn.jsdelivr.net/npm/moment@2.29.2/moment.min.js"></script>`,
    );
    expect(finding.evidence).toContain("CVE-2022-31129");
    expect(finding.evidence).not.toContain("CVE-2022-24785");
    expect(finding.evidence).toContain("2.29.4 or later fixes it.");
  });

  it("takes its severity from the worst advisory's CVSS score", () => {
    const jquery = find(
      `<script src="https://code.jquery.com/jquery-1.12.4.min.js"></script>`,
    );
    expect(jquery[0].severity).toBe("medium");
    const handlebars = find(
      `<script src="https://cdn.jsdelivr.net/npm/handlebars@4.7.6/dist/handlebars.min.js"></script>`,
    );
    expect(handlebars[0].severity).toBe("critical");
  });

  it("names the library version as the finding's component", () => {
    const [finding] = find(
      `<script src="https://code.jquery.com/jquery-1.12.4.min.js"></script>`,
    );
    expect(finding.component).toBe("jquery@1.12.4");
  });

  it("keeps two outdated libraries on one page as two findings through dedupe", () => {
    const findings = find(
      `<script src="https://code.jquery.com/jquery-1.12.4.min.js"></script>
       <script src="/vendor/lodash-4.17.15.min.js"></script>`,
    );
    expect(findings.map((f) => f.component).sort()).toEqual([
      "jquery@1.12.4",
      "lodash@4.17.15",
    ]);
  });
});
