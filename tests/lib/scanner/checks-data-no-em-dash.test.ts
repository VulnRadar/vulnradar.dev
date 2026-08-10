/**
 * Regression guard: no em dash (—, U+2014) in any scanner check metadata.
 *
 * lib/scanner/checks-data/*.json is rendered directly into the scan-result
 * UI (title, description, riskImpact, explanation, fixSteps, evidence,
 * references, codeExamples), and is also compiled into lib/ai/checks-knowledge.md,
 * which the AI chat assistant loads as RAG context. CLAUDE.md bans em dashes
 * in UI copy ("No em dashes (—) in UI copy. Use a colon, comma, or rewrite
 * the sentence."), so a stray em dash here would both violate that rule and
 * bias the AI assistant's own writing style. This test walks every string
 * value in every checks-data JSON file and fails if any contains U+2014, so
 * a future check addition can't reintroduce one.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CHECKS_DIR = join(process.cwd(), "lib", "scanner", "checks-data");
const EM_DASH = "—";

function collectEmDashPaths(value: unknown, path: string, hits: string[]) {
  if (typeof value === "string") {
    if (value.includes(EM_DASH)) hits.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectEmDashPaths(item, `${path}[${i}]`, hits));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      collectEmDashPaths(val, path ? `${path}.${key}` : key, hits);
    }
  }
}

const files = readdirSync(CHECKS_DIR).filter((f) => f.endsWith(".json"));

describe("checks-data: no em dashes", () => {
  it("finds at least one checks-data JSON file to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} contains no em dash (U+2014) in any string field`, () => {
      const raw = readFileSync(join(CHECKS_DIR, file), "utf8");
      const data = JSON.parse(raw) as unknown;
      const hits: string[] = [];
      collectEmDashPaths(data, "", hits);
      expect(
        hits,
        `Em dash found in ${file} at: ${hits.join(", ")}. Use a colon, comma, semicolon, or split into two sentences instead.`,
      ).toEqual([]);
    });
  }
});
