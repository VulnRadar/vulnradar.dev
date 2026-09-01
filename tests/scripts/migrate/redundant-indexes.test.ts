import { describe, it, expect } from "vitest";

/**
 * The guard against adding an index the database already has.
 *
 * AUDIT-013#schema-05 found 27 indexes that could never be chosen: sixteen
 * duplicated a UNIQUE constraint outright and eleven were strict prefixes of
 * a wider index. Every one of them was maintained on every INSERT, UPDATE and
 * DELETE on tables written on nearly every request (rate_limits, api_usage,
 * scan_history, device_trust), for no read ever served.
 *
 * Most of them came from one wrong belief, written down next to the composite
 * indexes it produced: that a composite index on (A, B) is "additive, not a
 * replacement" for a single-column index on A. It is not.
 * A b-tree on (A, B) is fully usable for a filter on A alone, because
 * A is the leading column, so the single-column index is dead weight the
 * moment the composite exists.
 *
 * Nothing below is a hand-written list of names. Both checks are derived from
 * the parsed schema, so a duplicate added tomorrow fails this suite even
 * though nobody wrote it down. Running the same check against the migration
 * path as well as the boot path is what keeps a fix from landing on only one
 * of the two (see schema-parity.test.ts for why that matters).
 */
const parity = await import("@/scripts/_lib/_lib.schema-parity.mjs");
const { readBootSchema, buildMigrationSchema } = parity;

type Index = {
  name: string;
  unique: boolean;
  table: string;
  using: string | null;
  columns: string;
  where: string | null;
};
type Schema = { tables: Map<string, Set<string>>; indexes: Map<string, Index> };

const canonical = readBootSchema() as Schema;
const reachable = (await buildMigrationSchema()) as Schema;

/** Column list, without the per-column ASC/DESC that does not affect which
 *  prefixes a b-tree can serve. */
function columnsOf(index: Index): string[] {
  return index.columns.split(",").map((c) =>
    c
      .trim()
      .replace(/\s+(asc|desc)$/i, "")
      .toLowerCase(),
  );
}

/**
 * Every index whose columns are a strict leading prefix of another index on
 * the same table. Partial indexes (WHERE) are excluded on both sides: a
 * partial index covers a different row set, so neither can stand in for the
 * other on prefix grounds alone.
 */
function prefixDuplicates(schema: Schema): string[] {
  const all = [...schema.indexes.values()];
  const found: string[] = [];
  for (const narrow of all) {
    if (narrow.where) continue;
    for (const wide of all) {
      if (wide.name === narrow.name || wide.table !== narrow.table) continue;
      if (wide.where) continue;
      const a = columnsOf(narrow);
      const b = columnsOf(wide);
      if (a.length >= b.length) continue;
      if (a.every((c, i) => c === b[i])) {
        found.push(
          `${narrow.name}(${narrow.columns}) is a leading prefix of ${wide.name}(${wide.columns}) on ${narrow.table}`,
        );
      }
    }
  }
  return found.sort();
}

const WHY =
  "\nA b-tree index on (A, B) already serves every query that filters on A alone, so the narrower index can never be chosen and is maintained on every write for nothing. Delete the narrower one. If the wider index is the new arrival, delete the single-column index it supersedes rather than keeping both.";

describe("no index duplicates another index", () => {
  it("the boot schema creates no index that is a prefix of another", () => {
    expect(prefixDuplicates(canonical), WHY).toEqual([]);
  });

  it("the migration path creates no index that is a prefix of another", () => {
    // Same assertion against the schema a migrated database actually reaches.
    // The two paths are maintained separately, so a duplicate removed from one
    // and left in the other would otherwise survive here.
    expect(prefixDuplicates(reachable), WHY).toEqual([]);
  });

  it("no two indexes cover the same table and columns under different names", () => {
    // The other half of the same defect: two names, one shape. Cheap to check
    // and impossible to spot by reading the schema by hand.
    for (const schema of [canonical, reachable]) {
      const byShape = new Map<string, string[]>();
      for (const index of schema.indexes.values()) {
        const key = `${index.table}(${columnsOf(index).join(",")})${
          index.where ? ` WHERE ${index.where}` : ""
        }`;
        byShape.set(key, [...(byShape.get(key) ?? []), index.name]);
      }
      const collisions = [...byShape.entries()]
        .filter(([, names]) => names.length > 1)
        .map(([shape, names]) => `${shape}: ${names.sort().join(", ")}`)
        .sort();
      expect(collisions).toEqual([]);
    }
  });
});
