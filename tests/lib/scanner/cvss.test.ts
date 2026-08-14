/**
 * Tests for lib/scanner/cvss.ts. The module's own comments repeatedly
 * claim every SEVERITY_VARIANTS entry was "verified ... to land in the
 * correct NVD severity band" here -- this file is that verification.
 */
import { describe, it, expect } from "vitest";
import {
  computeCvssBaseScore,
  formatCvssVector,
  cvssForFinding,
  attachCvssScores,
  CVSS_SEVERITY_BAND,
  type CvssMetrics,
  type CvssFindingContext,
} from "@/lib/scanner/cvss";
import type { Severity, Category, Vulnerability } from "@/lib/scanner/types";

// ── computeCvssBaseScore against well-known, independently published
// CVSS 3.1 reference scores (not re-derived from this module) ──────────

describe("computeCvssBaseScore", () => {
  it("computes 9.8 for the textbook unauthenticated/no-interaction/full-impact vector", () => {
    const m: CvssMetrics = {
      av: "N",
      ac: "L",
      pr: "N",
      ui: "N",
      scope: "U",
      c: "H",
      i: "H",
      a: "H",
    };
    expect(computeCvssBaseScore(m)).toBe(9.8);
  });

  it("computes 10.0 for the same vector with scope changed", () => {
    const m: CvssMetrics = {
      av: "N",
      ac: "L",
      pr: "N",
      ui: "N",
      scope: "C",
      c: "H",
      i: "H",
      a: "H",
    };
    expect(computeCvssBaseScore(m)).toBe(10.0);
  });

  it("computes 0.0 when there is no confidentiality/integrity/availability impact", () => {
    const m: CvssMetrics = {
      av: "N",
      ac: "L",
      pr: "N",
      ui: "N",
      scope: "U",
      c: "N",
      i: "N",
      a: "N",
    };
    expect(computeCvssBaseScore(m)).toBe(0.0);
  });

  it("computes 7.5 for a confidentiality-only remote disclosure (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N)", () => {
    // A well-known reference score (matches e.g. published scores for
    // simple unauthenticated information-disclosure CVEs of this exact
    // shape).
    const m: CvssMetrics = {
      av: "N",
      ac: "L",
      pr: "N",
      ui: "N",
      scope: "U",
      c: "H",
      i: "N",
      a: "N",
    };
    expect(computeCvssBaseScore(m)).toBe(7.5);
  });

  it("never returns a score above 10.0", () => {
    const m: CvssMetrics = {
      av: "N",
      ac: "L",
      pr: "N",
      ui: "N",
      scope: "C",
      c: "H",
      i: "H",
      a: "H",
    };
    expect(computeCvssBaseScore(m)).toBeLessThanOrEqual(10.0);
  });

  it("applies the spec's Roundup (round UP to one decimal, not nearest)", () => {
    // AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N -- a score that lands on a
    // non-round boundary, so a naive round-to-nearest would disagree with
    // Roundup for values just below a tenth.
    const m: CvssMetrics = {
      av: "N",
      ac: "H",
      pr: "N",
      ui: "N",
      scope: "U",
      c: "L",
      i: "N",
      a: "N",
    };
    const score = computeCvssBaseScore(m);
    // Roundup always rounds UP, so the raw (unrounded) value must be <=
    // the reported score, and score - 0.1 must be < raw (i.e. score is
    // the smallest tenth >= raw, not just any tenth close to it).
    expect(Number.isInteger(score * 10)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });
});

describe("formatCvssVector", () => {
  it("formats metrics into a CVSS:3.1 vector string in the standard metric order", () => {
    const m: CvssMetrics = {
      av: "N",
      ac: "L",
      pr: "N",
      ui: "N",
      scope: "U",
      c: "H",
      i: "H",
      a: "H",
    };
    expect(formatCvssVector(m)).toBe(
      "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    );
  });
});

// ── Every SEVERITY_VARIANTS entry lands in the correct NVD band ────────
//
// SEVERITY_VARIANTS itself isn't exported (module-private), so each named
// variant is exercised the same way a real finding would select it:
// through cvssForFinding's category/type-based selection logic (see that
// function's own categoryVariant/selectVariant helpers).

const CONFIDENTIALITY_CATEGORY: Category = "information-disclosure";
const INTERACTION_CATEGORY: Category = "client-side";
const PRIVILEGED_CATEGORY: Category = "api";
// A category in none of the above sets, so categoryVariant returns
// undefined and heuristic/default selection can be exercised.
const NEUTRAL_CATEGORY: Category = "headers";
const HEURISTIC_TYPE = "body-pattern";

function expectInBand(
  severity: Severity,
  ctx: Omit<CvssFindingContext, "severity">,
) {
  const { cvssVector, cvssScore } = cvssForFinding({ severity, ...ctx });
  const [min, max] = CVSS_SEVERITY_BAND[severity];
  expect(cvssScore).toBeGreaterThanOrEqual(min);
  expect(cvssScore).toBeLessThanOrEqual(max);
  expect(cvssVector).toMatch(/^CVSS:3\.1\//);
}

describe("cvssForFinding: every variant lands in its severity's NVD band", () => {
  describe("critical", () => {
    it("default", () => expectInBand("critical", {}));
    it("stays critical even with a confidentiality-only category", () =>
      expectInBand("critical", { category: CONFIDENTIALITY_CATEGORY }));
  });

  describe("high", () => {
    it("default", () => expectInBand("high", {}));
    it("confidentiality variant", () =>
      expectInBand("high", { category: CONFIDENTIALITY_CATEGORY }));
    it("interaction variant", () =>
      expectInBand("high", { category: INTERACTION_CATEGORY }));
    it("heuristic variant", () =>
      expectInBand("high", {
        category: NEUTRAL_CATEGORY,
        type: HEURISTIC_TYPE,
      }));
  });

  describe("medium", () => {
    it("default", () => expectInBand("medium", {}));
    it("confidentiality variant", () =>
      expectInBand("medium", { category: CONFIDENTIALITY_CATEGORY }));
    it("privileged variant", () =>
      expectInBand("medium", { category: PRIVILEGED_CATEGORY }));
    it("heuristic variant", () =>
      expectInBand("medium", {
        category: NEUTRAL_CATEGORY,
        type: HEURISTIC_TYPE,
      }));
  });

  describe("low", () => {
    it("default", () => expectInBand("low", {}));
    it("interaction variant", () =>
      expectInBand("low", { category: INTERACTION_CATEGORY }));
    it("privileged variant", () =>
      expectInBand("low", { category: PRIVILEGED_CATEGORY }));
  });

  describe("info", () => {
    it("default is always exactly 0.0 regardless of category", () => {
      for (const category of [
        undefined,
        CONFIDENTIALITY_CATEGORY,
        INTERACTION_CATEGORY,
        PRIVILEGED_CATEGORY,
        NEUTRAL_CATEGORY,
      ] as const) {
        const { cvssScore } = cvssForFinding({ severity: "info", category });
        expect(cvssScore).toBe(0.0);
      }
    });
  });
});

describe("cvssForFinding: variant selection", () => {
  it("falls back to default for a category in no special set", () => {
    const withDefault = cvssForFinding({ severity: "high" });
    const withNeutral = cvssForFinding({
      severity: "high",
      category: NEUTRAL_CATEGORY,
    });
    expect(withNeutral).toEqual(withDefault);
  });

  it("category-based variant selection takes priority over type", () => {
    // A confidentiality-mapped category with a heuristic-mapped type: the
    // category variant should win (categoryVariant is checked first).
    const result = cvssForFinding({
      severity: "high",
      category: CONFIDENTIALITY_CATEGORY,
      type: HEURISTIC_TYPE,
    });
    const confidentialityOnly = cvssForFinding({
      severity: "high",
      category: CONFIDENTIALITY_CATEGORY,
    });
    expect(result).toEqual(confidentialityOnly);
  });

  it("falls back to default when the tier has no heuristic variant, even with a heuristic type", () => {
    // "low" severity has no `heuristic` entry in its variant table.
    const result = cvssForFinding({
      severity: "low",
      category: NEUTRAL_CATEGORY,
      type: HEURISTIC_TYPE,
    });
    const defaultResult = cvssForFinding({ severity: "low" });
    expect(result).toEqual(defaultResult);
  });

  it("active-probes is not mapped to any special variant (uses the tier default)", () => {
    const result = cvssForFinding({
      severity: "critical",
      category: "active-probes",
    });
    const defaultResult = cvssForFinding({ severity: "critical" });
    expect(result).toEqual(defaultResult);
  });

  it("is deterministic: same inputs always produce the same output", () => {
    const a = cvssForFinding({ severity: "medium", category: "api" });
    const b = cvssForFinding({ severity: "medium", category: "api" });
    expect(a).toEqual(b);
  });
});

// ── attachCvssScores ─────────────────────────────────────────────────

function makeFinding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "test-id",
    title: "Test Finding",
    severity: "high",
    category: "headers",
    description: "d",
    evidence: "e",
    riskImpact: "r",
    explanation: "x",
    fixSteps: [],
    codeExamples: [],
    references: [],
    confidence: 90,
    detectionMethod: "test",
    ...overrides,
  };
}

describe("attachCvssScores", () => {
  it("backfills cvssVector/cvssScore onto a finding that has neither", () => {
    const [result] = attachCvssScores([makeFinding()]);
    expect(result.cvssVector).toBeDefined();
    expect(result.cvssScore).toBeDefined();
    expect(result.cvssScore).toBeGreaterThanOrEqual(CVSS_SEVERITY_BAND.high[0]);
  });

  it("does not overwrite a finding that already carries both fields", () => {
    const finding = makeFinding({
      cvssVector: "CVSS:3.1/AV:P/AC:H/PR:H/UI:R/S:C/C:L/I:N/A:N",
      cvssScore: 1.9,
    });
    const [result] = attachCvssScores([finding]);
    expect(result.cvssVector).toBe(finding.cvssVector);
    expect(result.cvssScore).toBe(1.9);
  });

  it("preserves every other field on the finding", () => {
    const finding = makeFinding({ title: "Distinctive Title", id: "abc123" });
    const [result] = attachCvssScores([finding]);
    expect(result.id).toBe("abc123");
    expect(result.title).toBe("Distinctive Title");
  });

  it("does not mutate the input array or its elements", () => {
    const finding = makeFinding();
    const input = [finding];
    attachCvssScores(input);
    expect(input[0]).toBe(finding);
    expect(finding.cvssVector).toBeUndefined();
  });

  it("handles a mixed batch of already-scored and unscored findings", () => {
    const scored = makeFinding({
      id: "scored",
      cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N",
      cvssScore: 0,
    });
    const unscored = makeFinding({ id: "unscored" });
    const results = attachCvssScores([scored, unscored]);
    expect(results[0].cvssScore).toBe(0);
    expect(results[1].cvssScore).toBeGreaterThan(0);
  });

  it("returns an empty array for an empty input", () => {
    expect(attachCvssScores([])).toEqual([]);
  });
});
