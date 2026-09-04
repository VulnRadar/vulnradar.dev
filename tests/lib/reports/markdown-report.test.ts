/**
 * Tests for lib/reports/markdown-report.ts.
 *
 * Two things this suite exists for beyond "it renders":
 *
 *  1. The verbatim excerpts every page check produces now reach the export.
 *     They are third-party response fragments, so they go inside a fence and
 *     nothing in them may break out of it.
 *  2. The owner's triage travels with the report. attachRemediation had been
 *     called on the export route for as long as the route existed and no
 *     generator read the result, so a finding closed as "accepted risk"
 *     exported looking identical to an untouched one.
 */
import { describe, it, expect } from "vitest";
import { generateMarkdownReport } from "@/lib/reports/markdown-report";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

function finding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "hsts-missing--a1",
    title: "Missing HSTS header",
    severity: "medium",
    category: "headers",
    description: "No Strict-Transport-Security header.",
    evidence: "Header absent on the main response.",
    riskImpact: "Downgrade attacks stay possible.",
    explanation: "x",
    fixSteps: ["Add the header"],
    codeExamples: [],
    ...overrides,
  };
}

function result(findings: Vulnerability[]): ScanResult {
  const summary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    total: findings.length,
  };
  for (const f of findings) summary[f.severity]++;
  return {
    url: "https://example.com",
    scannedAt: "2026-01-15T10:30:00.000Z",
    duration: 2450,
    findings,
    summary,
  };
}

describe("generateMarkdownReport", () => {
  it("tallies the findings it was given", () => {
    // The route now hands this generator exactly the findings it is exporting
    // and a summary derived from the same list, so this tally and the
    // response headline cannot drift apart.
    const md = generateMarkdownReport(
      result([
        finding({ id: "a--1", severity: "critical" }),
        finding({ id: "b--1", severity: "medium" }),
      ]),
    );
    expect(md).toContain(
      "Findings: 1 critical, 0 high, 1 medium, 0 low, 0 info",
    );
    expect(md).toContain("## Critical (1)");
    expect(md).toContain("## Medium (1)");
  });

  it("prints the verbatim excerpts inside a fence", () => {
    const md = generateMarkdownReport(
      result([
        finding({
          evidenceExcerpts: [
            { label: "Set-Cookie", value: "sid=abc; Path=/", line: 4 },
            { label: "script src", value: "https://cdn.example/a.js" },
          ],
        }),
      ]),
    );
    expect(md).toContain("Verbatim proof:");
    expect(md).toContain("Set-Cookie (line 4): sid=abc; Path=/");
    expect(md).toContain("script src: https://cdn.example/a.js");
  });

  it("cannot let an excerpt break out of its own fence", () => {
    // The value is a fragment of the scanned site's response. A triple
    // backtick inside it would close the block and hand the rest of the
    // export to a Markdown renderer as live content.
    const md = generateMarkdownReport(
      result([
        finding({
          evidenceExcerpts: [
            { label: "body", value: "``` <img src=x onerror=alert(1)>" },
          ],
        }),
      ]),
    );
    expect(md).not.toContain("``` <img");
    // Fences are only the opener and closer this generator wrote.
    expect(md.split("```")).toHaveLength(3);
  });

  it("drops an excerpt that normalizes to nothing rather than printing an empty block", () => {
    const md = generateMarkdownReport(
      result([finding({ evidenceExcerpts: [{ label: "x", value: "   " }] })]),
    );
    expect(md).not.toContain("Verbatim proof:");
  });

  it("reports the owner's remediation status, with assignee, due date and note", () => {
    const md = generateMarkdownReport(
      result([
        finding({
          remediation: {
            status: "accepted_risk",
            assignee: "sam",
            dueAt: "2026-09-30",
            note: "Legacy host, retiring in Q3",
          },
        }),
      ]),
    );
    expect(md).toContain(
      "Status: Accepted risk (assigned to sam, due 2026-09-30)",
    );
    expect(md).toContain("Triage note: Legacy host, retiring in Q3");
  });

  it("says nothing about status for an untriaged finding", () => {
    expect(generateMarkdownReport(result([finding()]))).not.toContain(
      "Status:",
    );
  });

  it("labels a finding the owner marked a false positive", () => {
    // Only reachable with ?includeSuppressed=true; when it is in the report
    // at all it must be visibly flagged, not listed as an open issue.
    const md = generateMarkdownReport(result([finding({ suppressed: true })]));
    expect(md).toContain("Status: Marked a false positive");
  });

  it("still escapes angle brackets in the prose fields", () => {
    const md = generateMarkdownReport(
      result([finding({ description: "<script>alert(1)</script>" })]),
    );
    expect(md).not.toContain("<script>");
    expect(md).toContain("&lt;script&gt;");
  });
});
