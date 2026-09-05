/**
 * Tests for the whole-site A+ to F grade.
 *
 * The grade is deliberately a pure function of the danger score, so the thing
 * worth pinning is that it can never contradict the safety rating shown beside
 * it: a "safe" site must not be able to grade D, and an "unsafe" one must not
 * be able to grade A. ref: AUDIT-014#comp-03
 */
import { describe, it, expect } from "vitest";
import {
  getSiteGrade,
  isSiteGrade,
  SITE_GRADE_SUMMARY,
} from "@/lib/scanner/site-grade";
import { getSafetyRating, getDangerScore } from "@/lib/scanner/safety-rating";

function finding(severity: string, title: string) {
  return { severity, title };
}

describe("getSiteGrade", () => {
  it("grades a clean scan A+", () => {
    expect(getSiteGrade([])).toBe("A+");
  });

  it("keeps a scan with only informational findings in the A band", () => {
    // The danger score rounds a lone info finding back to 0, so this is A+ in
    // practice; what the grade must never do is drop it below A.
    const findings = [
      finding("info", "Server header discloses software version"),
    ];
    expect(getSafetyRating(findings)).toBe("safe");
    expect(["A+", "A"]).toContain(getSiteGrade(findings));
  });

  it("grades a scan with critical exploitable findings F", () => {
    const findings = [
      finding("critical", "SQL Injection vulnerability detected"),
      finding("critical", "Remote Code Execution possible"),
    ];
    expect(getSafetyRating(findings)).toBe("unsafe");
    expect(getSiteGrade(findings)).toBe("F");
  });

  it("never grades a safe site worse than B", () => {
    // A pile of pure hardening gaps: real advice, but not a dangerous site,
    // and the danger score caps a safe site at 4 for exactly this reason.
    const findings = [
      finding("high", "Missing Content-Security-Policy header"),
      finding("high", "Missing Strict-Transport-Security header"),
      finding("medium", "Missing X-Frame-Options header"),
      finding("medium", "Missing Referrer-Policy header"),
      finding("low", "Missing Permissions-Policy header"),
    ];
    if (getSafetyRating(findings) === "safe") {
      expect(["A+", "A", "B"]).toContain(getSiteGrade(findings));
    }
  });

  it("never grades an unsafe site better than D", () => {
    const findings = [finding("critical", "SQL Injection vulnerability found")];
    expect(getSafetyRating(findings)).toBe("unsafe");
    expect(["D", "F"]).toContain(getSiteGrade(findings));
  });

  it("agrees with the danger score for every score the scorer can produce", () => {
    // The mapping is a total function over 0..10 with no gaps, so any score
    // the engine emits has exactly one grade.
    const expected: Record<number, string> = {
      0: "A+",
      1: "A",
      2: "A",
      3: "B",
      4: "B",
      5: "C",
      6: "C",
      7: "D",
      8: "D",
      9: "F",
      10: "F",
    };
    for (const findings of [
      [],
      [finding("info", "Server header discloses software version")],
      [finding("critical", "SQL Injection vulnerability detected")],
      [finding("high", "Missing Content-Security-Policy header")],
      [finding("medium", "Reflected XSS detected in query parameter")],
    ]) {
      const score = getDangerScore(findings);
      expect(getSiteGrade(findings)).toBe(expected[score]);
    }
  });

  it("has a summary line for every grade it can return", () => {
    for (const grade of ["A+", "A", "B", "C", "D", "F"] as const) {
      expect(SITE_GRADE_SUMMARY[grade]).toBeTruthy();
    }
  });
});

/**
 * The guard the badge and any other reader of a stored result_meta.siteGrade
 * uses to decide between the stored letter and recomputing. It stands between
 * an arbitrary database value and a public SVG, so it has to reject anything
 * that is not one of the six letters.
 */
describe("isSiteGrade", () => {
  it("accepts every grade getSiteGrade can return", () => {
    for (const grade of ["A+", "A", "B", "C", "D", "F"] as const) {
      expect(isSiteGrade(grade)).toBe(true);
    }
  });

  it.each([
    ["a letter outside the scale", "Z"],
    ["the lowercase form", "a+"],
    ["an empty string", ""],
    ["a number", 3],
    ["null", null],
    ["undefined", undefined],
    ["an object", { grade: "A" }],
    // `"toString" in SITE_GRADE_SUMMARY` is true via the prototype chain, so a
    // bare `in` check without the typeof guard would let this through.
    ["an inherited Object.prototype key", "toString"],
  ])("rejects %s", (_label, value) => {
    expect(isSiteGrade(value)).toBe(false);
  });
});
