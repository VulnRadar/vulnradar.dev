/**
 * Every id in dns.json, email.json and tls.json is one of three things, and a
 * page or an API row may only promise what is true of its kind:
 *
 *   - emitted: a probe in lib/scanner builds a finding whose id starts with it
 *   - mapped: write-up for findings the async layer reports as
 *     `async-<title slug>`, named in `emittedAs`
 *   - documentationOnly: nothing a scan reports corresponds to it
 *
 * 47 of the 88 entries used to be silently the second kind. The check page
 * told readers the id "stays the same between runs", and no run ever reported
 * it. Whether an id is emitted is read from the scanner source: a quoted
 * occurrence of the id anywhere under lib/scanner that is not the
 * `"id": () => null` placeholder the registry keeps for its coverage test.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getAsyncCheckDef } from "@/lib/scanner/async-check-catalog";
import { getCheckEmission } from "@/lib/scanner/check-emission";
import { ALL_CATEGORIES } from "@/lib/scanner/types";

const SCANNER_DIR = path.join(process.cwd(), "lib", "scanner");
const DATA_DIR = path.join(SCANNER_DIR, "checks-data");
const FILES_WITH_EMISSION = ["dns", "email", "tls"] as const;

interface Entry {
  id: string;
  emittedAs?: unknown;
  documentationOnly?: unknown;
}

function load(category: string): Entry[] {
  return JSON.parse(
    readFileSync(path.join(DATA_DIR, `${category}.json`), "utf8"),
  ) as Entry[];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "checks-data" ? [] : sourceFiles(full);
    }
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

const SOURCE_LINES = sourceFiles(SCANNER_DIR).flatMap((file) =>
  readFileSync(file, "utf8").split("\n"),
);

function isEmittedUnderOwnId(id: string): boolean {
  const quoted = `"${id}"`;
  return SOURCE_LINES.some(
    (line) =>
      line.includes(quoted) &&
      !/:\s*\(\)\s*=>\s*null/.test(line) &&
      !line.trim().startsWith("//"),
  );
}

describe("emittedAs and documentationOnly", () => {
  for (const category of FILES_WITH_EMISSION) {
    describe(`${category}.json`, () => {
      const entries = load(category);

      it("gives every entry exactly one story: emitted, mapped, or documentation only", () => {
        for (const entry of entries) {
          const mapped = Array.isArray(entry.emittedAs);
          const docOnly = entry.documentationOnly === true;
          const emitted = isEmittedUnderOwnId(entry.id);
          expect(
            [emitted, mapped, docOnly].filter(Boolean).length,
            `${entry.id}: emitted=${emitted} mapped=${mapped} documentationOnly=${docOnly}`,
          ).toBe(1);
        }
      });

      it("maps only to async checks that exist", () => {
        for (const entry of entries) {
          if (entry.emittedAs === undefined) continue;
          expect(Array.isArray(entry.emittedAs), entry.id).toBe(true);
          const ids = entry.emittedAs as unknown[];
          expect(ids.length, `${entry.id} maps to nothing`).toBeGreaterThan(0);
          for (const asyncId of ids) {
            expect(typeof asyncId, entry.id).toBe("string");
            expect(
              getAsyncCheckDef(asyncId as string),
              `${entry.id} -> ${String(asyncId)} is not in ASYNC_CHECKS`,
            ).toBeDefined();
          }
          expect(new Set(ids).size, `${entry.id} repeats an id`).toBe(
            ids.length,
          );
        }
      });

      it("only ever sets documentationOnly to true", () => {
        for (const entry of entries) {
          if (entry.documentationOnly === undefined) continue;
          expect(entry.documentationOnly, entry.id).toBe(true);
        }
      });
    });
  }

  // Retired detectors that stay registered as silent stubs until the wave that
  // 301s their pages removes them with their entries. Nothing else outside the
  // three async files may claim to be documentation only.
  const RETIRED_STUBS = new Set(["target-blank-no-noopener", "open-redirect"]);

  it("keeps the fields to the three files whose probes live in code", () => {
    for (const category of ALL_CATEGORIES) {
      if ((FILES_WITH_EMISSION as readonly string[]).includes(category)) {
        continue;
      }
      for (const entry of load(category)) {
        expect("emittedAs" in entry, `${category}/${entry.id}`).toBe(false);
        expect("documentationOnly" in entry, `${category}/${entry.id}`).toBe(
          RETIRED_STUBS.has(entry.id),
        );
      }
    }
  });

  it("reads back through getCheckEmission the way the JSON says it", () => {
    for (const category of FILES_WITH_EMISSION) {
      for (const entry of load(category)) {
        const emission = getCheckEmission(entry.id);
        const mapped = Array.isArray(entry.emittedAs);
        expect(emission.emitted, entry.id).toBe(
          !mapped && entry.documentationOnly !== true,
        );
        expect(emission.emittedAs, entry.id).toEqual(
          mapped ? entry.emittedAs : [],
        );
      }
    }
  });

  it("treats an id outside those files as emitted under its own id", () => {
    expect(getCheckEmission("hsts-missing")).toEqual({
      emitted: true,
      emittedAs: [],
      documentationOnly: false,
    });
  });

  it("still covers the 47 write-up entries the audit found", () => {
    const mapped = FILES_WITH_EMISSION.flatMap(load).filter(
      (e) => e.emittedAs !== undefined || e.documentationOnly === true,
    );
    expect(mapped.length).toBeGreaterThanOrEqual(47);
  });
});
