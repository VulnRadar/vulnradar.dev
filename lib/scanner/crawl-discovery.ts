/**
 * Shared same-origin page discovery for the two crawl pipelines.
 *
 * Both the background crawl job (lib/scanner/execute-crawl-scan.ts) and the
 * page-picker endpoint (app/api/v3/scan/crawl/discover/route.ts) call this, so
 * the picker surfaces exactly the pages a later scan would crawl. Two URL
 * sources feed one deduped set:
 *
 *   1. The site's sitemap: /sitemap.xml, any Sitemap: directive in
 *      /robots.txt, and (when the sitemap is an INDEX) its child sitemaps.
 *      These URLs are LISTED without being fetched, so a sitemap that names
 *      hundreds of pages costs only a handful of document fetches.
 *   2. A depth-bounded link crawl from the entry page, so a page discovered at
 *      depth 1 (say /docs) is itself crawled for its own children (/docs/x),
 *      not treated as a dead end.
 *
 * Every hop goes through safeFetch (SSRF-safe) pinned to the entry hostname,
 * so a redirect can never walk off-host and no subdomain or cross-host URL
 * ever enters the set. Sitemap handling is best-effort: any failure degrades
 * to link-crawling only and never throws.
 */
import { safeFetch } from "./safe-fetch";
import { APP_NAME } from "@/lib/config/constants";
import type { ScanSessionBinding } from "./auth/types";

/**
 * How deep the link crawl follows links from the entry page. Depth 0 is the
 * entry URL, depth 1 its direct links, and so on. A local constant, not a
 * runtime setting: it is a structural crawl invariant (a discovered page must
 * be crawled for ITS links too), and the page cap plus the fetch budget below
 * already govern volume.
 */
export const CRAWL_MAX_DEPTH = 3;

/**
 * Hard cap on how many pages the link crawl actually FETCHES to extract links,
 * independent of how many URLs end up listed. Sitemap-listed URLs do not count
 * against this: they are cheap because they are read from a sitemap, not
 * fetched. This keeps an interactive discovery request responsive even when
 * the return cap (maxPages) is large.
 */
const MAX_LINK_CRAWL_FETCHES = 30;

/**
 * How many of a single page's links get enqueued for their OWN link crawl.
 * Every same-origin link is still LISTED; this only bounds how much of the
 * fetch budget one hub page may consume, so the budget spreads across depth
 * instead of being spent entirely on the entry page's direct links.
 */
const MAX_ENQUEUE_PER_PAGE = 12;

/** At most this many sitemap documents (the index plus its children). */
const MAX_SITEMAP_DOCUMENTS = 10;
/** How much of a sitemap document is read before parsing stops. */
const SITEMAP_BODY_MAX_BYTES = 4 * 1024 * 1024;

const SKIP_EXTENSIONS =
  /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|mjs|cjs|woff2?|ttf|eot|otf|pdf|zip|tar|gz|mp4|mp3|wav|ogg|webm|avif|map|xml|rss|atom|json|wasm|txt)$/i;
// The sitemap and robots files are URL SOURCES, not scan targets, so a URL
// that points AT one is excluded from the listed page set here even though the
// crawler reads them for links.
const SKIP_PATH_SEGMENTS =
  /(\/_next\/|\/static\/|\/assets\/|\/api\/|\/favicon|\/robots\.txt|\/sitemap|\/manifest|\/sw\.js|\/workbox)/i;

export interface CrawlDiscoverySettings {
  /** Maximum URLs to return (the listed/scannable page cap). */
  maxPages: number;
  /** Per-page fetch abort timeout in ms. */
  fetchTimeoutMs: number;
  /** Bytes read from a page body before link extraction stops. */
  maxBodySize: number;
  /** Overrides CRAWL_MAX_DEPTH when set. */
  maxDepth?: number;
}

