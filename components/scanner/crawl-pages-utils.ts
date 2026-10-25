/**
 * The pure half of components/scanner/crawl-pages-info.tsx.
 *
 * Split out as plain .ts for the reason components/history/history-filter-
 * utils.ts is: tsconfig sets "jsx": "preserve" for Next's own pipeline, which
 * vitest cannot parse, so a .tsx file cannot be imported from a test and
 * anything worth asserting has to live outside one.
 *
 * What it decides is which crawled pages count as READ. A crawl that could not
 * fetch a page, or that was handed a bot challenge instead of it, found nothing
 * on that page because it never saw it. Listing such a page beside the real
 * results with a green "clean" is the false all-clear the history rows already
 * refuse, so the unread pages are reported on their own terms.
 */

/** A page the crawl tried to read and could not (result_meta.crawl.pagesUnreachable). */
export interface UnreadablePage {
  url: string;
  reason: string;
}

export interface CrawlReadState {
  /** Pages discovered but never scanned: a page, time or quota limit. */
  pagesSkipped?: number;
  pagesUnreachable?: UnreadablePage[];
}

function unreachableOf(info: CrawlReadState): UnreadablePage[] {
  return Array.isArray(info.pagesUnreachable) ? info.pagesUnreachable : [];
}

/** How many pages the crawl failed to read, and how many it never reached. */
export function unreadPageCounts(info: CrawlReadState): {
  unreachable: number;
  skipped: number;
} {
  const skipped = Number(info.pagesSkipped);
  return {
    unreachable: unreachableOf(info).length,
    skipped: Number.isFinite(skipped) && skipped > 0 ? Math.floor(skipped) : 0,
  };
}

/** Whether there is anything to say about pages that were not read. */
export function hasUnreadPages(info: CrawlReadState): boolean {
  const { unreachable, skipped } = unreadPageCounts(info);
  return unreachable + skipped > 0;
}

/**
 * The one-line version for the collapsed header: "2 not read, 5 skipped", or
 * null when every discovered page was read.
 */
export function unreadSummary(info: CrawlReadState): string | null {
  const { unreachable, skipped } = unreadPageCounts(info);
  const parts: string[] = [];
  if (unreachable > 0) parts.push(`${unreachable} not read`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * The crawled pages that have a result to show, root excluded (the root page
 * is the scan's own result, shown above this list).
 *
 * An unreachable page is dropped even if it is still in `pages`: the crawl
 * scanner is meant to keep such a page out of that array, but if one slips
 * through it would render as "clean", which is the one thing it must never do.
 */
export function readOtherPages<T extends { url: string }>(
  pages: T[],
  info: CrawlReadState,
): T[] {
  const unreachable = new Set(unreachableOf(info).map((p) => p.url));
  return pages.slice(1).filter((page) => !unreachable.has(page.url));
}
