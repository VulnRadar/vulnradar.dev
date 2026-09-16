import { describe, it, expect } from "vitest";
import { VALUE_SET_CHECKS } from "@/lib/database/schema/04-constraints.mjs";

/**
 * The CHECK constraints in VALUE_SET_CHECKS restate, in SQL, value sets that
 * TypeScript already declares as unions. Two declarations of one fact, in two
 * languages, neither of which can see the other.
 *
 * That is not a reason to drop the constraint - the type only binds code that
 * imports it, and a raw UPDATE, a migration or a future writer that builds the
 * string by hand reaches the column without ever meeting the union. It is a
 * reason to pin them together, which is what this does. A value added to one
 * side and not the other fails here rather than in whichever direction the
 * mismatch happens to bite: a rejected INSERT if SQL is the narrower one, or a
 * value the app cannot represent sitting in a column if it is the wider.
 *
 * Only the sets with a real single-source counterpart are pinned. users.role
 * deliberately permits `beta_tester`, which STAFF_ROLES does not contain, and
 * that gap is tracked separately rather than papered over by loosening this.
 */

function valuesFor(name: string): string[] {
  const entry = VALUE_SET_CHECKS.find(
    (c: { name: string }) => c.name === name,
  ) as { expr: string } | undefined;
  if (!entry) throw new Error(`No VALUE_SET_CHECKS entry named ${name}`);
  const inList = entry.expr.match(/IN \(([^)]*)\)/);
  if (!inList)
    throw new Error(`Could not parse an IN list from: ${entry.expr}`);
  return inList[1]
    .split(",")
    .map((v) => v.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

describe("VALUE_SET_CHECKS agree with the TypeScript unions they restate", () => {
  it("scan_history.status matches ScanJobStatus", async () => {
    // ScanJobStatus is a type, so it cannot be read at runtime. The four
    // values are asserted literally here and the assertion below ties this
    // list to the SQL; lib/scanner/types.ts is the other half and is what a
    // reader should change first.
    const SCAN_JOB_STATUS = ["pending", "running", "completed", "failed"];
    expect(valuesFor("scan_history_status_check").sort()).toEqual(
      [...SCAN_JOB_STATUS].sort(),
    );
  });

  it("team_members and team_invites both match TEAM_ROLES", async () => {
    const { TEAM_ROLES } = await import("@/lib/config/client-constants");
    const expected = Object.values(TEAM_ROLES).sort();
    expect(valuesFor("team_members_role_check").sort()).toEqual(expected);
    expect(valuesFor("team_invites_role_check").sort()).toEqual(expected);
  });

  it("every entry is a well-formed IN list on a named table", () => {
    for (const chk of VALUE_SET_CHECKS as Array<{
      table: string;
      name: string;
      expr: string;
    }>) {
      expect(chk.table).toMatch(/^[a-z_]+$/);
      expect(chk.name.startsWith(chk.table)).toBe(true);
      expect(valuesFor(chk.name).length).toBeGreaterThan(0);
    }
  });
});
