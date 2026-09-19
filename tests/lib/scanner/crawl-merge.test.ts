import { describe, it, expect } from "vitest";
import { mergeFindingsAcrossPages, checkIdOf } from "@/lib/scanner/crawl-merge";
import type { Vulnerability } from "@/lib/scanner/types";

/**
 * A crawl of a Moodle site came back with 3,177 findings where a single-page
 * scan of the same site reported under a hundred. Every finding was repeated
 * once per crawled page, because a finding's id folds in the page URL and the
 * crawl merged by id alone. These tests pin the merge that replaced it.
 */
function finding(
  checkId: string,
  page: string,
  evidence: string,
  severity: Vulnerability["severity"] = "medium",
): Vulnerability {
  return {
    id: `${checkId}--${Buffer.from(page).toString("base64url").slice(0, 6)}`,
    title: checkId,
    severity,
    category: "headers",
    description: "",
    evidence,
    riskImpact: "",
    explanation: "",
    fixSteps: [],
    codeExamples: [],
  } as Vulnerability;
}

const PAGES = Array.from(
  { length: 30 },
  (_unused, i) => `https://moodle.example.test/mod/forum/discuss.php?d=${i}`,
);

describe("mergeFindingsAcrossPages", () => {
  it("reports a problem found on every page once, and lists the pages", () => {
    const merged = mergeFindingsAcrossPages(
      PAGES.map((url) => ({
        url,
        findings: [
          finding(
            "csp-missing",
            url,
            "Header 'Content-Security-Policy' is not present in the response.",
            "high",
          ),
          finding(
            "hsts-missing",
            url,
            "Header 'Strict-Transport-Security' is not present in the response.",
            "high",
          ),
        ],
      })),
    );

    expect(merged).toHaveLength(2);
    for (const f of merged) {
      expect(f.affectedPages).toHaveLength(30);
    }
  });

  it("collapses evidence that only differs by the page's own address", () => {
    const merged = mergeFindingsAcrossPages(
      PAGES.slice(0, 5).map((url) => ({
        url,
        findings: [
          finding("mixed-content", url, `${url} loads http://cdn.example/a.js`),
        ],
      })),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].affectedPages).toHaveLength(5);
  });

  it("keeps genuinely different findings from the same check apart", () => {
    const merged = mergeFindingsAcrossPages([
      {
        url: PAGES[0],
        findings: [finding("inline-secret", PAGES[0], "token sk_live_AAA")],
      },
      {
        url: PAGES[1],
        findings: [finding("inline-secret", PAGES[1], "token sk_live_BBB")],
      },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.every((f) => f.affectedPages === undefined)).toBe(true);
  });

  it("keeps the first id, so the main URL's triage survives a rescan", () => {
    const main = "https://moodle.example.test/";
    const first = finding("csp-missing", main, "missing");
    const merged = mergeFindingsAcrossPages([
      { url: main, findings: [first] },
      {
        url: PAGES[0],
        findings: [finding("csp-missing", PAGES[0], "missing")],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(first.id);
  });

  it("shows the most severe instance when pages disagree on severity", () => {
    const merged = mergeFindingsAcrossPages([
      { url: PAGES[0], findings: [finding("x", PAGES[0], "same", "low")] },
      { url: PAGES[1], findings: [finding("x", PAGES[1], "same", "high")] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].severity).toBe("high");
  });

  it("leaves a finding seen on a single page without a page list", () => {
    const merged = mergeFindingsAcrossPages([
      { url: PAGES[0], findings: [finding("only-here", PAGES[0], "x")] },
    ]);
    expect(merged[0].affectedPages).toBeUndefined();
  });

  it("reads the check id off a finding id", () => {
    expect(checkIdOf("csp-missing--a1b2c3")).toBe("csp-missing");
    expect(checkIdOf("async-spf-record-uses-soft-fail-all---mjf6oe")).toBe(
      "async-spf-record-uses-soft-fail-all",
    );
    expect(checkIdOf("no-suffix")).toBe("no-suffix");
  });
});
