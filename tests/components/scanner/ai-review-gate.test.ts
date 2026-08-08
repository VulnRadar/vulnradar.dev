import { describe, it, expect } from "vitest";
import {
  hasUnreviewedFindings,
  canOfferAiReview,
} from "@/components/scanner/ai-review-gate";
import type { Vulnerability } from "@/lib/scanner/types";

function finding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: overrides.id ?? "f1",
    title: "Missing CSP",
    severity: "medium",
    category: "headers",
    description: "",
    evidence: "",
    riskImpact: "",
    explanation: "",
    fixSteps: [],
    codeExamples: [],
    ...overrides,
  };
}

describe("hasUnreviewedFindings", () => {
  it("is false for an empty list", () => {
    expect(hasUnreviewedFindings([])).toBe(false);
  });

  it("is true when every finding lacks an aiVerdict", () => {
    expect(hasUnreviewedFindings([finding(), finding({ id: "f2" })])).toBe(
      true,
    );
  });

  it("is true when at least one finding still lacks an aiVerdict", () => {
    const findings = [
      finding({ id: "f1", aiVerdict: "confirmed" }),
      finding({ id: "f2" }),
    ];
    expect(hasUnreviewedFindings(findings)).toBe(true);
  });

  it("is false once every finding carries an aiVerdict", () => {
    const findings = [
      finding({ id: "f1", aiVerdict: "confirmed" }),
      finding({ id: "f2", aiVerdict: "possible_fp" }),
      finding({ id: "f3", aiVerdict: "uncertain" }),
    ];
    expect(hasUnreviewedFindings(findings)).toBe(false);
  });
});

describe("canOfferAiReview", () => {
  const unreviewed = [finding()];
  const reviewed = [finding({ aiVerdict: "confirmed" })];

  it("is false when the scan has not been saved to history", () => {
    expect(
      canOfferAiReview({ scanId: null, aiAvailable: true, findings: unreviewed }),
    ).toBe(false);
    expect(
      canOfferAiReview({
        scanId: undefined,
        aiAvailable: true,
        findings: unreviewed,
      }),
    ).toBe(false);
  });

  it("is false when AI is not available (unconfigured or disabled for the account)", () => {
    expect(
      canOfferAiReview({ scanId: 10, aiAvailable: false, findings: unreviewed }),
    ).toBe(false);
  });

  it("is false when every finding is already reviewed", () => {
    expect(
      canOfferAiReview({ scanId: 10, aiAvailable: true, findings: reviewed }),
    ).toBe(false);
  });

  it("is false for a scan with zero findings", () => {
    expect(
      canOfferAiReview({ scanId: 10, aiAvailable: true, findings: [] }),
    ).toBe(false);
  });

  it("is true only when saved, available, and at least one finding is unreviewed", () => {
    expect(
      canOfferAiReview({ scanId: 10, aiAvailable: true, findings: unreviewed }),
    ).toBe(true);
  });
});
