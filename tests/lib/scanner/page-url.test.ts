/**
 * What counts as the same page (lib/scanner/page-url.ts).
 *
 * A trailing slash is not a path. /landing and /landing/ are the same page on
 * every server that serves either, and a crawl that treated them as two
 * scanned the page twice, listed it twice and charged the quota twice. A query
 * string is a different matter: ?page=2 and ?page=3 are different pages.
 */
import { describe, it, expect } from "vitest";
import { canonicalPageUrl, isSamePageUrl } from "@/lib/scanner/page-url";
import { parseUrl } from "@/lib/ui/parse-url";

describe("canonicalPageUrl", () => {
  it("treats a path with and without its trailing slash as one page", () => {
    expect(
      isSamePageUrl(
        "https://example.com/landing",
        "https://example.com/landing/",
      ),
    ).toBe(true);
    expect(canonicalPageUrl("https://example.com/a/b/")).toBe(
      "https://example.com/a/b",
    );
  });

  it("treats the bare host and the root slash as one page", () => {
    expect(isSamePageUrl("https://example.com", "https://example.com/")).toBe(
      true,
    );
  });

  it("keeps the query, which does change the page", () => {
    expect(
      isSamePageUrl(
        "https://example.com/list?page=2",
        "https://example.com/list?page=3",
      ),
    ).toBe(false);
    expect(canonicalPageUrl("https://example.com/list/?page=2")).toBe(
      "https://example.com/list?page=2",
    );
  });

  it("drops the fragment, which never reaches the server", () => {
    expect(
      isSamePageUrl(
        "https://example.com/docs#install",
        "https://example.com/docs",
      ),
    ).toBe(true);
  });

  it("keeps a different host apart", () => {
    expect(
      isSamePageUrl("https://a.example.com/x", "https://b.example.com/x"),
    ).toBe(false);
  });

  it("hands back anything that is not a URL unchanged", () => {
    expect(canonicalPageUrl("not a url")).toBe("not a url");
  });
});

describe("how a URL reads", () => {
  it("shows no path for the root, with or without the slash", () => {
    expect(parseUrl("https://example.com/").full).toBe("example.com");
    expect(parseUrl("https://example.com").full).toBe("example.com");
  });

  it("shows a path without the slash on the end of it", () => {
    expect(parseUrl("https://example.com/landing/").full).toBe(
      "example.com/landing",
    );
    expect(parseUrl("https://example.com/landing").path).toBe("/landing");
  });

  it("still shows the query", () => {
    expect(parseUrl("https://example.com/list/?page=2").full).toBe(
      "example.com/list?page=2",
    );
  });
});
