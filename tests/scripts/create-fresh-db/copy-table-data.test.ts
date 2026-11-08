import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import {
  copyTableData,
  verifyCopiedCounts,
} from "../../../scripts/create-fresh-db/copy-table-data.mjs";

/**
 * What db:create sends to the target, row by row. Proving Postgres accepts it
 * is tests/integration/db-create-copy.test.ts's job; this pins what the script
 * decides on its own: which columns are written and in what form a JSON value
 * leaves node-pg.
 */

interface Column {
  column_name: string;
  is_nullable?: string;
  data_type: string;
  column_default?: string | null;
  is_generated?: string;
}

interface QueryConfig {
  text: string;
  types?: {
    getTypeParser(oid: number, format: string): (v: string) => unknown;
  };
}

function column(
  name: string,
  dataType: string,
  extra: Partial<Column> = {},
): Column {
  return {
    column_name: name,
    is_nullable: "YES",
    data_type: dataType,
    column_default: null,
    is_generated: "NEVER",
    ...extra,
  };
}

/**
 * Answers the three things the copy asks: a table's columns, its rows, and
 * (for the verify step) a JSON type histogram.
 */
function fakePool(
  columns: Column[],
  rows: Record<string, unknown>[] = [],
  histogram: Record<string, Record<string, number>> = {},
) {
  const inserts: { sql: string; values: unknown[] }[] = [];
  const selects: QueryConfig[] = [];
  const pool = {
    inserts,
    selects,
    query: vi.fn(async (query: string | QueryConfig, values?: unknown[]) => {
      const text = typeof query === "string" ? query : query.text;
      if (text.includes("information_schema.columns")) {
        return { rows: columns };
      }
      if (text.startsWith("SELECT *")) {
        selects.push(query as QueryConfig);
        return { rows };
      }
      if (text.includes("COUNT(*)::int AS n FROM")) {
        return { rows: [{ n: rows.length }] };
      }
      const typeofMatch = /typeof\("(\w+)"\)/.exec(text);
      if (typeofMatch) {
        return {
          rows: Object.entries(histogram[typeofMatch[1]] ?? {}).map(
            ([json_type, n]) => ({ json_type, n }),
          ),
        };
      }
      if (text.trimStart().startsWith("INSERT")) {
        inserts.push({ sql: text, values: values ?? [] });
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text}`);
    }),
  };
  return pool;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generated columns", () => {
  const generated = column("share_token_hash", "text", {
    is_nullable: "NO",
    is_generated: "ALWAYS",
  });

  it("are left out of the INSERT, or every row of a 3.x table fails", async () => {
    const source = fakePool(
      [column("id", "integer"), column("share_token_hash", "text")],
      [{ id: 1, share_token_hash: "abc" }],
    );
    const target = fakePool([column("id", "integer"), generated]);
    await expect(
      copyTableData(source, target, "scan_history", 1),
    ).resolves.toBe(true);
    expect(target.inserts).toHaveLength(1);
    expect(target.inserts[0].sql).not.toContain("share_token_hash");
    expect(target.inserts[0].values).toEqual([1]);
  });

  it("do not count as a NOT NULL column the source cannot fill", async () => {
    const source = fakePool([column("id", "integer")], [{ id: 1 }]);
    const target = fakePool([column("id", "integer"), generated]);
    await expect(copyTableData(source, target, "host_badges", 1)).resolves.toBe(
      true,
    );
  });
});

describe("JSON columns", () => {
  async function copyValue(
    sourceType: string,
    targetType: string,
    value: unknown,
  ) {
    const source = fakePool([column("doc", sourceType)], [{ doc: value }]);
    const target = fakePool([column("doc", targetType)]);
    await copyTableData(source, target, "any_table", 1);
    return target.inserts[0]?.values[0];
  }

  it("reads json and jsonb as raw text and leaves every other type alone", async () => {
    const source = fakePool([column("doc", "jsonb")], [{ doc: "[]" }]);
    await copyTableData(source, fakePool([column("doc", "jsonb")]), "t", 1);
    const types = source.selects[0].types!;
    expect(types.getTypeParser(114, "text")('{"a": 1}')).toBe('{"a": 1}');
    expect(types.getTypeParser(3802, "text")("[]")).toBe("[]");
    expect(types.getTypeParser(23, "text")("7")).toBe(
      pg.types.getTypeParser(23, "text")("7"),
    );
  });

  it("passes an empty array through as JSON, in any table", async () => {
    await expect(copyValue("jsonb", "jsonb", "[]")).resolves.toBe("[]");
  });

  it("passes a populated array through as JSON text", async () => {
    await expect(copyValue("jsonb", "jsonb", '["scan:read"]')).resolves.toBe(
      '["scan:read"]',
    );
  });

  it("keeps a JSON null distinct from SQL NULL", async () => {
    await expect(copyValue("jsonb", "jsonb", "null")).resolves.toBe("null");
    await expect(copyValue("jsonb", "jsonb", null)).resolves.toBeNull();
  });

  it("does not round-trip a number JavaScript cannot hold", async () => {
    await expect(
      copyValue("jsonb", "jsonb", '{"id": 12345678901234567890}'),
    ).resolves.toBe('{"id": 12345678901234567890}');
  });

  it("normalises a v1 text column on its way into jsonb", async () => {
    await expect(copyValue("text", "jsonb", '{ "a":  1 }')).resolves.toBe(
      '{"a":1}',
    );
  });

  it("nulls invalid text bound for jsonb and says so", async () => {
    await expect(copyValue("text", "jsonb", "not json")).resolves.toBeNull();
  });

  it("stringifies a JavaScript array bound for json, the bug node-pg would turn into an array literal", async () => {
    await expect(copyValue("ARRAY", "json", ["a", "b"])).resolves.toBe(
      '["a","b"]',
    );
  });

  it("does not touch a plain text column that happens to hold non-JSON", async () => {
    await expect(copyValue("text", "text", "not json")).resolves.toBe(
      "not json",
    );
  });
});

describe("verifyCopiedCounts", () => {
  const columns = [column("id", "integer"), column("doc", "jsonb")];
  const oneRow = [{ id: 1 }];

  it("passes when counts and JSON types match", async () => {
    const source = fakePool(columns, oneRow, { doc: { array: 1 } });
    const target = fakePool(columns, oneRow, { doc: { array: 1 } });
    await expect(
      verifyCopiedCounts(source, target, [{ table: "t", count: 1 }]),
    ).resolves.toEqual([]);
  });

  it("catches an array that became an object with the row count intact", async () => {
    const source = fakePool(columns, oneRow, { doc: { array: 1 } });
    const target = fakePool(columns, oneRow, { doc: { object: 1 } });
    await expect(
      verifyCopiedCounts(source, target, [{ table: "t", count: 1 }]),
    ).resolves.toEqual([{ table: "t.doc (array)", expected: 1, got: 0 }]);
  });

  it("tolerates extra rows already in a reused target", async () => {
    const source = fakePool(columns, oneRow, { doc: { array: 1 } });
    const target = fakePool(columns, [{ id: 1 }, { id: 2 }], {
      doc: { array: 1, object: 1 },
    });
    await expect(
      verifyCopiedCounts(source, target, [{ table: "t", count: 1 }]),
    ).resolves.toEqual([]);
  });

  it("uses json_typeof for a json column", async () => {
    const jsonColumns = [column("doc", "json")];
    const source = fakePool(jsonColumns, oneRow, { doc: { array: 1 } });
    const target = fakePool(jsonColumns, oneRow, { doc: { array: 1 } });
    await verifyCopiedCounts(source, target, [{ table: "t", count: 1 }]);
    const sql = source.query.mock.calls.map(([q]) => String(q)).join("\n");
    expect(sql).toContain('json_typeof("doc")');
    expect(sql).not.toContain("jsonb_typeof");
  });

  it("skips a column the source held as text, which has no JSON type to compare", async () => {
    const source = fakePool([column("doc", "text")], oneRow);
    const target = fakePool([column("doc", "jsonb")], oneRow, {
      doc: { array: 1 },
    });
    await expect(
      verifyCopiedCounts(source, target, [{ table: "t", count: 1 }]),
    ).resolves.toEqual([]);
  });

  it("compares a renamed column under its new name", async () => {
    const source = fakePool([column("results", "jsonb")], oneRow, {
      results: { array: 1 },
    });
    const target = fakePool([column("findings", "jsonb")], oneRow, {
      findings: {},
    });
    await expect(
      verifyCopiedCounts(source, target, [{ table: "scan_history", count: 1 }]),
    ).resolves.toEqual([
      { table: "scan_history.findings (array)", expected: 1, got: 0 },
    ]);
  });

  it("still reports a table that came up short", async () => {
    const source = fakePool(columns, oneRow);
    const target = fakePool(columns, []);
    await expect(
      verifyCopiedCounts(source, target, [{ table: "t", count: 1 }]),
    ).resolves.toEqual([{ table: "t", expected: 1, got: 0 }]);
  });

  it("reports a failed check rather than passing it", async () => {
    const source = fakePool(columns, oneRow);
    const target = fakePool(columns, oneRow);
    target.query.mockRejectedValueOnce(new Error("boom"));
    const [shortfall] = await verifyCopiedCounts(source, target, [
      { table: "t", count: 1 },
    ]);
    expect(shortfall).toMatchObject({ table: "t", got: "error: boom" });
  });
});
