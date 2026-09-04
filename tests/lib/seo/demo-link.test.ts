/**
 * Tests for lib/seo/demo-link.ts, the link the SEO pages' scan field builds.
 *
 * Roughly 780 organic pages (754 check pages, 18 category pages,
 * /alternatives and its five comparisons, /tools and its two, plus the three
 * indexes) close by telling the reader to scan their site, and
 * /tools/api-scanner says "paste an API URL" three times. None of them had a
 * field to paste into: the call to action was two links. /demo has always
 * read ?url=, so this function is the missing half of a route that worked.
 */
import { describe, it, expect } from "vitest";
import { demoScanHref } from "@/lib/seo/demo-link";
import { ROUTES } from "@/lib/config/client-constants";

describe("demoScanHref", () => {
  it("builds the /demo link the demo page already reads", () => {
    expect(demoScanHref("example.com")).toBe(`${ROUTES.DEMO}?url=example.com`);
    expect(demoScanHref("example.com")).toBe("/demo?url=example.com");
  });

  it("encodes a full URL so the path and query survive the round trip", () => {
    const href = demoScanHref("https://example.com/a?b=c&d=e");
    expect(href).toBe(
      "/demo?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc%26d%3De",
    );
    // What /demo reads back is what was typed, not a truncated prefix.
    expect(new URL(href!, "http://localhost").searchParams.get("url")).toBe(
      "https://example.com/a?b=c&d=e",
    );
  });

  it("encodes a value that would otherwise smuggle in a second parameter", () => {
    const href = demoScanHref("example.com&admin=1");
    expect(href).not.toContain("&admin=1");
    expect(new URL(href!, "http://localhost").searchParams.get("admin")).toBe(
      null,
    );
  });

  it("trims surrounding whitespace from a paste", () => {
    expect(demoScanHref("  example.com \n")).toBe("/demo?url=example.com");
  });

  it("returns null for an empty or whitespace-only field", () => {
    expect(demoScanHref("")).toBeNull();
    expect(demoScanHref("   ")).toBeNull();
  });

  it("returns null for a paste far too long to be a target", () => {
    expect(demoScanHref("a".repeat(501))).toBeNull();
  });

  it("does not rewrite or validate the target itself", () => {
    // /demo prepends the scheme and the scan API owns the allowlist, the
    // blocklist, the rebinding guard and the rate limit. A second, weaker
    // copy of those rules here could only disagree with the real ones.
    expect(demoScanHref("http://10.0.0.1")).toBe(
      "/demo?url=http%3A%2F%2F10.0.0.1",
    );
  });
});
