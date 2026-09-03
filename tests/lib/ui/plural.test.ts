import { describe, it, expect } from "vitest";
import { plural, pluralize } from "@/lib/ui/plural";

/**
 * The bug this helper exists to stop: the teams list rendered "1 members" on
 * every one-person team. It had a plural rule, `count !== 1 ? "s" : ""`, and
 * the rule was correct; the count was the string "1", because GET
 * /api/v3/teams reads it from a COUNT(*) and node-postgres returns a bigint as
 * a string regardless of what the TypeScript type says. The coercion below is
 * the whole point, so it is what most of these assertions are about.
 */
describe("plural", () => {
  it("returns the singular for exactly one", () => {
    expect(plural(1, "member")).toBe("member");
  });

  it("returns the plural for zero and for more than one", () => {
    expect(plural(0, "member")).toBe("members");
    expect(plural(2, "member")).toBe("members");
    expect(plural(795, "check")).toBe("checks");
  });

  it("treats a numeric string the way it treats the number", () => {
    // The regression: "1" !== 1 under a strict comparison, so a Postgres
    // COUNT(*) of one took the plural branch.
    expect(plural("1", "member")).toBe("member");
    expect(plural("0", "member")).toBe("members");
    expect(plural("4", "member")).toBe("members");
  });

  it("uses an explicit plural form when the trailing s is wrong", () => {
    expect(plural(1, "entry", "entries")).toBe("entry");
    expect(plural(3, "entry", "entries")).toBe("entries");
  });

  it("pluralizes for a missing count rather than claiming one", () => {
    expect(plural(null, "member")).toBe("members");
    expect(plural(undefined, "member")).toBe("members");
  });
});

describe("pluralize", () => {
  it("puts the count in front of the right noun", () => {
    expect(pluralize(1, "member")).toBe("1 member");
    expect(pluralize(4, "member")).toBe("4 members");
    expect(pluralize(0, "finding")).toBe("0 findings");
  });

  it("prints a numeric string as a number", () => {
    expect(pluralize("1", "member")).toBe("1 member");
    expect(pluralize("12", "scan")).toBe("12 scans");
  });

  it("falls back to 0 for a count that is not a number", () => {
    expect(pluralize(undefined, "scan")).toBe("0 scans");
    expect(pluralize("not a number", "scan")).toBe("0 scans");
  });
});
