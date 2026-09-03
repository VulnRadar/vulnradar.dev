import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  SEVERITY_ORDER,
  SEVERITY_PRIORITY,
} from "@/lib/config/client-constants";
import { dedupeFindings } from "@/lib/scanner/dedupe";
import { generateMarkdownReport } from "@/lib/reports/markdown-report";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

/**
 * The severity ordering is one table, and stays one table.
 *
 * It used to be nine private ones under three mutually incompatible numeric
 * conventions: critical counted down from 5 in two, up from 0 in four, and up
 * from 0 with info at the bottom in three, with two of the nine sharing the
 * identifier SEVERITY_RANK. "Sort by severity" therefore meant the opposite
 * thing depending on which file you were reading, a comparator copied between
 * them silently inverted, and nothing typechecked differently either way.
 * ref: AUDIT-013#dup-02
 *
 * The scan below is the part that actually fails on a regression: the
 * behavioural assertions underneath it stay green when someone adds a tenth
 * private table, because a private table is only wrong once its direction
 * disagrees with everyone else's.
 */

const ROOT = join(__dirname, "..", "..", "..");
const SCANNED_DIRS = ["lib", "components", "app"];
const SKIP_DIRS = new Set(["node_modules", ".next", "__snapshots__"]);

/** Files allowed to declare a severity map of their own, with the reason. */
const ALLOWED: readonly string[] = [
  // The canonical table itself.
  "lib/config/client-constants.ts",
];

/** Any `{ ... }` literal short enough to be a lookup table. */
const OBJECT_LITERAL = /\{[^{}]{0,400}\}/g;
/** `critical: 5,` and friends, integers only. */
const SEVERITY_ENTRY = /\b(critical|high|medium|low|info)\s*:\s*(-?\d+)\b/g;
/** `low: 0.3` and friends: a fractional value means a weight, not a rank. */
const FRACTIONAL_ENTRY = /\b(?:critical|high|medium|low|info)\s*:\s*-?\d+\.\d/;

/**
 * Is this object literal a severity ORDERING?
 *
 * Four or more severity names with DISTINCT INTEGER values. Three shapes are
 * deliberately not orderings and must not be reported:
 *  - a zeroed tally (`{ critical: 0, high: 0, ... }`), whose values are equal;
 *  - a scoring weight table (lib/scanner/safety-rating.ts), whose values are
 *    fractional because they are magnitudes rather than ranks;
 *  - a label or colour map, whose values are not numbers at all.
 */
function isSeverityOrdering(literal: string): boolean {
  if (FRACTIONAL_ENTRY.test(literal)) return false;
  const values = [...literal.matchAll(SEVERITY_ENTRY)].map((m) => Number(m[2]));
  if (values.length < 4) return false;
  return new Set(values).size === values.length;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

describe("SEVERITY_ORDER / SEVERITY_PRIORITY", () => {
  it("is worst-first and numerically agrees with itself", () => {
    expect([...SEVERITY_ORDER]).toEqual([
      "critical",
      "high",
      "medium",
      "low",
      "info",
    ]);
    for (let i = 1; i < SEVERITY_ORDER.length; i++) {
      expect(SEVERITY_PRIORITY[SEVERITY_ORDER[i - 1]]).toBeGreaterThan(
        SEVERITY_PRIORITY[SEVERITY_ORDER[i]],
      );
    }
  });

  it("is the only numeric severity table in lib/, components/ and app/", () => {
    const offenders: string[] = [];
    for (const dirName of SCANNED_DIRS) {
      for (const file of sourceFiles(join(ROOT, dirName))) {
        const rel = relative(ROOT, file).split(sep).join("/");
        if (ALLOWED.includes(rel)) continue;
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(OBJECT_LITERAL)) {
          if (isSeverityOrdering(match[0])) {
            offenders.push(
              `${rel}: ${match[0].replace(/\s+/g, " ").slice(0, 70)}`,
            );
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

function finding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "check-a--abc123",
    title: "check-a",
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

describe("consumers read the table in the right direction", () => {
  it("dedupe keeps the more severe finding of a duplicate pair", () => {
    // sri-missing and third-party-script-no-sri share a dedupe group.
    const { findings } = dedupeFindings([
      finding({ id: "sri-missing--x", title: "low one", severity: "low" }),
      finding({
        id: "third-party-script-no-sri--x",
        title: "critical one",
        severity: "critical",
      }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
  });

  it("the markdown report renders severity sections worst-first", () => {
    const result = {
      url: "https://example.com/",
      scannedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
      findings: SEVERITY_ORDER.map((severity, i) =>
        finding({
          id: `check-${i}--x`,
          title: `finding ${severity}`,
          severity,
        }),
      ),
      summary: {
        critical: 1,
        high: 1,
        medium: 1,
        low: 1,
        info: 1,
        total: 5,
      },
    } as unknown as ScanResult;

    const md = generateMarkdownReport(result);
    const positions = SEVERITY_ORDER.map((s) => md.indexOf(`finding ${s}`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
});
