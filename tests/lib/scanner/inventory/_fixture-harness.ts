import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { detect } from "@/lib/scanner/inventory/engine";
import { buildInventoryInput } from "@/lib/scanner/inventory/input";
import type {
  Detection,
  Fingerprint,
  VersionKind,
} from "@/lib/scanner/inventory/types";

/**
 * Fixture harness for the fingerprint tables.
 *
 * A fixture is a directory under tests/fixtures/inventory/ holding the final
 * response a real (or hand-built) server sent:
 *
 *   headers.txt   status line, then `Name: value`; Set-Cookie repeated
 *   body.html     the reduced body
 *   expect.json   what the engine must and must not find
 *
 * tests/fixtures/inventory/README.md has the full layout and capture rules.
 */

export const FIXTURE_ROOT = path.resolve(
  __dirname,
  "../../../fixtures/inventory",
);

export interface FixtureMust {
  name: string;
  minConfidence?: number;
  version?: string;
  versionKind?: VersionKind;
}

export interface FixtureExpect {
  kind: "real" | "synthetic";
  capturedAt: string;
  url: string;
  must: FixtureMust[];
  mustNot?: string[];
}

export interface Fixture {
  slug: string;
  headers: Headers;
  body: string;
  expect: FixtureExpect;
}

/**
 * Parse a saved header file. A capture that followed redirects holds one block
 * per hop: only the last is the response the scanner analyzed. Set-Cookie is
 * appended, never joined, so every cookie survives as its own entry.
 */
export function parseHeadersFile(text: string): Headers {
  const blocks = text
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter((block) => /^HTTP\//i.test(block));
  const last = blocks[blocks.length - 1] ?? "";
  const headers = new Headers();
  for (const line of last.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    try {
      headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    } catch {
      // A line that is not a valid header (a capture artefact) is skipped.
    }
  }
  return headers;
}

export function listFixtures(root: string = FIXTURE_ROOT): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((entry) => statSync(path.join(root, entry)).isDirectory())
    .sort();
}

export function loadFixture(
  slug: string,
  root: string = FIXTURE_ROOT,
): Fixture {
  const dir = path.join(root, slug);
  return {
    slug,
    headers: parseHeadersFile(
      readFileSync(path.join(dir, "headers.txt"), "utf8"),
    ),
    body: readFileSync(path.join(dir, "body.html"), "utf8"),
    expect: JSON.parse(
      readFileSync(path.join(dir, "expect.json"), "utf8"),
    ) as FixtureExpect,
  };
}

export function runFixture(
  fixture: Fixture,
  table: readonly Fingerprint[],
): Detection[] {
  return detect(
    buildInventoryInput(fixture.headers, fixture.body, fixture.expect.url),
    table,
  );
}

/**
 * Problems found checking a fixture against a table, as sentences. Only the
 * `must` and `mustNot` entries for `names` are checked when given, so a data
 * module is judged on its own products and an implied product that has no
 * entry in the module's table needs none.
 */
export function checkFixture(
  fixture: Fixture,
  table: readonly Fingerprint[],
  names?: readonly string[],
): string[] {
  const only = names ? new Set(names) : null;
  const found = new Map(runFixture(fixture, table).map((d) => [d.name, d]));
  const problems: string[] = [];

  for (const must of fixture.expect.must) {
    if (only && !only.has(must.name)) continue;
    const detection = found.get(must.name);
    if (!detection) {
      problems.push(`${fixture.slug}: expected ${must.name}, found nothing`);
      continue;
    }
    if (
      must.minConfidence !== undefined &&
      detection.confidence < must.minConfidence
    ) {
      problems.push(
        `${fixture.slug}: ${must.name} confidence ${detection.confidence} is below ${must.minConfidence}`,
      );
    }
    if (must.version !== undefined && detection.version !== must.version) {
      problems.push(
        `${fixture.slug}: ${must.name} version ${detection.version ?? "none"}, expected ${must.version}`,
      );
    }
    if (
      must.versionKind !== undefined &&
      detection.versionKind !== must.versionKind
    ) {
      problems.push(
        `${fixture.slug}: ${must.name} version kind ${detection.versionKind ?? "none"}, expected ${must.versionKind}`,
      );
    }
  }
  for (const name of fixture.expect.mustNot ?? []) {
    if (only && !only.has(name)) continue;
    if (found.has(name)) {
      problems.push(`${fixture.slug}: ${name} must not be detected`);
    }
  }
  return problems;
}

/**
 * Register one test per fixture whose `must` names one of `moduleNames`, run
 * with `table` alone. Call it at the top level of a data module's test file.
 */
export function runModuleFixtures(
  table: readonly Fingerprint[],
  moduleNames: readonly string[],
  root: string = FIXTURE_ROOT,
): void {
  const names = new Set(moduleNames);
  describe("fixtures", () => {
    for (const slug of listFixtures(root)) {
      const fixture = loadFixture(slug, root);
      const own =
        fixture.expect.must.some((m) => names.has(m.name)) ||
        (fixture.expect.mustNot ?? []).some((n) => names.has(n));
      if (!own) continue;
      it(slug, () => {
        expect(checkFixture(fixture, table, moduleNames)).toEqual([]);
      });
    }
  });
}
