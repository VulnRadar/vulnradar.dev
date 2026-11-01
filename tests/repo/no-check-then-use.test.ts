import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Checking a path and then opening the same path is two lookups of one name,
 * and the file can change in between (CWE-367, CodeQL js/file-system-race).
 * These files did exactly that: the source walks in three tests stat'ed every
 * entry and then read it by name, and the docs and checks compilers stat'ed
 * their output and then wrote it by name. The walks now ask the directory
 * entry what it is, and the compilers go through one file handle.
 *
 * The rule mirrors the CodeQL query: a stat, lstat, access or exists on a
 * path, followed later by a read, write, append or open of the same path. An
 * existence check followed by a read is allowed, as it is there, because a
 * read of a file that vanished just throws.
 */
const FILES = [
  "tests/components/ui/modal-grammar.test.ts",
  "tests/lib/seo/routes.test.ts",
  "tests/lib/tour/steps.test.ts",
  "scripts/knowledge/compile-docs-knowledge.mjs",
  "scripts/knowledge/compile-checks-knowledge.mjs",
];

const CHECK =
  /\b(existsSync|statSync|lstatSync|accessSync)\(\s*([^,()]+?)\s*[,)]/g;
const USE =
  /\b(readFileSync|writeFileSync|appendFileSync|openSync)\(\s*([^,()]+?)\s*[,)]/g;

function checkThenUse(source: string): string[] {
  const checks = [...source.matchAll(CHECK)];
  const uses = [...source.matchAll(USE)];
  const found: string[] = [];
  for (const check of checks) {
    for (const use of uses) {
      if (use.index! < check.index!) continue;
      if (use[2] !== check[2]) continue;
      if (check[1] === "existsSync" && use[1] === "readFileSync") continue;
      found.push(`${check[1]}(${check[2]}) then ${use[1]}(${use[2]})`);
    }
  }
  return found;
}

describe("no check-then-use on one path", () => {
  it("the detector finds the shape it is looking for", () => {
    expect(
      checkThenUse(
        "if (statSync(full).isDirectory()) walk(full);\nreadFileSync(full, 'utf8');",
      ),
    ).toEqual(["statSync(full) then readFileSync(full)"]);
    expect(
      checkThenUse(
        "const m = existsSync(OUTPUT) ? 1 : 0; writeFileSync(OUTPUT, s);",
      ),
    ).toHaveLength(1);
    expect(checkThenUse("if (existsSync(p)) readFileSync(p, 'utf8');")).toEqual(
      [],
    );
  });

  it.each(FILES)("%s", (file) => {
    expect(checkThenUse(readFileSync(file, "utf8"))).toEqual([]);
  });
});
