// Client-side "is this a useful scan target" check for the popup. Mirrors the
// search-engine detection in the main repo's lib/scanner/scan-target-classify.ts
// (kept as a small copy because the extension is a separate build). The popup
// warns before scanning one of these, but never blocks -- the user can proceed.

const SEARCH_ENGINE_HOSTS = [
  "google.",
  "bing.com",
  "duckduckgo.com",
  "search.yahoo.com",
  "search.brave.com",
  "yandex.",
  "baidu.com",
  "ecosia.org",
  "startpage.com",
  "qwant.com",
  "ask.com",
  "search.aol.com",
];

const SEARCH_QUERY_PARAMS = ["q", "query", "p", "text", "wd", "kwd", "search"];

export interface TargetClassification {
  scannable: boolean;
  reason?: string;
}

function matchedSearchEngine(hostname: string): boolean {
  const h = hostname.toLowerCase();
  for (const s of SEARCH_ENGINE_HOSTS) {
    if (s.endsWith(".")) {
      if (h === s.slice(0, -1) || h.startsWith(s) || h.includes(`.${s}`)) {
        return true;
      }
    } else if (h === s || h.endsWith(`.${s}`)) {
      return true;
    }
  }
  return false;
}

/** Flags search engines / results pages as not-useful-to-scan. Everything else
 *  (including a malformed URL) returns scannable: true. */
export function classifyScanTarget(rawUrl: string): TargetClassification {
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return { scannable: true };
  }
  if (!matchedSearchEngine(u.hostname)) return { scannable: true };

  const isResultsPath = /\/search\b|\/results\b/i.test(u.pathname);
  const hasQuery = SEARCH_QUERY_PARAMS.some((p) => u.searchParams.has(p));
  return {
    scannable: false,
    reason:
      isResultsPath || hasQuery
        ? "This is a search engine results page, not a website. Scanning it checks the search engine, not whatever you searched for."
        : "This is a search engine, not a site you're likely trying to assess. Scanning it checks the search engine itself.",
  };
}
