import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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

/**
 * The quota-bearing staff list against the canonical roles.
 *
 * `lib/rate-limiting/daily-limits.ts` keeps its own STAFF_ROLES array, which
 * `lib/billing/staff-plan.ts` also grants and revokes against. It is written
 * out rather than derived, and that is correct: it deliberately omits
 * `super_admin`, which gets a real elite_supporter plan grant instead of the
 * shared "staff" tag, and its order is pinned by staff-plan's SQL parameter
 * assertions.
 *
 * Being hand-written, it can go stale, and it has: `/docs/rate-limits` told
 * readers that three roles were exempt from daily quotas when seven are
 * resolved to the staff plan tag and none of them is exempt. This checks the
 * two things that must hold without pinning the exact contents.
 *
 * Asserted against the source text because importing the module pulls in the
 * database pool, which throws without DATABASE_URL in this tier. The same
 * technique the client/server split tests already use.
 */
describe("the daily-limit staff list", () => {
  const decl =
    readFileSync("lib/rate-limiting/daily-limits.ts", "utf8").match(
      /export const STAFF_ROLES[^;]+;/s,
    )?.[0] ?? "";
  const listed = (decl.match(/"[a-z_]+"/g) ?? []).map((s) => s.slice(1, -1));

  it("names only roles that actually exist", () => {
    expect(decl, "STAFF_ROLES not found in daily-limits.ts").not.toBe("");
    const canonical = new Set<string>(Object.values(STAFF_ROLES));
    for (const role of listed) {
      expect(
        canonical.has(role),
        `daily-limits lists "${role}", which is not a role in STAFF_ROLES. ` +
          `A role that no longer exists silently resolves nobody to the ` +
          `staff plan.`,
      ).toBe(true);
    }
  });

  it("covers every staff role except the two that are excluded on purpose", () => {
    // user is the absence of a staff role. super_admin is granted a real
    // elite_supporter plan by lib/billing/staff-plan.ts, so it never needs
    // the shared tag; daily-limits documents that at the declaration.
    const expected = Object.values(STAFF_ROLES)
      .filter(
        (role) => role !== STAFF_ROLES.USER && role !== STAFF_ROLES.SUPER_ADMIN,
      )
      .sort();

    expect(
      [...listed].sort(),
      "A staff role missing from daily-limits gets a free account's daily " +
        "quota despite being staff, and it drops out of the published list " +
        "on /docs/rate-limits, which renders this same array.",
    ).toEqual(expected);
  });
});
