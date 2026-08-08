import { describe, it, expect } from "vitest";
import {
  dedupeFindings,
  checkIdOf,
  LEGACY_DEDUPE_GROUPS,
} from "@/lib/scanner/dedupe";
import type { Vulnerability } from "@/lib/scanner/types";

function finding(
  checkId: string,
  overrides: Partial<Vulnerability> = {},
): Vulnerability {
  return {
    id: `${checkId}--abc123`,
    title: checkId,
    severity: "medium",
    category: "headers",
    description: "d",
    evidence: "e",
    riskImpact: "r",
    explanation: "x",
    fixSteps: ["s"],
    codeExamples: [],
    confidence: 70,
    ...overrides,
  };
}

describe("checkIdOf", () => {
  it("recovers the check id from a stable finding id", () => {
    expect(checkIdOf(finding("sri-missing"))).toBe("sri-missing");
  });

  it("returns the whole id when there is no separator", () => {
    expect(checkIdOf({ ...finding("x"), id: "no-separator-here" })).toBe(
      "no-separator-here",
    );
  });
});

describe("dedupeFindings", () => {
  it("collapses findings from the same legacy dedupe group into one", () => {
    const input = [
      finding("sri-missing"),
      finding("third-party-script-no-sri"),
      finding("supply-chain-sri-external-script"),
    ];
    const { findings, merged } = dedupeFindings(input);
    expect(findings).toHaveLength(1);
    expect(merged).toBe(2);
    expect(findings[0].alsoReportedBy?.sort()).toEqual(
      ["supply-chain-sri-external-script", "third-party-script-no-sri"].sort(),
    );
  });

  it("keeps findings with no group entirely untouched", () => {
    const input = [finding("hsts-missing"), finding("xcto-missing")];
    const { findings, merged } = dedupeFindings(input);
    expect(findings).toHaveLength(2);
    expect(merged).toBe(0);
    expect(findings[0].alsoReportedBy).toBeUndefined();
  });

  it("picks the higher-severity finding as the survivor", () => {
    const low = finding("sri-missing", { severity: "low" });
    const high = finding("external-script-no-sri", { severity: "high" });
    const { findings } = dedupeFindings([low, high]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
  });

  it("breaks a severity tie using confidence", () => {
    const lowConf = finding("sri-missing", { confidence: 50 });
    const highConf = finding("external-script-no-sri", { confidence: 90 });
    const { findings } = dedupeFindings([lowConf, highConf]);
    expect(findings[0].confidence).toBe(90);
  });

  it("respects extraGroups for checks not in the legacy table", () => {
    const a = finding("page-custom-a");
    const b = finding("page-custom-b");
    const { findings, merged } = dedupeFindings([a, b], {
      "page-custom-a": "custom-group",
      "page-custom-b": "custom-group",
    });
    expect(findings).toHaveLength(1);
    expect(merged).toBe(1);
  });

  it("preserves document order among survivors", () => {
    const a = finding("hsts-missing");
    const b = finding("csp-missing");
    const c = finding("xcto-missing");
    const { findings } = dedupeFindings([a, b, c]);
    expect(findings.map((f) => f.id)).toEqual([a.id, b.id, c.id]);
  });

  it("every LEGACY_DEDUPE_GROUPS entry maps to a non-empty group name", () => {
    for (const [id, group] of Object.entries(LEGACY_DEDUPE_GROUPS)) {
      expect(typeof id).toBe("string");
      expect(group.length).toBeGreaterThan(0);
    }
  });
});
