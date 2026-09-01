import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Every `ON CONFLICT (cols)` in the codebase has to name a column tuple the
 * schema actually has a unique index for.
 *
 * PostgreSQL does not catch this at parse time. It throws at execution
 * time, on the write path, with "there is no unique or exclusion constraint
 * matching the ON CONFLICT specification". The upsert simply 500s in
 * production, and only for the request that hits it, so it can sit unnoticed
 * for a long time. AUDIT-013 recorded exactly that shape on
 * github_review_usage, where the boot path's unique constraint was added
 * inside a `.catch()` that swallowed a duplicate-key failure: the table was
 * left with no constraint and every usage write after it failed.
 *
 * Both sides are parsed, so this cannot go stale. Adding an upsert on a
 * column tuple nobody made unique fails here instead of in production.
 */
const {
  bootSchemaStatements,
  parseUniqueTargets,
  findOnConflictTargets,
  REPO_ROOT,
} = await import("@/scripts/_lib/_lib.schema-parity.mjs");

/**
 * Partial and expression unique indexes are NOT valid ON CONFLICT targets
 * unless the clause repeats their predicate or expression, so
 * parseUniqueTargets excludes them and this list records the upserts that
 * legitimately rely on one. Empty today; it exists so a future case is a
 * conscious entry rather than a loosened assertion.
 */
const DELIBERATE_PARTIAL_INDEX_UPSERTS: string[] = [];

const SOURCE_ROOTS = ["lib", "app"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

const uniqueTargets = parseUniqueTargets(bootSchemaStatements()) as Map<
  string,
  Set<string>
>;

const files = [
  ...SOURCE_ROOTS.flatMap((dir) => sourceFiles(resolve(REPO_ROOT, dir))),
  resolve(REPO_ROOT, "instrumentation.ts"),
];

describe("ON CONFLICT parity with the boot schema", () => {
  it("parses unique targets for a plausible number of tables", () => {
    // Guard against a parser regression that finds nothing: with an empty
    // map every upsert below would be reported, so a silent no-op here
    // would show up as noise rather than as a false pass. The reverse guard
    // (finding no upserts at all) is the next test.
    expect(uniqueTargets.size).toBeGreaterThan(40);
    expect(uniqueTargets.get("users")?.has("email")).toBe(true);
    expect(uniqueTargets.get("scan_tags")?.has("scan_id,tag")).toBe(true);
  });

  it("finds the upserts it is supposed to be checking", () => {
    const total = files.reduce(
      (n, file) => n + findOnConflictTargets(readFileSync(file, "utf8")).length,
      0,
    );
    expect(total).toBeGreaterThan(30);
  });

  it("every ON CONFLICT target has a matching unique constraint", () => {
    const unmatched: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const target of findOnConflictTargets(source) as Array<{
        table: string;
        columns: string;
        line: number;
      }>) {
        const where = `${relative(REPO_ROOT, file).replace(/\\/g, "/")}:${target.line}`;
        if (DELIBERATE_PARTIAL_INDEX_UPSERTS.includes(where)) continue;
        const known = uniqueTargets.get(target.table);
        if (!known?.has(target.columns)) {
          unmatched.push(
            `${where} ON CONFLICT (${target.columns}) on ${target.table}` +
              (known ? ` -- unique targets: ${[...known].join(" | ")}` : ""),
          );
        }
      }
    }
    // A name here means that INSERT throws at runtime.
    expect(unmatched.sort()).toEqual([]);
  });
});
