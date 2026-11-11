import { describe, it, expect } from "vitest";
import {
  severityCounts,
  summarizeFindings,
} from "@/lib/scanner/severity-summary";
import { severityCounts as reportSeverityCounts } from "@/lib/reports/severity-counts";
import type { Vulnerability } from "@/lib/scanner/types";

function finding(severity: string, id = severity): Vulnerability {
  return { id, severity } as unknown as Vulnerability;
}

describe("severityCounts", () => {
  it("has every band at zero for an empty list", () => {
    expect(severityCounts([])).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
  });

  it("counts each finding in its own band", () => {
    expect(
      severityCounts([
        finding("critical"),
        finding("high"),
        finding("high", "h2"),
        finding("low"),
        finding("info"),
      ]),
    ).toEqual({ critical: 1, high: 2, medium: 0, low: 1, info: 1 });
  });

  it("counts a severity that is none of the five in no band", () => {
    expect(
      severityCounts([finding("constructor"), finding("toString")]),
    ).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
  });

  it("is the same function the reports import", () => {
    expect(reportSeverityCounts).toBe(severityCounts);
  });
});

describe("summarizeFindings", () => {
  it("adds total as the length of the list", () => {
    expect(
      summarizeFindings([
        finding("critical"),
        finding("medium"),
        finding("medium", "m2"),
      ]),
    ).toEqual({ critical: 1, high: 0, medium: 2, low: 0, info: 0, total: 3 });
  });

  it("counts a finding with an unknown severity in total only, as the hand-written tallies did", () => {
    const summary = summarizeFindings([finding("high"), finding("bogus")]);
    expect(summary.high).toBe(1);
    expect(summary.total).toBe(2);
  });
});
