import { describe, it, expect } from "vitest";
import { RATING_FINDINGS_SQL } from "@/lib/scanner/rating-findings-sql";
import { getDangerScore, getSafetyRating } from "@/lib/scanner/safety-rating";
import type { Vulnerability } from "@/lib/scanner/types";

const PROJECTED = ["title", "severity", "aiVerdict", "aiConfidence"];

/** A finding that records every property the code under test reads off it. */
function spyFinding(fields: Record<string, unknown>, reads: Set<string>) {
  return new Proxy(fields, {
    get(target, key) {
      if (typeof key === "string") reads.add(key);
      return target[key as string];
    },
  }) as unknown as Vulnerability;
}

describe("RATING_FINDINGS_SQL", () => {
  it("projects exactly the four fields", () => {
    const keys = [...RATING_FINDINGS_SQL.matchAll(/'(\w+)', e->/g)].map(
      (m) => m[1],
    );
    expect(keys).toEqual(PROJECTED);
  });

  it("guards a NULL column and an empty result", () => {
    expect(RATING_FINDINGS_SQL).toContain("COALESCE(findings, '[]'::jsonb)");
    expect(RATING_FINDINGS_SQL).toContain("COALESCE(jsonb_agg(");
  });

  // The projection is only safe while the rating code reads nothing else. A
  // field it starts to need would otherwise be silently undefined on every
  // list that rates from these rows, while the owner's own view, which reads
  // the full finding, kept giving a different answer.
  it.each([
    ["exploitable", "SQL Injection Vulnerability", "critical"],
    ["hardening", "Missing Content-Security-Policy", "high"],
    ["other", "Some unclassified finding", "critical"],
    ["informational", "Some unclassified finding", "info"],
  ])(
    "covers every field the rating reads off a %s finding",
    (_name, title, severity) => {
      const reads = new Set<string>();
      const findings = [
        spyFinding(
          { title, severity, aiVerdict: "confirmed", aiConfidence: 90 },
          reads,
        ),
      ];

      getSafetyRating(findings);
      getDangerScore(findings);

      expect(reads.size).toBeGreaterThan(0);
      for (const key of reads) expect(PROJECTED).toContain(key);
    },
  );
});
