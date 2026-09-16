import { describe, it, expect } from "vitest";
import {
  dedupeFindings,
  checkIdOf,
  LEGACY_DEDUPE_GROUPS,
} from "@/lib/scanner/dedupe";
import type { Vulnerability } from "@/lib/scanner/types";
import { allCheckDefs } from "@/lib/scanner/registry";
import { pageCheckGroups } from "@/lib/scanner/checks/page-checks";
import { ASYNC_CHECKS } from "@/lib/scanner/async-check-catalog";

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

  it("keeps the live GraphQL introspection result over the keyword matches", () => {
    const { findings, merged } = dedupeFindings([
      finding("graphql-introspection", { severity: "low" }),
      finding("api-graphql-introspection-enabled", { severity: "low" }),
      finding("async-graphql-introspection-enabled", { severity: "medium" }),
    ]);
    expect(merged).toBe(2);
    expect(checkIdOf(findings[0])).toBe("async-graphql-introspection-enabled");
  });

  it("merges a group only within one component", () => {
    const { findings, merged } = dedupeFindings(
      [
        finding("page-outdated-vulnerable-library", {
          component: "jquery@1.12.4",
        }),
        finding("page-outdated-vulnerable-library", {
          component: "lodash@4.17.15",
        }),
        finding("osv-vulnerable-library", { component: "jquery@1.12.4" }),
      ],
      pageCheckGroups,
    );
    expect(merged).toBe(1);
    expect(findings.map((f) => [checkIdOf(f), f.component])).toEqual([
      ["page-outdated-vulnerable-library", "lodash@4.17.15"],
      ["osv-vulnerable-library", "jquery@1.12.4"],
    ]);
  });

  it("keeps the live OSV.dev finding even when the offline snapshot rated it higher", () => {
    const { findings } = dedupeFindings(
      [
        finding("page-outdated-vulnerable-library", {
          severity: "high",
          confidence: 95,
          component: "jquery@1.12.4",
        }),
        finding("osv-vulnerable-library", {
          severity: "medium",
          component: "jquery@1.12.4",
        }),
      ],
      pageCheckGroups,
    );
    expect(findings).toHaveLength(1);
    expect(checkIdOf(findings[0])).toBe("osv-vulnerable-library");
    expect(findings[0].alsoReportedBy).toEqual([
      "page-outdated-vulnerable-library",
    ]);
  });

  it("keeps earlier merges listed when it runs again over its own output", () => {
    // A scan dedupes the page checks, then everything once the async checks
    // answer. The keyword checks merged in the first pass must still be
    // credited after the live query wins the second.
    const first = dedupeFindings([
      finding("graphql-introspection"),
      finding("api-graphql-introspection-enabled", { confidence: 80 }),
    ]).findings;
    expect(first).toHaveLength(1);
    const second = dedupeFindings([
      ...first,
      finding("async-graphql-introspection-enabled", { severity: "low" }),
    ]);
    expect(second.findings).toHaveLength(1);
    expect(checkIdOf(second.findings[0])).toBe(
      "async-graphql-introspection-enabled",
    );
    expect(second.findings[0].alsoReportedBy).toEqual([
      "api-graphql-introspection-enabled",
      "graphql-introspection",
    ]);
  });

  it("keeps the confirmed Symfony profiler over the header that points at it", () => {
    const { findings } = dedupeFindings([
      finding("symfony-debug-token", { severity: "medium", confidence: 95 }),
      finding("async-symfony-profiler-exposed", { severity: "high" }),
    ]);
    expect(findings).toHaveLength(1);
    expect(checkIdOf(findings[0])).toBe("async-symfony-profiler-exposed");
    expect(findings[0].alsoReportedBy).toEqual(["symfony-debug-token"]);
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
    const high = finding("third-party-script-no-sri", { severity: "high" });
    const { findings } = dedupeFindings([low, high]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
  });

  it("breaks a severity tie using confidence", () => {
    const lowConf = finding("sri-missing", { confidence: 50 });
    const highConf = finding("third-party-script-no-sri", { confidence: 90 });
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

  // A key naming a check that does not exist merges nothing, and a group with
  // one member merges nothing either, so both read as coverage that is not
  // there. Seven such keys had built up, most pointing at detectors that had
  // no definition and so never ran.
  it("every LEGACY_DEDUPE_GROUPS key is a real check id", () => {
    const known = new Set<string>([
      ...allCheckDefs.map((d) => d.id),
      ...Object.values(ASYNC_CHECKS).map((d) => d.checkId),
    ]);
    const unknown = Object.keys(LEGACY_DEDUPE_GROUPS).filter(
      (id) => !known.has(id),
    );
    expect(unknown).toEqual([]);
  });

  it("every dedupe group has at least two members", () => {
    const members = new Map<string, Set<string>>();
    for (const [id, group] of Object.entries({
      ...LEGACY_DEDUPE_GROUPS,
      ...pageCheckGroups,
    })) {
      if (!members.has(group)) members.set(group, new Set());
      members.get(group)!.add(id);
    }
    const singletons = [...members]
      .filter(([, ids]) => ids.size < 2)
      .map(([group]) => group);
    expect(singletons).toEqual([]);
  });

  it("every LEGACY_DEDUPE_GROUPS entry maps to a non-empty group name", () => {
    for (const [id, group] of Object.entries(LEGACY_DEDUPE_GROUPS)) {
      expect(typeof id).toBe("string");
      expect(group.length).toBeGreaterThan(0);
    }
  });
});
