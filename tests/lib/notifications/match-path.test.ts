import { describe, it, expect } from "vitest";
import { matchesPathPattern } from "@/lib/notifications/match-path";

/**
 * matchesPathPattern is the fix for a real dead-column bug: admin
 * notifications have always saved a `path_pattern` ("Page Filter" in the
 * create dialog), but nothing ever read it back, on the server or the
 * client, so a banner/modal/toast/bell scoped to one page showed on every
 * page instead. This is a pure function (no DB/network), so no mocking is
 * needed.
 */
describe("matchesPathPattern", () => {
  it("matches every path when the pattern is null", () => {
    expect(matchesPathPattern("/dashboard", null)).toBe(true);
    expect(matchesPathPattern("/anything", null)).toBe(true);
  });

  it("matches every path when the pattern is undefined or empty", () => {
    expect(matchesPathPattern("/dashboard", undefined)).toBe(true);
    expect(matchesPathPattern("/dashboard", "")).toBe(true);
    expect(matchesPathPattern("/dashboard", "   ")).toBe(true);
  });

  it("matches an exact path", () => {
    expect(matchesPathPattern("/dashboard", "/dashboard")).toBe(true);
    expect(matchesPathPattern("/dashboard/settings", "/dashboard")).toBe(false);
  });

  it("supports a trailing wildcard", () => {
    expect(matchesPathPattern("/dashboard", "/dashboard*")).toBe(true);
    expect(matchesPathPattern("/dashboard/settings", "/dashboard*")).toBe(true);
    expect(matchesPathPattern("/history", "/dashboard*")).toBe(false);
  });

  it("does not treat a bare pattern as a prefix without a wildcard", () => {
    expect(matchesPathPattern("/dashboard/settings", "/dashboard")).toBe(false);
  });

  it("escapes regex-special characters in the pattern", () => {
    expect(matchesPathPattern("/plan?", "/plan?")).toBe(true);
    expect(matchesPathPattern("/planX", "/plan?")).toBe(false);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(matchesPathPattern("/dashboard", "  /dashboard  ")).toBe(true);
  });
});