function isCleanUrl(href: string): boolean {
  // Skip anything with encoded brackets, regex-like patterns, or non-printable chars
  if (
    /[%[\]{}|\\^`<>]/.test(href) &&
    /%5[bBdD]|%5[eE]|%7[bBdD]|%3[eE]|%3[cC]/.test(href)
  )
    return false;
  if (href.startsWith("data:")) return false;
  if (!href || href === "#" || href.startsWith("#")) return false;
  if (
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    href.startsWith("javascript:") ||
    href.startsWith("vbscript:")
  )
    return false;
  return true;
}

/** A same-origin http(s) URL that is a real scan target (not an asset/api/sitemap). */
function isSameOriginPageUrl(resolved: URL, entryHostname: string): boolean {
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:")
    return false;
  if (resolved.hostname !== entryHostname) return false;
  const fullPath = resolved.pathname + resolved.search;
  if (SKIP_PATH_SEGMENTS.test(fullPath)) return false;
  if (SKIP_EXTENSIONS.test(resolved.pathname)) return false;
  return true;
}

/** Drop the hash, keep origin + path + query. */
function normalizePageUrl(u: URL): string {
  return u.origin + u.pathname + u.search;
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        const overshoot = totalBytes - maxBytes;
        const trimmed = value.slice(0, value.byteLength - overshoot);
        if (trimmed.byteLength > 0)
          chunks.push(decoder.decode(trimmed, { stream: false }));
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } catch {
    /* return partial */
  } finally {
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return chunks.join("");
}

/**
 * safeFetch pinned to the entry hostname. The session is passed as the 4th
 * argument only when present, so an unauthenticated crawl calls safeFetch with
 * exactly three arguments (safeFetch scopes an authenticated session to
 * same-origin hops internally).
 */
async function pinnedFetch(
  url: string,
  entryHostname: string,
  fetchTimeoutMs: number,
  session?: ScanSessionBinding,
): Promise<Response> {
  const init: RequestInit = {
    method: "GET",
    headers: { "User-Agent": `${APP_NAME}/1.0 (Crawler)` },
    redirect: "follow",
    signal: AbortSignal.timeout(fetchTimeoutMs),
  };
  return session
    ? safeFetch(url, init, [entryHostname], session)
    : safeFetch(url, init, [entryHostname]);
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractSitemapLocs(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    locs.push(decodeXmlEntities(m[1].trim()));
  }
  return locs;
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/**
 * Read /robots.txt for `Sitemap:` directives and return the same-origin
 * sitemap document URLs they name. Best-effort; returns [] on any failure.
 */
async function readRobotsSitemapUrls(
  origin: string,
  entryHostname: string,
  fetchTimeoutMs: number,
  session?: ScanSessionBinding,
): Promise<string[]> {
  try {
    const res = await pinnedFetch(
      origin + "/robots.txt",
      entryHostname,
      fetchTimeoutMs,
      session,
    );
    if (new URL(res.url).hostname !== entryHostname) return [];
    if (!res.ok) return [];
    const text = await readBoundedText(res, SITEMAP_BODY_MAX_BYTES);
    const out: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
      if (m) out.push(m[1].trim());
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Collect same-origin page URLs from the site's sitemap(s). Follows a sitemap
 * index to its children, honors a robots.txt Sitemap directive, and keeps only
 * same-origin http(s) page URLs (never the sitemap files themselves, never a
 * subdomain or other host). Best-effort and bounded; never throws.
 */
export async function collectSitemapUrls(
  startUrl: string,
  settings: CrawlDiscoverySettings,
  session?: ScanSessionBinding,
): Promise<string[]> {
  let origin: string;
  let entryHostname: string;
  try {
    const u = new URL(startUrl);
    origin = u.origin;
    entryHostname = u.hostname;
  } catch {
    return [];
  }
  const { fetchTimeoutMs, maxPages } = settings;

  const docQueue: string[] = [origin + "/sitemap.xml"];
  try {
    const robotsSitemaps = await readRobotsSitemapUrls(
      origin,
      entryHostname,
      fetchTimeoutMs,
      session,
    );
    for (const s of robotsSitemaps) {
      try {
        const su = new URL(s, origin);
        if (
          (su.protocol === "http:" || su.protocol === "https:") &&
          su.hostname === entryHostname
        ) {
          docQueue.push(su.href);
        }
      } catch {
        /* skip a malformed Sitemap: line */
      }
    }
  } catch {
    /* best-effort: robots.txt is optional */
  }

  const pages: string[] = [];
  const seenPages = new Set<string>();
  const fetchedDocs = new Set<string>();
  let docsFetched = 0;

  while (
    docQueue.length > 0 &&
    docsFetched < MAX_SITEMAP_DOCUMENTS &&
    pages.length < maxPages
  ) {
    const docUrl = docQueue.shift()!;
    if (fetchedDocs.has(docUrl)) continue;
    fetchedDocs.add(docUrl);

    let text: string;
    let finalUrl: string;
    try {
      const res = await pinnedFetch(
        docUrl,
        entryHostname,
        fetchTimeoutMs,
        session,
      );
      if (new URL(res.url).hostname !== entryHostname) continue;
      if (!res.ok) continue;
      finalUrl = res.url;
      text = await readBoundedText(res, SITEMAP_BODY_MAX_BYTES);
    } catch {
      continue;
    }
    docsFetched++;

    const index = isSitemapIndex(text);
    for (const loc of extractSitemapLocs(text)) {
      let resolved: URL;
      try {
        resolved = new URL(loc, finalUrl);
      } catch {
        continue;
      }
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:")
        continue;
      if (resolved.hostname !== entryHostname) continue;

      if (index) {
        // A child sitemap document to follow.
        if (
          !fetchedDocs.has(resolved.href) &&
          docQueue.length + docsFetched < MAX_SITEMAP_DOCUMENTS
        ) {
          docQueue.push(resolved.href);
        }
        continue;
      }

      if (!isSameOriginPageUrl(resolved, entryHostname)) continue;
      const normalized = normalizePageUrl(resolved);
      if (!seenPages.has(normalized) && pages.length < maxPages) {
        seenPages.add(normalized);
        pages.push(normalized);
      }
    }
  }

  return pages;
}

/**
 * Discover same-origin pages from `startUrl`: sitemap URLs first (listed
 * cheaply), then a depth-bounded, budget-bounded link crawl. Returns a deduped
 * list beginning with `startUrl`. Same-origin only, SSRF-safe, best-effort.
 */
export async function discoverPages(
  startUrl: string,
  settings: CrawlDiscoverySettings,
  session?: ScanSessionBinding,
): Promise<string[]> {
  const { fetchTimeoutMs, maxBodySize } = settings;
  const maxPages = settings.maxPages;
  const maxDepth = settings.maxDepth ?? CRAWL_MAX_DEPTH;

  let entryHostname: string;
  try {
    entryHostname = new URL(startUrl).hostname;
  } catch {
    return [startUrl];
  }

  const visited = new Set<string>([startUrl]);
  const found: string[] = [startUrl];
  const queue: Array<{ url: string; depth: number }> = [
    { url: startUrl, depth: 0 },
  ];

  // Seed from the sitemap: list every same-origin page it names (cheap, no
  // per-URL fetch), and queue a bounded number of them so their own links are
  // followed too.
  let sitemapUrls: string[] = [];
  try {
    sitemapUrls = await collectSitemapUrls(startUrl, settings, session);
  } catch {
    /* best-effort */
  }
  let sitemapEnqueued = 0;
  for (const su of sitemapUrls) {
    if (found.length >= maxPages) break;
    if (visited.has(su)) continue;
    visited.add(su);
    found.push(su);
    if (sitemapEnqueued < MAX_ENQUEUE_PER_PAGE && maxDepth > 1) {
      queue.push({ url: su, depth: 1 });
      sitemapEnqueued++;
    }
  }

  let fetches = 0;
  while (
    queue.length > 0 &&
    found.length < maxPages &&
    fetches < MAX_LINK_CRAWL_FETCHES
  ) {
    const { url, depth } = queue.shift()!;
    if (depth >= maxDepth) continue; // deep enough: no point fetching for more links

    let res: Response;
    try {
      if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
      let urlObj: URL;
      try {
        urlObj = new URL(url);
      } catch {
        continue;
      }
      if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") continue;
      if (urlObj.hostname !== entryHostname) continue;

      fetches++;
      res = await pinnedFetch(
        urlObj.href,
        entryHostname,
        fetchTimeoutMs,
        session,
      );
    } catch {
      continue; // timeout or network error: skip this page
    }

    try {
      // Only follow a redirect that stayed on the exact entry hostname.
      const redirectedUrl = new URL(res.url);
      if (redirectedUrl.hostname !== entryHostname) continue;
      const actualUrl = res.url;

      // A same-host redirect to a new path is itself a discovered page.
      const redirectNormalized = normalizePageUrl(redirectedUrl);
      if (!visited.has(redirectNormalized) && found.length < maxPages) {
        visited.add(redirectNormalized);
        found.push(redirectNormalized);
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) continue;

      const body = await readBoundedText(res, maxBodySize);

      let enqueuedFromThisPage = 0;
      const anchorRegex = /<a\s[^>]*href=["']([^"'#]+?)["']/gi;
      let match: RegExpExecArray | null;
      while ((match = anchorRegex.exec(body)) !== null) {
        const href = match[1].trim();
        if (!isCleanUrl(href)) continue;
        if (SKIP_EXTENSIONS.test(href)) continue;

        let resolved: URL;
        try {
          resolved = new URL(href, actualUrl);
        } catch {
          continue;
        }
        if (!isSameOriginPageUrl(resolved, entryHostname)) continue;

        const normalized = normalizePageUrl(resolved);
        if (visited.has(normalized)) continue;
        if (found.length >= maxPages) break;

        // List it, and (bounded per page + by depth) queue it so its own
        // children are discovered too.
        visited.add(normalized);
        found.push(normalized);
        if (
          enqueuedFromThisPage < MAX_ENQUEUE_PER_PAGE &&
          depth + 1 < maxDepth
        ) {
          queue.push({ url: normalized, depth: depth + 1 });
          enqueuedFromThisPage++;
        }
      }
    } catch {
      /* body read or parse hiccup: keep whatever was found */
    }
  }

  return found;
}
