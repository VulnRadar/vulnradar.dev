/**
 * lib/scanner/partial-findings.ts: the live findings the scan engine has
 * streamed since progress tracking landed and no client ever read.
 *
 * The producer (lib/scanner/scan-jobs.ts), the transport
 * (app/api/v3/scan/status/[id]/route.ts) and the OpenAPI spec all carried
 * this; app/dashboard/poll-scan-status.ts did not declare the field, so
 * through a three-minute crawl the user saw a counter and nothing else.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_PARTIAL_FINDINGS,
  normalizePartialFindings,
} from "@/lib/scanner/partial-findings";

describe("normalizePartialFindings", () => {
  it("keeps well-formed findings in arrival order", () => {
    expect(
      normalizePartialFindings([
        { severity: "high", title: "Missing HSTS" },
        { severity: "low", title: "Server header leaks a version" },
      ]),
    ).toEqual([
      { severity: "high", title: "Missing HSTS" },
      { severity: "low", title: "Server header leaks a version" },
    ]);
  });

  it("returns an empty list rather than undefined when there is no payload", () => {
    // The consumer renders this without a guard, so the empty case has to be
    // an array on every path.
    expect(normalizePartialFindings(undefined)).toEqual([]);
    expect(normalizePartialFindings(null)).toEqual([]);
    expect(normalizePartialFindings("nope")).toEqual([]);
    expect(normalizePartialFindings({ severity: "high" })).toEqual([]);
  });

  it("drops an unknown severity instead of letting it index a tone table", () => {
    expect(
      normalizePartialFindings([
        { severity: "catastrophic", title: "Nope" },
        { severity: "critical", title: "Yes" },
      ]),
    ).toEqual([{ severity: "critical", title: "Yes" }]);
  });

  it("drops entries with no usable title", () => {
    expect(
      normalizePartialFindings([
        { severity: "high" },
        { severity: "high", title: "   " },
        { severity: "high", title: 12 },
        null,
        "string",
      ]),
    ).toEqual([]);
  });

  it("collapses the same finding reported by two families", () => {
    // Dedupe runs after the last family, so before it the same issue can
    // legitimately appear twice. Showing it twice on the progress card would
    // read as two problems.
    expect(
      normalizePartialFindings([
        { severity: "medium", title: "Weak cookie flags" },
        { severity: "medium", title: "Weak cookie flags" },
      ]),
    ).toHaveLength(1);
  });

  it("bounds a title so one finding cannot stretch the card", () => {
    const long = "x".repeat(500);
    const [finding] = normalizePartialFindings([
      { severity: "info", title: long },
    ]);
    expect(finding.title.length).toBe(120);
  });

  it("caps the list at the same ceiling the server sends", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      severity: "info",
      title: `Finding ${i}`,
    }));
    expect(normalizePartialFindings(many)).toHaveLength(MAX_PARTIAL_FINDINGS);
  });
});
