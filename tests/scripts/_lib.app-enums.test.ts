import { describe, it, expect } from "vitest";
import { STAFF_ROLES } from "@/lib/config/client-constants";
import { BILLING_PLAN_LIMITS, TEAM_ROLES } from "@/lib/config/constants";
import { APP_ENUM_COLUMNS } from "../../scripts/_lib/_lib.app-enums.mjs";

/**
 * APP_ENUM_COLUMNS is a hand-maintained mirror of enum value sets that
 * have no DB-level CHECK constraint (see that file's header). This suite
 * cross-checks every entry that IS backed by a real exported TS constant
 * against that constant directly, so a future enum value added in code
 * but forgotten here fails a test instead of silently going stale.
 * subscription_status (Stripe's type) can't be cross-checked this way --
 * see the comment on that entry in the source file.
 */

function findEntry(table: string, column: string) {
  const entry = APP_ENUM_COLUMNS.find(
    (e) => e.table === table && e.column === column,
  );
  if (!entry)
    throw new Error(`No APP_ENUM_COLUMNS entry for ${table}.${column}`);
  return entry;
}

describe("APP_ENUM_COLUMNS matches real exported constants", () => {
  it("users.role matches STAFF_ROLES exactly", () => {
    const entry = findEntry("users", "role");
    const expected = Object.values(STAFF_ROLES).sort();
    expect([...entry.values].sort()).toEqual(expected);
  });

  it("users.plan matches BILLING_PLAN_LIMITS keys plus 'free'", () => {
    const entry = findEntry("users", "plan");
    const expected = Object.keys(BILLING_PLAN_LIMITS).sort();
    expect([...entry.values].sort()).toEqual(expected);
  });

  it("team_members.role matches TEAM_ROLES exactly", () => {
    const entry = findEntry("team_members", "role");
    const expected = Object.values(TEAM_ROLES).sort();
    expect([...entry.values].sort()).toEqual(expected);
  });

  it("every entry has a non-empty values array and a cited source", () => {
    for (const entry of APP_ENUM_COLUMNS) {
      expect(entry.values.length).toBeGreaterThan(0);
      expect(typeof entry.source).toBe("string");
      expect(entry.source.length).toBeGreaterThan(0);
      expect(typeof entry.table).toBe("string");
      expect(typeof entry.column).toBe("string");
      expect(typeof entry.nullable).toBe("boolean");
    }
  });
});
