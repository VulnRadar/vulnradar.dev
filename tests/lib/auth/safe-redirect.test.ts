/**
 * safeRedirect is the one gate between a `?redirect=` someone else wrote and
 * `router.push`. The router resolves its argument with `new URL()`, which
 * drops ASCII tab and newline and reads a backslash as a slash, so the check
 * has to judge the string the way the URL parser will rather than by its first
 * characters: `/<TAB>/evil.com` looks like a path and parses as `//evil.com`.
 */
import { describe, it, expect } from "vitest";
import { safeRedirect } from "@/lib/auth/safe-redirect";

const FALLBACK = "/dashboard";

describe("safeRedirect", () => {
  it.each([
    ["a tab between the slashes", "/\t/evil.com"],
    ["a line feed between the slashes", "/\n/evil.com"],
    ["a carriage return between the slashes", "/\r/evil.com"],
    ["a slash then a backslash", "/\\evil.com"],
    ["a backslash then a slash", "\\/evil.com"],
    ["a backslash later in the path", "/a\\b"],
    ["a protocol-relative URL", "//evil.com"],
    ["an absolute https URL", "https://evil.com"],
    ["an absolute URL to this path", "https://evil.com/dashboard"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,hi"],
    ["a NUL", "/\u0000/evil.com"],
    ["a DEL", "/\u007f/evil.com"],
    ["a leading space", " //evil.com"],
    ["a space inside", "/a b"],
    ["a no-break space", "/ /evil.com"],
    ["a path that does not start with a slash", "dashboard"],
    ["an empty string", ""],
  ])("refuses %s", (_label, value) => {
    expect(safeRedirect(value, FALLBACK)).toBe(FALLBACK);
  });

  it("refuses a value that is too long to be a path this app links to", () => {
    expect(safeRedirect(`/${"a".repeat(600)}`, FALLBACK)).toBe(FALLBACK);
  });

  it("refuses null and undefined", () => {
    expect(safeRedirect(null, FALLBACK)).toBe(FALLBACK);
    expect(safeRedirect(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it("keeps an encoded double slash as a same-origin path", () => {
    // `%2F%2F` is not decoded by the URL parser, so it stays one path segment
    // on this origin. The router never sees `//`.
    expect(safeRedirect("/%2F%2Fevil.com", FALLBACK)).toBe("/%2F%2Fevil.com");
    expect(safeRedirect("%2F%2Fevil.com", FALLBACK)).toBe(FALLBACK);
  });

  it.each([
    ["/dashboard", "/dashboard"],
    ["/history?page=2", "/history?page=2"],
    ["/scan/abc#finding-3", "/scan/abc#finding-3"],
    ["/history?q=a%20b&page=2#top", "/history?q=a%20b&page=2#top"],
  ])("keeps %s", (value, expected) => {
    expect(safeRedirect(value, FALLBACK)).toBe(expected);
  });

  it("returns the path the browser will land on, not the raw string", () => {
    expect(safeRedirect("/a/../settings", FALLBACK)).toBe("/settings");
  });

  it("never returns anything the router could read as another origin", () => {
    const inputs = [
      "/\t/evil.com",
      "/\\evil.com",
      "//evil.com",
      "/.//evil.com",
      "/..//evil.com",
      "/%2F%2Fevil.com",
      "https://evil.com",
    ];
    for (const value of inputs) {
      const out = safeRedirect(value, FALLBACK);
      expect(new URL(out, "https://app.example/login").origin).toBe(
        "https://app.example",
      );
    }
  });
});
