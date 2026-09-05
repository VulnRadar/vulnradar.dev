/**
 * What the finding panel and the findings list actually render, asserted over
 * the source.
 *
 * Same constraint as tests/components/scanner/evidence-excerpt-render.test.ts:
 * the repo's tsconfig sets `jsx: "preserve"`, so vitest cannot parse a .tsx
 * import and nothing in tests/ renders a component. The convention is a pure
 * module (lib/scanner/finding-display.ts, covered in
 * tests/lib/scanner/finding-display.test.ts) plus assertions that the
 * component reaches for it.
 *
 * Every field below had a producer, an export consumer and no on-screen
 * consumer at all, which is exactly the state a source assertion protects
 * against returning to.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ISSUE_DETAIL = readFileSync(
  "components/scanner/issue-detail.tsx",
  "utf8",
);
const RESULTS_LIST = readFileSync(
  "components/scanner/results-list.tsx",
  "utf8",
);
const SCANNING_INDICATOR = readFileSync(
  "components/scanner/scanning-indicator.tsx",
  "utf8",
);

/** The finding header's metadata row, which already carried confidence, KEV,
 *  EPSS and CVSS. */
const METADATA_ROW = ISSUE_DETAIL.slice(
  ISSUE_DETAIL.indexOf("{tone.label}"),
  ISSUE_DETAIL.indexOf("<h2 className="),
);

describe("issue detail: CWE and OWASP", () => {
  it("renders both, in the same metadata row as the other signals", () => {
    // 721 of the 852 check definitions carry these by hand and grepping this
    // file for either returned nothing at all.
    expect(METADATA_ROW).toContain("{cwe &&");
    expect(METADATA_ROW).toContain("{owasp &&");
    expect(ISSUE_DETAIL).toContain("cweRef(issue.cwe)");
    expect(ISSUE_DETAIL).toContain("owaspRef(issue.owasp)");
  });

  it("links each id to its canonical reference page", () => {
    expect(ISSUE_DETAIL).toContain("function TaxonomyChip");
    const chip = ISSUE_DETAIL.slice(
      ISSUE_DETAIL.indexOf("function TaxonomyChip"),
      ISSUE_DETAIL.indexOf("function safeHostname"),
    );
    expect(chip).toContain("taxonomy.url");
    expect(chip).toContain('rel="noopener noreferrer"');
    // A tag that did not parse into a real reference page prints as text
    // rather than pointing somewhere invented.
    expect(chip).toContain("if (!taxonomy.url)");
  });
});

describe("issue detail: corroboration", () => {
  it("renders alsoReportedBy when other checks agreed", () => {
    // dedupe.ts has written this since it shipped and its own header says it
    // exists "so the UI can show 'also detected by 2 other checks'". The only
    // references repo-wide were the producer, the type and that comment.
    expect(ISSUE_DETAIL).toContain("corroborationLabel(issue.alsoReportedBy)");
    expect(METADATA_ROW).toContain("{corroboration &&");
  });

  it("renders nothing at all when nothing was merged", () => {
    // The guard is the whole mechanism: corroborationLabel returns null for
    // an absent or empty list (proved in the finding-display suite), and the
    // `&&` means no separator and no empty row.
    expect(METADATA_ROW).toMatch(/\{corroboration && \(/);
  });
});

describe("issue detail: repo-scan location", () => {
  it("shows the file, and the line when there is one", () => {
    expect(ISSUE_DETAIL).toContain("findingLocationLabel(issue.location)");
    expect(ISSUE_DETAIL).toContain("{locationLabel && (");
  });

  it("prints the path as text, never as markup", () => {
    // The path comes from a third party's repository.
    expect(ISSUE_DETAIL).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("results list: repo-scan location", () => {
  it("shows the file on the row too, so a repo scan is legible before opening one", () => {
    // repo-detail.tsx renders through ResultsList and then IssueDetail, and
    // neither referenced `location`: a repo scan listed "Hardcoded API key"
    // repeatedly with nothing to tell the rows apart.
    expect(RESULTS_LIST).toContain("findingLocationLabel(issue.location)");
    expect(RESULTS_LIST).toContain("{locationLabel && (");
    expect(RESULTS_LIST).not.toContain("dangerouslySetInnerHTML");
  });

  it("keeps a long path inside its own row", () => {
    const chip = RESULTS_LIST.slice(
      RESULTS_LIST.indexOf("{locationLabel && ("),
      RESULTS_LIST.indexOf("{locationLabel && (") + 600,
    );
    expect(chip).toContain("truncate");
  });
});

describe("scanning indicator: findings so far", () => {
  it("renders the findings the status poll has been streaming all along", () => {
    expect(SCANNING_INDICATOR).toContain("partialFindings");
    expect(SCANNING_INDICATOR).toContain("Found so far");
  });

  it("bounds how many are named, so the card does not grow all scan", () => {
    expect(SCANNING_INDICATOR).toContain("PARTIAL_FINDINGS_SHOWN");
    expect(SCANNING_INDICATOR).toContain("slice(0, PARTIAL_FINDINGS_SHOWN)");
    expect(SCANNING_INDICATOR).toContain("and {unnamedCount} more");
  });

  it("does not announce each finding as it lands", () => {
    // The card already has one sr-only status region. A second live region
    // firing every couple of seconds would interrupt a screen reader for the
    // whole scan.
    const block = SCANNING_INDICATOR.slice(
      SCANNING_INDICATOR.indexOf("{foundSoFar.length > 0 && ("),
    );
    expect(block).toContain('aria-hidden="true"');
    expect(block).not.toContain("aria-live");
  });
});
