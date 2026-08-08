import { describe, it, expect } from "vitest";
import { diagnose } from "../../scripts/_lib/_lib.check-cross-column.mjs";
import { makeQueryRouterPool, containsAll } from "./_query-router-mock";

function ctxWith(
  tables: string[],
  columnsDetailed: Record<string, Array<{ name: string }>>,
) {
  return {
    tables: new Set(tables),
    columnsDetailed,
    primaryKeys: {},
    foreignKeys: [],
    checkConstraintEnums: [],
  };
}

describe("cross-column: disabled users with a surviving session", () => {
  const ctx = ctxWith(["users", "sessions"], {
    users: [{ name: "id" }, { name: "disabled_at" }],
    sessions: [{ name: "user_id" }],
  });

  it("is auto-fixable via DELETE, matching the disable action's own cleanup", async () => {
    const pool = makeQueryRouterPool([
      {
        match: containsAll("COUNT(*)", "sessions"),
        handler: () => ({ rows: [{ n: 2 }] }),
      },
      {
        match: containsAll("s.user_id AS pk", "sessions"),
        handler: () => ({ rows: [{ pk: 5 }] }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    const f = findings.find((x) => x.table === "sessions");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("auto-fixable");
    expect(f!.repair?.sql).toContain("DELETE FROM sessions");
    expect(f!.count).toBe(2);
  });

  it("skips when the sessions table has no user_id column", async () => {
    const noSessionsUserId = ctxWith(["users", "sessions"], {
      users: [{ name: "id" }, { name: "disabled_at" }],
      sessions: [{ name: "id" }],
    });
    const pool = makeQueryRouterPool([]);
    const { findings } = await diagnose(pool, noSessionsUserId);
    expect(findings.find((x) => x.table === "sessions")).toBeUndefined();
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("cross-column: stripe_subscription_id without stripe_customer_id", () => {
  const ctx = ctxWith(["users"], {
    users: [
      { name: "id" },
      { name: "stripe_subscription_id" },
      { name: "stripe_customer_id" },
    ],
  });

  it("is needs-human (requires a Stripe lookup, not a guess)", async () => {
    const pool = makeQueryRouterPool([
      {
        match: containsAll("COUNT(*)", "stripe_subscription_id IS NOT NULL"),
        handler: () => ({ rows: [{ n: 1 }] }),
      },
      {
        match: containsAll("id AS pk", "stripe_subscription_id IS NOT NULL"),
        handler: () => ({ rows: [{ pk: 3 }] }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    const f = findings.find((x) => x.column === "stripe_customer_id");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("needs-human");
    expect(f!.repair).toBeUndefined();
  });
});

describe("cross-column: active-looking subscription_status with no stripe_subscription_id", () => {
  const ctx = ctxWith(["users", "gifted_subscriptions"], {
    users: [
      { name: "id" },
      { name: "subscription_status" },
      { name: "stripe_subscription_id" },
    ],
    gifted_subscriptions: [
      { name: "user_id" },
      { name: "revoked_at" },
      { name: "expires_at" },
    ],
  });

  it("flags a user with no active gift as needs-human", async () => {
    const pool = makeQueryRouterPool([
      {
        match: containsAll("COUNT(*)", "subscription_status IN"),
        handler: () => ({ rows: [{ n: 1 }] }),
      },
      {
        match: containsAll("u.id AS pk", "subscription_status IN"),
        handler: () => ({ rows: [{ pk: 11, value: "active" }] }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    const f = findings.find((x) => x.column === "subscription_status");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("needs-human");
    expect(f!.description).toContain("gifted subscription");
  });

  it("excludes users with a currently-active gift from the query itself (anti-join in the WHERE clause)", async () => {
    // The check builds ONE query with a NOT EXISTS(...) gift anti-join
    // baked in -- there's no separate "is this user gifted" query to
    // mock, so this test just proves the SQL text includes the guard
    // rather than asserting on row-level filtering (which would require
    // a real Postgres to evaluate the NOT EXISTS subquery).
    let capturedSql = "";
    const pool = makeQueryRouterPool([
      {
        match: containsAll("subscription_status IN"),
        handler: (sql: string) => {
          capturedSql = sql;
          return { rows: [{ n: 0 }] };
        },
      },
    ]);
    await diagnose(pool, ctx);
    expect(capturedSql).toContain("gifted_subscriptions");
    expect(capturedSql).toContain("NOT EXISTS");
  });

  it("skips entirely when gifted_subscriptions doesn't exist on this schema", async () => {
    const noGiftTable = ctxWith(["users"], {
      users: [
        { name: "id" },
        { name: "subscription_status" },
        { name: "stripe_subscription_id" },
      ],
    });
    const pool = makeQueryRouterPool([]);
    const { findings } = await diagnose(pool, noGiftTable);
    expect(
      findings.find((x) => x.column === "subscription_status"),
    ).toBeUndefined();
  });
});
