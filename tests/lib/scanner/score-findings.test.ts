/**
 * scoreFindings is the one place a scan's summary, count, danger score,
 * grade, safety rating and engine confidence come from, for the scan executor
 * and the recompute after a verdict alike.
 */
import { describe, it, expect } from "vitest";
import {
  resultMetaIsIncomplete,
  scoreFindings,
  scoreMeta,
} from "@/lib/scanner/score-findings";
import {
  getDangerScore,
  getEngineConfidence,
} from "@/lib/scanner/safety-rating";
import { getSiteGrade } from "@/lib/scanner/site-grade";
import type { Vulnerability } from "@/lib/scanner/types";

function vuln(id: string, severity: Vulnerability["severity"]): Vulnerability {
  return {
    id,
    title: `Finding ${id}`,
    severity,
    category: "headers",
    description: "d",
    evidence: "e",
    riskImpact: "r",
    explanation: "x",
    fixSteps: [],
    codeExamples: [],
    confidence: 80,
  };
}

const X = vuln("xss--x", "critical");
const Y = vuln("hsts--y", "low");

describe("scoreFindings", () => {
  it("counts everything when nothing is suppressed", () => {
    const score = scoreFindings([X, Y], new Set());
    expect(score.activeFindings).toEqual([X, Y]);
    expect(score.findingsCount).toBe(2);
    expect(score.summary).toMatchObject({ critical: 1, low: 1, total: 2 });
    expect(score.dangerScore).toBe(getDangerScore([X, Y]));
    expect(score.siteGrade).toBe(getSiteGrade([X, Y]));
  });

  it("leaves a suppressed finding out of every figure", () => {
    const score = scoreFindings([X, Y], new Set([X.id]));
    expect(score.activeFindings).toEqual([Y]);
    expect(score.findingsCount).toBe(1);
    expect(score.summary).toMatchObject({ critical: 0, low: 1, total: 1 });
    expect(score.dangerScore).toBe(getDangerScore([Y]));
    expect(score.siteGrade).toBe(getSiteGrade([Y]));
    expect(score.safetyRating).toBe("safe");
    expect(score.engineConfidence).toBe(getEngineConfidence([Y]));
  });

  it("lowers the engine confidence for an incomplete scan, as it always did", () => {
    expect(scoreFindings([Y], new Set(), { incomplete: true })).toMatchObject({
      engineConfidence: getEngineConfidence([Y], true),
    });
  });

  it("writes the same result_meta keys whichever path calls it", () => {
    expect(
      Object.keys(scoreMeta(scoreFindings([X], new Set()))).sort(),
    ).toEqual(["dangerScore", "engineConfidence", "safetyRating", "siteGrade"]);
  });
});

describe("resultMetaIsIncomplete", () => {
  it.each([
    [{ incomplete: ["dns"] }, true],
    [{ incomplete: [] }, false],
    [{}, false],
    [null, false],
    ["not an object", false],
  ])("reads %j as %s", (meta, expected) => {
    expect(resultMetaIsIncomplete(meta)).toBe(expected);
  });
});
