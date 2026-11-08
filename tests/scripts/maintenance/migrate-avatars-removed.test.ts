import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Owner decision D8. scripts/maintenance/migrate-avatars-to-files.mjs wrote
 * avatars to disk and repointed avatar_url at them while the app serves only
 * from user_avatars, so every avatar it touched became a 404. The boot backfill
 * in lib/uploads/avatar-migration.ts covers what is left and the direction the
 * script went is never needed, so it is gone, and nothing may send an operator
 * looking for it.
 *
 * CHANGELOG.md, lib/changelog/ and the audits/ reports are history. The docs
 * pages under app/docs/ belong to the docs clusters.
 */
const ROOT = process.cwd();
const SCRIPT_NAME = ["migrate-avatars", "to-files"].join("-");
const NPM_SCRIPT = ["db", "migrate-avatars"].join(":");
const SELF = "tests/scripts/maintenance/migrate-avatars-removed.test.ts";
// Each asserts that a surface does not carry the name, so has to spell it.
const OTHER_GUARDS = new Set([
  "tests/app/docs/developers-contributor-guide.test.ts",
  "tests/repo/package-deps-guard.test.ts",
]);

const FILES = ["package.json", ".env.example", ".gitignore"];
const DIRECTORIES = ["scripts", "lib", "tests", "app"];
const SKIPPED_PREFIXES = ["app/docs/", "lib/changelog/"];
// Compiled from the changelog and the docs pages, so it is the same history.
const GENERATED_KNOWLEDGE = /^lib\/ai\/.*\.(md|json)$/;
const TEXT_FILE = /\.(c|m)?[jt]sx?$|\.json$|\.md$|\.ya?ml$|\.sh$/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
}

function repoPath(full: string): string {
  return relative(ROOT, full).split(sep).join("/");
}

function candidates(): string[] {
  const found: string[] = [];
  for (const dir of DIRECTORIES) walk(join(ROOT, dir), found);
  return [
    ...FILES,
    ...found
      .map(repoPath)
      .filter((p) => TEXT_FILE.test(p))
      .filter((p) => p !== SELF && !OTHER_GUARDS.has(p))
      .filter((p) => !GENERATED_KNOWLEDGE.test(p))
      .filter((p) => !SKIPPED_PREFIXES.some((prefix) => p.startsWith(prefix))),
  ];
}

describe("the avatar export script stays deleted", () => {
  it("is not on disk", () => {
    expect(
      existsSync(join(ROOT, "scripts/maintenance", `${SCRIPT_NAME}.mjs`)),
    ).toBe(false);
  });

  it("scans a realistic number of files", () => {
    // A walk that found nothing would pass the next test.
    expect(candidates().length).toBeGreaterThan(500);
  });

  it("is not named anywhere outside the history", () => {
    const naming = candidates().filter((path) => {
      const text = readFileSync(join(ROOT, path), "utf8");
      return text.includes(SCRIPT_NAME) || text.includes(NPM_SCRIPT);
    });
    expect(naming).toEqual([]);
  });
});
