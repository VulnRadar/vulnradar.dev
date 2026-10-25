import { describe, it, expect } from "vitest";
import {
  hasUnreadPages,
  readOtherPages,
  unreachablePages,
  unreadPageCounts,
  unreadSummary,
} from "@/components/scanner/crawl-pages-utils";

/**
 * A crawl page the scanner never read must not be presented as a clean one.
 * crawl-pages-info.tsx cannot be imported into a suite (JSX is preserved), so
 * the decisions it makes live here and are pinned directly.
 */
const root = { url: "https://example.test/" };
const read = { url: "https://example.test/pricing" };
const blocked = { url: "https://example.test/account" };

describe("unreadPageCounts", () => {
  it("counts unreachable pages and skipped pages separately", () => {
    expect(
      unreadPageCounts({
        pagesSkipped: 4,
        pagesUnreachable: [
          { url: blocked.url, reason: "bot challenge" },
          { url: "https://example.test/x", reason: "timed out" },
        ],
      }),
    ).toEqual({ unreachable: 2, skipped: 4 });
  });

  it("treats a crawl stored before the fields existed as having none", () => {
    expect(unreadPageCounts({})).toEqual({ unreachable: 0, skipped: 0 });
  });

  it("ignores a skipped count that is not a positive number", () => {
    expect(unreadPageCounts({ pagesSkipped: -3 }).skipped).toBe(0);
    expect(unreadPageCounts({ pagesSkipped: Number.NaN }).skipped).toBe(0);
    expect(unreadPageCounts({ pagesSkipped: 2.9 }).skipped).toBe(2);
  });
});

describe("unreachablePages", () => {
  it("is the stored list, and [] for anything that is not a list", () => {
    const list = [{ url: blocked.url, reason: "bot challenge" }];
    expect(unreachablePages({ pagesUnreachable: list })).toBe(list);
    expect(unreachablePages({})).toEqual([]);
    // A stored value of the wrong shape must not take the result view down
    // with a .map on a string.
    expect(
      unreachablePages({
        pagesUnreachable: "oops" as unknown as {
          url: string;
          reason: string;
        }[],
      }),
    ).toEqual([]);
  });
});

describe("unreadSummary", () => {
  it("is null when every discovered page was read", () => {
    expect(unreadSummary({ pagesSkipped: 0, pagesUnreachable: [] })).toBeNull();
    expect(unreadSummary({})).toBeNull();
  });

  it("names pages that were not read before pages that were skipped", () => {
    expect(
      unreadSummary({
        pagesSkipped: 5,
        pagesUnreachable: [{ url: blocked.url, reason: "bot challenge" }],
      }),
    ).toBe("1 not read, 5 skipped");
  });

  it("omits whichever half is zero", () => {
    expect(unreadSummary({ pagesSkipped: 3 })).toBe("3 skipped");
    expect(
      unreadSummary({
        pagesUnreachable: [{ url: blocked.url, reason: "unreachable" }],
      }),
    ).toBe("1 not read");
  });
});

describe("hasUnreadPages", () => {
  it("is true if either half is non-zero", () => {
    expect(hasUnreadPages({ pagesSkipped: 1 })).toBe(true);
    expect(
      hasUnreadPages({ pagesUnreachable: [{ url: "u", reason: "r" }] }),
    ).toBe(true);
    expect(hasUnreadPages({})).toBe(false);
  });
});

describe("readOtherPages", () => {
  it("drops the root page, which the scan's own result already shows", () => {
    expect(readOtherPages([root, read], {})).toEqual([read]);
  });

  it("never lists an unreachable page among the results, even if it is still in `pages`", () => {
    // The crawl scanner is meant to keep such a page out of `pages`. If one
    // slips through it would render as "clean", the one label it cannot have.
    const out = readOtherPages([root, read, blocked], {
      pagesUnreachable: [{ url: blocked.url, reason: "bot challenge" }],
    });
    expect(out).toEqual([read]);
  });

  it("keeps a read page that merely has no findings", () => {
    // A clean page that WAS read is a result. Only unread pages are removed.
    const clean = { url: "https://example.test/about", findings_count: 0 };
    expect(readOtherPages([root, clean], {})).toEqual([clean]);
  });
});
