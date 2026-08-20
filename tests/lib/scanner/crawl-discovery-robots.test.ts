import { describe, it, expect } from "vitest";
import { parseRobots, isPathDisallowed } from "@/lib/scanner/crawl-discovery";

// The crawler's User-Agent string. parseRobots matches a group's User-agent
// token as a case-insensitive substring of this.
const UA = "VulnRadar/1.0 (Crawler)";

describe("parseRobots — Disallow rules scoped to VulnRadar", () => {
  it("applies Disallow from a group that names VulnRadar", () => {
    const robots = `User-agent: VulnRadar\nDisallow: /checks\n`;
    const { disallows } = parseRobots(robots, UA);
    expect(disallows).toEqual(["/checks"]);
  });

  it("IGNORES the blanket * group, so a site's generic bot rules never fence the scanner out", () => {
    const robots = `User-agent: *\nDisallow: /\nDisallow: /admin\n`;
    const { disallows } = parseRobots(robots, UA);
    expect(disallows).toEqual([]);
  });

  it("matches the User-agent token case-insensitively", () => {
    const robots = `User-agent: vulnradar\nDisallow: /checks\n`;
    expect(parseRobots(robots, UA).disallows).toEqual(["/checks"]);
  });

  it("keeps groups separate: a * group's rules don't leak into a following VulnRadar group", () => {
    const robots = [
      "User-agent: *",
      "Disallow: /secret",
      "",
      "User-agent: VulnRadar",
      "Disallow: /checks",
    ].join("\n");
    // Only the VulnRadar group's rule applies; /secret (from *) is ignored.
    expect(parseRobots(robots, UA).disallows).toEqual(["/checks"]);
  });

  it("collects rules from a group that lists VulnRadar alongside other agents", () => {
    const robots = [
      "User-agent: SomeOtherBot",
      "User-agent: VulnRadar",
      "Disallow: /checks",
      "Disallow: /internal",
    ].join("\n");
    expect(parseRobots(robots, UA).disallows).toEqual(["/checks", "/internal"]);
  });

  it("returns no disallows when no group names VulnRadar (never over-blocks a scan)", () => {
    const robots = `User-agent: Googlebot\nDisallow: /nogoogle\n`;
    expect(parseRobots(robots, UA).disallows).toEqual([]);
  });

  it("still extracts Sitemap: directives (global, not group-scoped)", () => {
    const robots = [
      "Sitemap: https://example.com/sitemap.xml",
      "User-agent: *",
      "Disallow: /x",
    ].join("\n");
    expect(parseRobots(robots, UA).sitemaps).toEqual([
      "https://example.com/sitemap.xml",
    ]);
  });

  it("ignores comments and an empty Disallow (which means allow-all)", () => {
    const robots = [
      "User-agent: VulnRadar # our scanner",
      "Disallow:", // empty = no restriction
      "Disallow: /checks",
    ].join("\n");
    expect(parseRobots(robots, UA).disallows).toEqual(["/checks"]);
  });
});

describe("isPathDisallowed — robots path matching", () => {
  it("prefix-matches, so /checks covers the index, per-check, and category pages", () => {
    const d = ["/checks"];
    expect(isPathDisallowed("/checks", d)).toBe(true);
    expect(isPathDisallowed("/checks/xss-reflected", d)).toBe(true);
    expect(isPathDisallowed("/checks/category/injection", d)).toBe(true);
  });

  it("does not match unrelated paths", () => {
    const d = ["/checks"];
    expect(isPathDisallowed("/dashboard", d)).toBe(false);
    expect(isPathDisallowed("/", d)).toBe(false);
    // A different path that merely starts with the same letters is NOT matched
    // as a path segment, but robots.txt is prefix-based, so this DOES match by
    // spec. Documented here so the behavior is intentional, not surprising.
    expect(isPathDisallowed("/checkspecial", d)).toBe(true);
  });

  it("honors the $ end-anchor", () => {
    expect(isPathDisallowed("/checks", ["/checks$"])).toBe(true);
    expect(isPathDisallowed("/checks/xss", ["/checks$"])).toBe(false);
  });

  it("honors a * wildcard", () => {
    expect(isPathDisallowed("/a/b/private", ["/a/*/private"])).toBe(true);
    expect(isPathDisallowed("/a/b/public", ["/a/*/private"])).toBe(false);
  });

  it("empty disallow list never blocks anything", () => {
    expect(isPathDisallowed("/checks", [])).toBe(false);
  });
});
