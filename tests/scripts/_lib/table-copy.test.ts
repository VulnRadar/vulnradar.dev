import { describe, it, expect } from "vitest";

/**
 * scripts/_lib/_lib.table-copy.mjs decides what `npm run db:create` copies
 * when it clones a database.
 *
 * The defect it exists to prevent (AUDIT-013 migrate-02) was a hardcoded
 * 30-entry list driving both the copy loop and the plan shown to the
 * operator: 33 of the 63 app tables were absent from it, so they were
 * never copied, never listed before the run, and never reported after it.
 * The tests below are about the two properties that make that impossible
 * to repeat: nothing with rows can fall out of the plan unnamed, and a
 * table nobody wrote down still gets copied.
 */
const { planTableCopy, orderTablesForCopy, TRANSIENT_TABLES } =
  await import("@/scripts/_lib/_lib.table-copy.mjs");

const counts = (entries: Record<string, number>) => entries;

describe("orderTablesForCopy", () => {
  it("puts a parent before its child", () => {
    const { order } = orderTablesForCopy(
      ["user_badges", "users", "badges"],
      [
        { childTable: "user_badges", parentTable: "users" },
        { childTable: "user_badges", parentTable: "badges" },
      ],
    );
    expect(order.indexOf("users")).toBeLessThan(order.indexOf("user_badges"));
    expect(order.indexOf("badges")).toBeLessThan(order.indexOf("user_badges"));
  });

  it("orders a chain transitively", () => {
    const { order } = orderTablesForCopy(
      ["support_ticket_messages", "users", "support_tickets"],
      [
        { childTable: "support_tickets", parentTable: "users" },
        {
          childTable: "support_ticket_messages",
          parentTable: "support_tickets",
        },
      ],
    );
    expect(order).toEqual([
      "users",
      "support_tickets",
      "support_ticket_messages",
    ]);
  });

  it("ignores a self-reference", () => {
    // A threaded/parent-id column constrains row order inside one table,
    // not table order. Treating it as an edge would make the table look
    // like an unsatisfiable cycle and push it to the end.
    const { order, cycles } = orderTablesForCopy(
      ["comments", "users"],
      [
        { childTable: "comments", parentTable: "comments" },
        { childTable: "comments", parentTable: "users" },
      ],
    );
    expect(cycles).toEqual([]);
    expect(order).toEqual(["users", "comments"]);
  });

  it("ignores edges to tables that are not being copied", () => {
    const { order, cycles } = orderTablesForCopy(
      ["webhooks"],
      [{ childTable: "webhooks", parentTable: "users" }],
    );
    expect(cycles).toEqual([]);
    expect(order).toEqual(["webhooks"]);
  });

  it("reports a genuine cycle instead of dropping the tables", () => {
    const { order, cycles } = orderTablesForCopy(
      ["a", "b", "z"],
      [
        { childTable: "a", parentTable: "b" },
        { childTable: "b", parentTable: "a" },
      ],
    );
    expect(cycles).toEqual(["a", "b"]);
    expect(order.sort()).toEqual(["a", "b", "z"]);
  });

  it("is deterministic and alphabetical where nothing constrains it", () => {
    expect(orderTablesForCopy(["c", "a", "b"], []).order).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("planTableCopy", () => {
  it("copies a table nobody wrote down anywhere", () => {
    // The whole point. system_settings, access_rules, webhooks and
    // host_badges were four of the 33 the old hardcoded list omitted.
    const plan = planTableCopy({
      sourceTables: ["users", "system_settings", "access_rules", "host_badges"],
      targetTables: ["users", "system_settings", "access_rules", "host_badges"],
      counts: counts({
        users: 50,
        system_settings: 12,
        access_rules: 3,
        host_badges: 7,
      }),
    });
    expect(plan.copy.map((t: { table: string }) => t.table).sort()).toEqual([
      "access_rules",
      "host_badges",
      "system_settings",
      "users",
    ]);
    expect(plan.unaccounted).toEqual([]);
  });

  it("classifies every source table that holds rows", () => {
    const plan = planTableCopy({
      sourceTables: ["users", "rate_limits", "legacy_thing", "empty_thing"],
      targetTables: ["users", "rate_limits"],
      counts: counts({
        users: 1,
        rate_limits: 900,
        legacy_thing: 4,
        empty_thing: 0,
      }),
    });
    expect(plan.copy.map((t: { table: string }) => t.table)).toEqual(["users"]);
    expect(plan.transient.map((t: { table: string }) => t.table)).toEqual([
      "rate_limits",
    ]);
    expect(plan.missingInTarget.map((t: { table: string }) => t.table)).toEqual(
      ["legacy_thing"],
    );
    expect(plan.empty).toEqual(["empty_thing"]);
    expect(plan.unaccounted).toEqual([]);
  });

  it("gives every skipped table a reason the operator can read", () => {
    const plan = planTableCopy({
      sourceTables: Object.keys(TRANSIENT_TABLES),
      targetTables: Object.keys(TRANSIENT_TABLES),
      counts: Object.fromEntries(
        Object.keys(TRANSIENT_TABLES).map((t) => [t, 5]),
      ),
    });
    expect(plan.copy).toEqual([]);
    expect(plan.transient).toHaveLength(Object.keys(TRANSIENT_TABLES).length);
    for (const entry of plan.transient) {
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it("never skips a transient table that the operator has no copy of", () => {
    // Every TRANSIENT_TABLES entry must be genuinely regenerable. A table
    // holding something an operator cannot recreate does not belong here,
    // and this list is short enough to check by name.
    expect(Object.keys(TRANSIENT_TABLES).sort()).toEqual([
      "cve_kev_cache",
      "email_2fa_codes",
      "email_verification_tokens",
      "password_reset_tokens",
      "rate_limits",
      "subdomain_cache",
    ]);
  });

  it("does not copy the migrator's own meta row", () => {
    // Step 4 writes it at the version the NEW database was built at;
    // copying the source's row would stamp the wrong version.
    const plan = planTableCopy({
      sourceTables: ["vulnradar_schema_meta", "users"],
      targetTables: ["vulnradar_schema_meta", "users"],
      counts: counts({ vulnradar_schema_meta: 1, users: 2 }),
    });
    expect(plan.copy.map((t: { table: string }) => t.table)).toEqual(["users"]);
    expect(plan.unaccounted).toEqual([]);
  });

  it("orders the copy from the target's foreign keys", () => {
    const plan = planTableCopy({
      sourceTables: ["user_badges", "badges", "users"],
      targetTables: ["user_badges", "badges", "users"],
      counts: counts({ user_badges: 3, badges: 6, users: 2 }),
      fkEdges: [
        { childTable: "user_badges", parentTable: "users" },
        { childTable: "user_badges", parentTable: "badges" },
      ],
    });
    expect(plan.copy.map((t: { table: string }) => t.table)).toEqual([
      "badges",
      "users",
      "user_badges",
    ]);
  });

  it("skips empty tables without calling them a loss", () => {
    const plan = planTableCopy({
      sourceTables: ["gone_in_v3"],
      targetTables: [],
      counts: counts({ gone_in_v3: 0 }),
    });
    expect(plan.missingInTarget).toEqual([]);
    expect(plan.empty).toEqual(["gone_in_v3"]);
  });

  it("treats a table with an unknown count as empty rather than copying blind", () => {
    const plan = planTableCopy({
      sourceTables: ["mystery"],
      targetTables: ["mystery"],
      counts: {},
    });
    expect(plan.copy).toEqual([]);
    expect(plan.empty).toEqual(["mystery"]);
  });
});
