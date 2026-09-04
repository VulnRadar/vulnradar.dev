/**
 * How the issue panel renders evidence excerpts, asserted over the source.
 *
 * The excerpt values are verbatim fragments of a scanned third party's page,
 * so the panel that shows them is the one place in this product where
 * rendering untrusted markup would be the exact bug class the scanner exists
 * to find. React escapes a text child, which is what makes this safe -- and
 * which is also why the safety is invisible in the source and easy to undo
 * later with a well-meant "render the highlighted version".
 *
 * This suite cannot render the component: the repo's tsconfig sets
 * `jsx: "preserve"` (Next compiles the JSX, not vitest), so vitest's esbuild
 * pass leaves JSX in the output and a .tsx import fails to parse. Nothing in
 * tests/ renders a component for that reason; the convention here is a pure
 * module plus assertions over the source, which is what this does. The
 * normalization itself is covered directly in
 * tests/lib/scanner/evidence-excerpts.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync("components/scanner/issue-detail.tsx", "utf8");

describe("issue-detail evidence excerpts", () => {
  it("renders the excerpts that every page check has always produced", () => {
    // ~42 call sites across the 11 page-check modules produced these, the
    // engine attached them, the API shipped them, and no component read the
    // field: grepping components/, app/ and lib/reports/ for it returned
    // nothing at all.
    expect(SOURCE).toContain("issue.evidenceExcerpts");
    expect(SOURCE).toContain("function EvidenceExcerpts");
  });

  it("routes values through the sanitizer instead of trusting the payload", () => {
    expect(SOURCE).toContain("toDisplayExcerpts");
  });

  it("never hands untrusted markup to the DOM as HTML", () => {
    // The whole panel, not just the excerpt block: this is the file that
    // renders a scanned site's own bytes.
    expect(SOURCE).not.toContain("dangerouslySetInnerHTML");
  });

  it("puts each value in its own horizontally scrolling preformatted block", () => {
    // A 400-character single line of minified JavaScript must scroll inside
    // its own container rather than widening the page, which the project's
    // layout rules require and which the page-level overflow-x: hidden would
    // otherwise silently clip.
    const block = SOURCE.slice(
      SOURCE.indexOf("function EvidenceExcerpts"),
      SOURCE.indexOf("function Evidence({"),
    );
    expect(block).toContain("<pre");
    expect(block).toContain("overflow-x-auto");
  });

  it("offers a way to see a value that was cut short", () => {
    const block = SOURCE.slice(
      SOURCE.indexOf("function EvidenceExcerpts"),
      SOURCE.indexOf("function Evidence({"),
    );
    expect(block).toContain("truncateExcerpt");
    expect(block).toContain("Show the full");
  });
});
