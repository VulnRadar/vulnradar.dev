import { describe, it, expect } from "vitest";
import { diagnose } from "../../scripts/_lib/_lib.check-timestamps.mjs";
import { makeQueryRouterPool, containsAll } from "./_query-router-mock";

function ctxWith(
  tables: string[],
  columnsDetailed: Record<string, Array<{ name: string }>>,
  primaryKeys: Record<string, string[]>,
) {
  return {
    tables: new Set(tables),
    columnsDetailed,
    primaryKeys,
    foreignKeys: [],
    checkConstraintEnums: [],
  };
}

describe("timestamps", () => {
  it("flags updated_at before created_at, generically, for any table that has both columns", async () => {
    const ctx = ctxWith(
      ["widgets"],
      {
        widgets: [
          { name: "id" },
          { name: "created_at" },
          { name: "updated_at" },
        ],
      },
      { widgets: ["id"] },
    );
    const pool = makeQueryRouterPool([
      {
        match: containsAll("COUNT(*)", "updated_at < created_at"),
        handler: () => ({ rows: [{ n: 2 }] }),
      },
      {
        match: containsAll("updated_at < created_at", "LIMIT"),
        handler: () => ({ rows: [{ pk: 1 }] }),
      },
      {
        match: containsAll("COUNT(*)", "created_at > NOW()"),
        handler: () => ({ rows: [{ n: 0 }] }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    const f = findings.find((x) => x.column === "updated_at");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("needs-human");
    expect(f!.count).toBe(2);
  });

  it("flags a far-future created_at", async () => {
    const ctx = ctxWith(
      ["widgets"],
      { widgets: [{ name: "id" }, { name: "created_at" }] },
      { widgets: ["id"] },
    );
    const pool = makeQueryRouterPool([
      {
        match: containsAll("COUNT(*)", "created_at > NOW()"),
        handler: () => ({ rows: [{ n: 1 }] }),
      },
      {
        match: containsAll("created_at > NOW()", "LIMIT"),
        handler: () => ({ rows: [{ pk: 9 }] }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    const f = findings.find((x) => x.column === "created_at");
    expect(f).toBeDefined();
    expect(f!.count).toBe(1);
  });

  it("does not run the updated_at<created_at check on a table that only has created_at", async () => {
    const ctx = ctxWith(
      ["widgets"],
      { widgets: [{ name: "id" }, { name: "created_at" }] },
      { widgets: ["id"] },
    );
    const pool = makeQueryRouterPool([
      {
        match: containsAll("COUNT(*)", "created_at > NOW()"),
        handler: () => ({ rows: [{ n: 0 }] }),
      },
    ]);
    await diagnose(pool, ctx);
    // Only the future-timestamp query should have been issued.
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("skips a table with no primary key discoverable (defensive -- shouldn't happen in this schema, but must not crash)", async () => {
    const ctx = ctxWith(
      ["widgets"],
      { widgets: [{ name: "created_at" }, { name: "updated_at" }] },
      {}, // no PK entry for widgets at all
    );
    const pool = makeQueryRouterPool([]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("skips a table with neither timestamp column", async () => {
    const ctx = ctxWith(
      ["widgets"],
      { widgets: [{ name: "id" }, { name: "name" }] },
      { widgets: ["id"] },
    );
    const pool = makeQueryRouterPool([]);
    const { findings, meta } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(0);
    expect(meta.tablesChecked).toBe(0);
  });
});
