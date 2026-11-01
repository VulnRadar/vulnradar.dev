/**
 * The `ScanResult.incomplete` markers only a crawl can write.
 *
 * A crawl that stops before it has read every page it discovered still
 * completes: the pages it did read are real results, and throwing them away
 * because the budget ran out (which is what a watchdog failure did) costs the
 * owner a crawl's worth of quota for nothing. What it must not do is look
 * complete. These two markers are how a partial crawl says so: they land in
 * `result_meta.incomplete` beside the async-branch slugs, so the engine
 * confidence discount and the "did not finish" verdict apply to a short crawl
 * exactly as they do to a scan whose DNS branch timed out.
 *
 * Kept out of execute-crawl-scan.ts so the label map and the UI can import the
 * slugs without pulling the whole executor (and its database pool) with them,
 * the same split bot-challenge.ts makes for its own marker.
 */

/** The soft deadline stopped the crawl taking new pages. */
export const CRAWL_TIME_LIMIT_INCOMPLETE = "crawl-time-limit";

/** The daily scan quota ran out before every discovered page was read. */
export const CRAWL_QUOTA_LIMIT_INCOMPLETE = "crawl-quota-limit";

/**
 * Some crawled pages answered with a bot challenge while others were read.
 * Kept apart from "bot-challenge", which a CI gate treats as "nothing was
 * looked at" and fails on: that is true of a challenged main page or a crawl
 * where every page was challenged, not of one challenged page among many.
 */
export const CRAWL_PAGES_CHALLENGED_INCOMPLETE = "crawl-pages-challenged";

/**
 * Plain-language names, in the shape lib/scanner/incomplete-labels.ts uses.
 * Spread into INCOMPLETE_LABELS there; an unlabelled slug is shown as itself.
 */
export const CRAWL_INCOMPLETE_LABELS: Record<string, string> = {
  [CRAWL_TIME_LIMIT_INCOMPLETE]:
    "Some crawled pages (the crawl ran out of time)",
  [CRAWL_QUOTA_LIMIT_INCOMPLETE]:
    "Some crawled pages (your daily scan limit ran out)",
  [CRAWL_PAGES_CHALLENGED_INCOMPLETE]:
    "Some crawled pages (the site showed the scanner a bot challenge on them)",
};
