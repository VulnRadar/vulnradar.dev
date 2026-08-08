import { describe, it, expect } from "vitest";
import { diagnose } from "../../scripts/_lib/_lib.check-json-shape.mjs";
import { makeQueryRouterPool, containsAll } from "./_query-router-mock";

function ctxWith(
  tables: string[],
  columnsDetailed: Record<string, Array<{ name: string; dataType: string }>>,
) {
  return {
    tables: new Set(tables),
    columnsDetailed,
    primaryKeys: { scan_history: ["id"] },
    foreignKeys: [],
    checkConstraintEnums: [],
  };
}

describe("json-shape", () => {
  it("counts json/jsonb columns across the schema for reporting, even with zero issues", async () => {
    const ctx = ctxWith(["scan_history"], {
      scan_history: [
        { name: "id", dataType: "integer" },
        { name: "findings", dataType: "jsonb" },
        { name: "summary", dataType: "jsonb" },
        { name: "response_headers", dataType: "jsonb" },
      ],
    });
    const pool = makeQueryRouterPool([
      {
        match: containsAll("findings"),
        handler: () => ({ rows: [{ pk: 1, value: [] }] }),
      },
      {
        match: containsAll("summary"),
        handler: () => ({ rows: [{ pk: 1, value: {} }] }),
      },
    ]);
    const { findings, meta } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(0);
    expect(meta.columnsInspected).toBe(3);
  });

  it("flags a findings value that isn't an array", async () => {
    const ctx = ctxWith(["scan_history"], {
      scan_history: [
        { name: "id", dataType: "integer" },
        { name: "findings", dataType: "jsonb" },
      ],
    });
    const pool = makeQueryRouterPool([
      {
        match: containsAll("findings"),
        handler: () => ({
          rows: [
            { pk: 1, value: { not: "an array" } },
            { pk: 2, value: [] },
          ],
        }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("needs-human"); // no safe substitute value
    expect(findings[0].count).toBe(1);
    expect(findings[0].examples[0].pk).toBe(1);
  });

  it("flags a summary value that isn't an object (e.g. an array or null)", async () => {
    const ctx = ctxWith(["scan_history"], {
      scan_history: [
        { name: "id", dataType: "integer" },
        { name: "summary", dataType: "jsonb" },
      ],
    });
    const pool = makeQueryRouterPool([
      {
        match: containsAll("summary"),
        handler: () => ({
          rows: [
            { pk: 1, value: [] },
            { pk: 2, value: null },
            { pk: 3, value: {} },
          ],
        }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].count).toBe(2);
  });

  it("skips gracefully when the hinted column doesn't exist on this schema", async () => {
    const ctx = ctxWith(["scan_history"], {
      scan_history: [{ name: "id", dataType: "integer" }], // no findings/summary at all (old schema)
    });
    const pool = makeQueryRouterPool([]); // any call is a bug
    const { findings, meta } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(0);
    expect(meta.columnsInspected).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
