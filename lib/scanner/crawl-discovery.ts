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
import { safeReadBody } from "./read-bounded-body";
import { APP_NAME } from "@/lib/config/constants";
import type { ScanSessionBinding } from "./auth/types";

/**
 * The User-Agent this crawler sends. It is also the token a site's robots.txt
 * names to fence VulnRadar out of specific paths (see parseRobots): a group
 * whose `User-agent:` is a substring of this string, e.g. `User-agent: VulnRadar`.
 */
const CRAWLER_UA = `${APP_NAME}/1.0 (Crawler)`;

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
    headers: { "User-Agent": CRAWLER_UA },
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

export interface RobotsRules {
  /** Same-origin Sitemap: document URLs named in robots.txt. */
  sitemaps: string[];
  /** Disallow path rules from group(s) that name THIS crawler (never `*`). */
  disallows: string[];
}

/**
 * Parse robots.txt into its Sitemap: URLs and the Disallow rules that apply to
 * THIS crawler. A Disallow applies only when its group's `User-agent:` names us
 * specifically -- the value is a case-insensitive substring of our UA, e.g.
 * `User-agent: VulnRadar` -- never the blanket `*`. A security scanner should
 * not be fenced out of an authorized target by a site's generic bot policy; it
 * steps aside only when the owner names VulnRadar, which is the documented way
 * to keep pages (e.g. large SEO surfaces) out of a scan. Grouping follows the
 * standard: consecutive User-agent lines share a group until the first rule
 * line, after which the next User-agent line starts a new group.
 */
export function parseRobots(text: string, ua: string): RobotsRules {
  const uaLower = ua.toLowerCase();
  const sitemaps: string[] = [];
  const disallows: string[] = [];
  let groupApplies = false;
  let sawRule = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      // A User-agent line after a rule line starts a fresh group.
      if (sawRule) {
        groupApplies = false;
        sawRule = false;
      }
      if (value && value !== "*" && uaLower.includes(value.toLowerCase())) {
        groupApplies = true;
      }
      continue;
    }
    if (field === "disallow") {
      sawRule = true;
      if (groupApplies && value) disallows.push(value);
      continue;
    }
    if (field === "allow" || field === "crawl-delay") {
      sawRule = true;
    }
  }
  return { sitemaps, disallows };
}

/** robots.txt path match: prefix by default, `*` = any run, trailing `$` = end anchor. */
function matchesRobotsRule(pathname: string, rule: string): boolean {
  if (!rule.startsWith("/")) return false;
  const anchored = rule.endsWith("$");
  const core = anchored ? rule.slice(0, -1) : rule;
  if (!core.includes("*")) {
    return anchored ? pathname === core : pathname.startsWith(core);
  }
  // security: this used to compile each `*` to `.*` and hand the result to
  // RegExp. That is exponential on a crafted rule, because every `.*` can
  // backtrack against every other: measured 45ms at 5 wildcards, 1.5s at 7,
  // 9s at 8, and 35 MINUTES at 10 wildcards against a 61-character path.
  // The rule comes from the scanned site's own robots.txt, so any target
  // could freeze the scan worker's event loop, and isPathDisallowed runs the
  // whole rule set per discovered URL. (The same hazard is noted a few lines
  // below for the anchor regex, where it was already fixed.)
  //
  // Glob matching needs no backtracking: match the first segment as a
  // prefix, then take the leftmost occurrence of each middle segment, then
  // check the tail. Leftmost is optimal here because `*` matches anything
  // including nothing, so an earlier match never rules out a later one.
  const parts = core.split("*");

  if (!pathname.startsWith(parts[0])) return false;
  let pos = parts[0].length;

  for (let i = 1; i < parts.length - 1; i++) {
    const seg = parts[i];
    if (!seg) continue;
    const idx = pathname.indexOf(seg, pos);
    if (idx === -1) return false;
    pos = idx + seg.length;
  }

  const tail = parts[parts.length - 1];
  if (!tail) return true; // rule ends in `*`: anything left over matches
  return anchored
    ? pathname.endsWith(tail) && pathname.length - tail.length >= pos
    : pathname.indexOf(tail, pos) !== -1;
}

export function isPathDisallowed(
  pathname: string,
  disallows: string[],
): boolean {
  return disallows.some((rule) => matchesRobotsRule(pathname, rule));
}

/**
 * Fetch and parse /robots.txt for both its Sitemap: URLs and the Disallow rules
 * naming this crawler. Best-effort: any failure yields empty rules, so a
 * missing or unreadable robots.txt never blocks discovery.
 */
async function readRobots(
  origin: string,
  entryHostname: string,
  fetchTimeoutMs: number,
  session?: ScanSessionBinding,
): Promise<RobotsRules> {
  const empty: RobotsRules = { sitemaps: [], disallows: [] };
  try {
    const res = await pinnedFetch(
      origin + "/robots.txt",
      entryHostname,
      fetchTimeoutMs,
      session,
    );
    if (new URL(res.url).hostname !== entryHostname) return empty;
    if (!res.ok) return empty;
    const text = await safeReadBody(res, SITEMAP_BODY_MAX_BYTES);
    return parseRobots(text, CRAWLER_UA);
  } catch {
    return empty;
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
  robots?: RobotsRules,
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

  const rules =
    robots ??
    (await readRobots(origin, entryHostname, fetchTimeoutMs, session));

  const docQueue: string[] = [origin + "/sitemap.xml"];
  for (const s of rules.sitemaps) {
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
      text = await safeReadBody(res, SITEMAP_BODY_MAX_BYTES);
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
      if (isPathDisallowed(resolved.pathname, rules.disallows)) continue;
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

  // Read robots.txt once: its Sitemap: URLs feed discovery, and any Disallow
  // rule that names VulnRadar specifically fences our crawler out of that path
  // (a site's supported way to keep pages -- e.g. large SEO surfaces -- out of
  // a scan; see parseRobots). Best-effort; empty rules on any failure.
  let robots: RobotsRules = { sitemaps: [], disallows: [] };
  try {
    robots = await readRobots(
      new URL(startUrl).origin,
      entryHostname,
      fetchTimeoutMs,
      session,
    );
  } catch {
    /* best-effort */
  }

  // Seed from the sitemap: list every same-origin page it names (cheap, no
  // per-URL fetch), and queue a bounded number of them so their own links are
  // followed too.
  let sitemapUrls: string[] = [];
  try {
    sitemapUrls = await collectSitemapUrls(startUrl, settings, session, robots);
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

      const body = await safeReadBody(res, maxBodySize);

      let enqueuedFromThisPage = 0;
      // Gap before href= is bounded ({0,2000}, not *) so a body of many "<a "
      // tokens with no ">" and no href can't drive O(n^2) backtracking that
      // hangs the crawl worker's event loop (measured ~30s on 200KB with the
      // unbounded form). No real anchor carries 2000+ chars of attributes
      // before href, so this matches every legitimate link.
      const anchorRegex = /<a\s[^>]{0,2000}href=["']([^"'#]+?)["']/gi;
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
        if (isPathDisallowed(resolved.pathname, robots.disallows)) continue;

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
