/**
 * Classifies a scan target for the two "heads up" cases the UI warns about:
 *  - a URL that isn't a meaningful target (a search engine / search results
 *    page), warned about BEFORE scanning, and
 *  - a scan that got redirected away from the page the user asked for (e.g. a
 *    page behind a login), classified AFTER the fetch and stored on the result.
 *
 * Pure and client-safe (no DB or server-only imports) so the web app's scan
 * form and result views import it directly. The browser extension keeps its own
 * small copy of classifyScanTarget (it's a separate build).
 */

// Known search engines. Scanning a search results page tells you about the
// search engine, not whatever was searched for, so we warn first. Entries
// ending in "." match the whole family (google.com, google.co.uk, ...).
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

// Params a search engine puts the user's query in.
const SEARCH_QUERY_PARAMS = ["q", "query", "p", "text", "wd", "kwd", "search"];

export interface TargetClassification {
  /** false when we'd warn before scanning. The user can still choose to proceed. */
  scannable: boolean;
  category?: "search-engine";
  /** One-line, human-readable reason for the warning UI. */
  reason?: string;
}

function matchedSearchEngine(hostname: string): boolean {
  const h = hostname.toLowerCase();
  for (const s of SEARCH_ENGINE_HOSTS) {
    if (s.endsWith(".")) {
      // family match: "google." -> google.com, www.google.co.uk
      if (h === s.slice(0, -1) || h.startsWith(s) || h.includes(`.${s}`)) {
        return true;
      }
    } else if (h === s || h.endsWith(`.${s}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Flags URLs that aren't useful scan targets (currently: search engines and
 * their results pages). Returns { scannable: true } for everything else,
 * including a malformed URL -- the normal validator handles those.
 */
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
  if (isResultsPath || hasQuery) {
    return {
      scannable: false,
      category: "search-engine",
      reason:
        "This is a search engine results page, not a website. Scanning it checks the search engine, not whatever you searched for.",
    };
  }
  return {
    scannable: false,
    category: "search-engine",
    reason:
      "This is a search engine, not a site you're likely trying to assess. Scanning it checks the search engine itself.",
  };
}

// ---- Redirect classification (server-side; stored on the result) ----

export type ScanRedirectKind = "login" | "other";

export interface ScanRedirectInfo {
  /** The URL the user asked to scan. */
  requestedUrl: string;
  /** The URL the scan actually landed on after following same-host redirects. */
  finalUrl: string;
  kind: ScanRedirectKind;
  /** One-line, human-readable explanation for the warning UI. */
  reason: string;
}

const LOGIN_PATH_RE =
  /(?:^|\/)(?:log[-_]?in|sign[-_]?in|signon|sso|auth(?:enticate|orize)?|account\/login|users\/sign_in|session\/new|oauth)(?:\/|$)/i;
const RETURN_PARAM_RE =
  /(?:^|[?&])(?:next|redirect|redirect_uri|return|returnurl|returnto|continue|rd|ref)=/i;

/**
 * Given the URL asked for and the URL actually landed on (after following the
 * same-host redirects safeFetch permits), decide whether it's worth warning
 * about and how. Returns null when they're effectively the same page.
 */
export function classifyRedirect(
  requestedUrl: string,
  finalUrl: string,
): ScanRedirectInfo | null {
  let req: URL;
  let fin: URL;
  try {
    req = new URL(requestedUrl);
    fin = new URL(finalUrl);
  } catch {
    return null;
  }
  // Ignore trivial differences: trailing slash and http/https on the same
  // host+path+query are not a redirect worth mentioning.
  const norm = (x: URL) =>
    `${x.hostname}${x.pathname.replace(/\/+$/, "")}${x.search}`.toLowerCase();
  if (norm(req) === norm(fin)) return null;

  const looksLikeLogin =
    LOGIN_PATH_RE.test(fin.pathname) || RETURN_PARAM_RE.test(fin.search);

  if (looksLikeLogin) {
    return {
      requestedUrl,
      finalUrl,
      kind: "login",
      reason:
        "The page you asked for redirected to what looks like a login page, so it's likely behind a sign-in. This scan is of the login page, not the page you wanted.",
    };
  }
  return {
    requestedUrl,
    finalUrl,
    kind: "other",
    reason:
      "The page you asked for redirected elsewhere, so this scan is of the page it landed on, not the exact URL you entered.",
  };
}
