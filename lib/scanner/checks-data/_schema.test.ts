/**
 * Structural tests for every scanner check metadata file.
 *
 * The detectors themselves live in lib/scanner/checks/<category>.ts;
 * the human-readable descriptions and fix instructions live in
 * lib/scanner/checks-data/<category>.json. These tests verify that
 * the JSON contract is intact:
 *
 *   - The file is a non-empty array
 *   - Every entry has the required fields (id, title, category, severity,
 *     description, evidence, fixSteps, codeExamples)
 *   - The `category` field matches the file name
 *   - `severity` is one of the documented Severity enum values
 *   - `fixSteps` is non-empty and each step is a non-empty string
 *   - `codeExamples` has ≥1 example, each with label + non-empty code
 *   - `references` (when present) are HTTPS URLs
 *   - IDs are unique within the file
 *   - IDs are slug-safe (lowercase, hyphens, alphanumerics only)
 *
 * The suite is generated dynamically by reading every JSON file in
 * checks-data/, so a new category automatically gets tested without
 * touching this file.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ALL_CATEGORIES, type Severity } from "@/lib/scanner/types";

const VALID_SEVERITIES: Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];
const VALID_SEVERITY_SET = new Set<string>(VALID_SEVERITIES);

const CHECKS_DATA_DIR = path.join(
  process.cwd(),
  "lib",
  "scanner",
  "checks-data",
);

interface CheckDef {
  id: string;
  type?: string;
  title: string;
  category: string;
  severity: string;
  description: string;
  evidence: string;
  riskImpact?: string;
  explanation?: string;
  fixSteps: string[];
  codeExamples: { label: string; language: string; code: string }[];
  references?: string[];
}

function loadFile(category: string): CheckDef[] {
  const file = path.join(CHECKS_DATA_DIR, `${category}.json`);
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw) as CheckDef[];
}

describe("checks-data JSON contract", () => {
  for (const category of ALL_CATEGORIES) {
    describe(`${category}.json`, () => {
      const entries = loadFile(category);

      it("is a non-empty array", () => {
        expect(Array.isArray(entries)).toBe(true);
        expect(entries.length).toBeGreaterThan(0);
      });

      it("every entry has required fields", () => {
        const required: (keyof CheckDef)[] = [
          "id",
          "title",
          "category",
          "severity",
          "description",
          "evidence",
          "fixSteps",
          "codeExamples",
        ];
        for (const entry of entries) {
          for (const field of required) {
            expect(
              entry[field],
              `${category}.json: entry missing field "${field}" (id=${entry.id ?? "?"})`,
            ).toBeDefined();
          }
        }
      });

      it("category field matches the file name", () => {
        for (const entry of entries) {
          expect(
            entry.category,
            `${category}.json: entry "${entry.id}" has category "${entry.category}" but file is ${category}.json`,
          ).toBe(category);
        }
      });

      it("severity is a valid enum value", () => {
        const invalid = entries
          .map((e) => ({ id: e.id, sev: e.severity }))
          .filter((e) => !VALID_SEVERITY_SET.has((e.sev || "").toLowerCase()));
        if (invalid.length > 0) {
          throw new Error(
            `${category}.json: ${invalid.length} entries have invalid severity: ` +
              invalid
                .slice(0, 5)
                .map((e) => `${e.id}=${e.sev}`)
                .join(", "),
          );
        }
        // Also enforce lowercase
        const nonLower = entries
          .map((e) => ({ id: e.id, sev: e.severity }))
          .filter((e) => e.sev !== (e.sev || "").toLowerCase());
        if (nonLower.length > 0) {
          throw new Error(
            `${category}.json: ${nonLower.length} entries have non-lowercase severity: ` +
              nonLower
                .slice(0, 5)
                .map((e) => `${e.id}=${e.sev}`)
                .join(", "),
          );
        }
      });

      it("title is a non-empty string", () => {
        for (const entry of entries) {
          expect(typeof entry.title).toBe("string");
          expect(entry.title.length).toBeGreaterThan(0);
          // Reject the templated placeholder evidence strings from being used as titles
          expect(entry.title).not.toMatch(/^Secret pattern matched for/);
        }
      });

      it("description is a non-empty string", () => {
        for (const entry of entries) {
          expect(typeof entry.description).toBe("string");
          expect(entry.description.length).toBeGreaterThan(10);
        }
      });

      it("evidence is a non-empty string", () => {
        for (const entry of entries) {
          expect(typeof entry.evidence).toBe("string");
          expect(entry.evidence.length).toBeGreaterThan(0);
        }
      });

      it("fixSteps is non-empty array of non-empty strings", () => {
        for (const entry of entries) {
          expect(Array.isArray(entry.fixSteps)).toBe(true);
          expect(entry.fixSteps.length).toBeGreaterThan(0);
          for (const step of entry.fixSteps) {
            expect(typeof step).toBe("string");
            expect(step.trim().length).toBeGreaterThan(0);
          }
        }
      });

      it("codeExamples has at least one entry with label + non-empty code", () => {
        for (const entry of entries) {
          expect(Array.isArray(entry.codeExamples)).toBe(true);
          expect(entry.codeExamples.length).toBeGreaterThan(0);
          for (const ex of entry.codeExamples) {
            expect(typeof ex.label).toBe("string");
            expect(ex.label.length).toBeGreaterThan(0);
            expect(typeof ex.code).toBe("string");
            expect(ex.code.length).toBeGreaterThan(0);
          }
        }
      });

      it("references (when present) are HTTPS URLs", () => {
        for (const entry of entries) {
          if (!entry.references) continue;
          for (const url of entry.references) {
            expect(
              url.startsWith("https://"),
              `${category}.json: ${entry.id} references non-HTTPS URL: ${url}`,
            ).toBe(true);
          }
        }
      });

      it("ids are unique within the file", () => {
        const seen = new Set<string>();
        const dupes: string[] = [];
        for (const entry of entries) {
          if (seen.has(entry.id)) dupes.push(entry.id);
          seen.add(entry.id);
        }
        expect(
          dupes,
          `Duplicate ids in ${category}.json: ${dupes.join(", ")}`,
        ).toEqual([]);
      });

      it("ids are slug-safe (lowercase, digits, hyphens)", () => {
        const bad = entries.filter((e) => !/^[a-z0-9][a-z0-9-]*$/.test(e.id));
        if (bad.length > 0) {
          throw new Error(
            `${category}.json: ${bad.length} ids are not slug-safe: ` +
              bad
                .slice(0, 5)
                .map((e) => e.id)
                .join(", "),
          );
        }
      });
    });
  }
});

describe("checks-data total counts", () => {
  it("every category has at least 1 check", () => {
    for (const category of ALL_CATEGORIES) {
      const entries = loadFile(category);
      expect(entries.length, `${category} has 0 checks`).toBeGreaterThan(0);
    }
  });

  it("total check count is within the documented range", () => {
    let total = 0;
    for (const category of ALL_CATEGORIES) {
      total += loadFile(category).length;
    }
    // Bump this number when checks are added/removed intentionally.
    expect(total).toBeGreaterThan(700);
    expect(total).toBeLessThan(800);
  });

  it("ids are unique across all categories", () => {
    const seen = new Map<string, string>();
    const dupes: { id: string; categories: string[] }[] = [];
    for (const category of ALL_CATEGORIES) {
      for (const entry of loadFile(category)) {
        if (seen.has(entry.id)) {
          dupes.push({
            id: entry.id,
            categories: [seen.get(entry.id)!, category],
          });
        } else {
          seen.set(entry.id, category);
        }
      }
    }
    if (dupes.length > 0) {
      throw new Error(
        `Cross-category duplicate ids: ` +
          dupes
            .slice(0, 10)
            .map((d) => `${d.id} in [${d.categories.join(", ")}]`)
            .join("; "),
      );
    }
  });
});
