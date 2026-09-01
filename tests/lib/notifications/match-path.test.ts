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

/**
 * The matcher used to compile the admin's pattern into a regex, replacing
 * each `*` with `.*`. That is the classic catastrophic-backtracking shape,
 * and this function runs in every visitor's browser on every route change.
 * It is now a linear greedy walk, so these pin both the semantics (which
 * must not change) and the absence of the blow-up.
 */
describe("matchesPathPattern: wildcard semantics and cost", () => {
  it("supports a leading and a middle wildcard", () => {
    expect(matchesPathPattern("/a/dashboard", "*dashboard")).toBe(true);
    expect(
      matchesPathPattern("/dashboard/x/settings", "/dashboard*settings"),
    ).toBe(true);
    expect(
      matchesPathPattern("/dashboard/x/other", "/dashboard*settings"),
    ).toBe(false);
  });

  it("keeps both ends anchored", () => {
    expect(matchesPathPattern("/x/dashboard/y", "/dashboard*")).toBe(false);
    expect(matchesPathPattern("/x/dashboard/y", "*dashboard")).toBe(false);
  });

  it("matches a bare wildcard and collapsed wildcards", () => {
    expect(matchesPathPattern("/anything/at/all", "*")).toBe(true);
    expect(matchesPathPattern("/a/b/c", "/a**c")).toBe(true);
  });

  it("does not match when the anchors overlap on a too-short path", () => {
    expect(matchesPathPattern("/ab", "/abc*/xyz")).toBe(false);
  });

  it("returns promptly on the pattern shape that used to backtrack exponentially", () => {
    const evil = "/" + "a*".repeat(20) + "b";
    const path = "/" + "a".repeat(60);
    const started = Date.now();
    expect(matchesPathPattern(path, evil)).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
  });
});
