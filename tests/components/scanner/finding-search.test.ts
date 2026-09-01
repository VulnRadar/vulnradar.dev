import { describe, it, expect } from "vitest";
import {
  findingMatchesQuery,
  categoryLabel,
} from "@/components/scanner/finding-search";
import type { Vulnerability } from "@/lib/scanner/types";

function finding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "missing-csp-header",
    title: "Content Security Policy is not set",
    severity: "medium",
    category: "headers",
    description: "No CSP header was returned for this page.",
    evidence: "",
    riskImpact: "",
    explanation: "",
    fixSteps: [],
    codeExamples: [],
    ...overrides,
  } as Vulnerability;
}

describe("findingMatchesQuery", () => {
  it("matches on the title", () => {
    expect(findingMatchesQuery(finding(), "content security")).toBe(true);
  });

  it("matches on the description", () => {
    expect(findingMatchesQuery(finding(), "was returned")).toBe(true);
  });

  // The regression this predicate exists for: the check id is what every
  // export carries and what /checks/{id} is addressed by, and it used not to
  // be searchable at all, so pasting one returned zero results.
  it("matches on the exact check id", () => {
    expect(findingMatchesQuery(finding(), "missing-csp-header")).toBe(true);
  });

  it("matches on part of the check id", () => {
    expect(findingMatchesQuery(finding(), "csp-header")).toBe(true);
  });

  it("matches the check id case-insensitively", () => {
    expect(findingMatchesQuery(finding(), "MISSING-CSP-HEADER")).toBe(true);
  });

  it("matches on the raw category key", () => {
    expect(findingMatchesQuery(finding({ category: "ssl" }), "ssl")).toBe(true);
  });

  it("matches on the human category label", () => {
    // CATEGORY_META.headers.label is "Headers"; the raw key happens to match
    // here too, so use a finding whose title and description say nothing
    // about the family to prove the label is what carried the match.
    const f = finding({
      title: "Weak cipher suite offered",
      description: "The server accepts an outdated cipher.",
      id: "weak-cipher",
      category: "headers",
    });
    expect(findingMatchesQuery(f, "Headers")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(findingMatchesQuery(finding(), "sql injection")).toBe(false);
  });

  it("treats an empty or whitespace query as matching everything", () => {
    expect(findingMatchesQuery(finding(), "")).toBe(true);
    expect(findingMatchesQuery(finding(), "   ")).toBe(true);
  });

  it("ignores surrounding whitespace on a real query", () => {
    expect(findingMatchesQuery(finding(), "  missing-csp-header  ")).toBe(true);
  });
});

describe("categoryLabel", () => {
  it("resolves a known category to its label", () => {
    expect(categoryLabel("headers")).toBe("Headers");
  });

  it("falls back to the de-hyphenated key for an unknown category", () => {
    expect(categoryLabel("some-new-family")).toBe("some new family");
  });
});
