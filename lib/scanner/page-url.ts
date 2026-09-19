/**
 * The identity of a page, for deciding whether two URLs are the same page.
 *
 * A trailing slash on a path is not a different page: /landing and /landing/
 * are the same page on every server that serves either, and a crawl that
 * treated them as two scanned it twice, listed it twice and counted it twice
 * against the quota. The root is the one place the slash is not optional, and
 * https://example.com and https://example.com/ are also the same page.
 *
 * A query string IS part of the identity. ?page=2 is a different page from
 * ?page=3, and a scanner that folded them together would report one and claim
 * the other. A fragment is not: it never reaches the server.
 */
export function canonicalPageUrl(input: string | URL): string {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    return String(input);
  }
  const path =
    url.pathname.length > 1 && url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;
  return url.origin + path + url.search;
}

/** Whether two URLs address the same page. */
export function isSamePageUrl(a: string, b: string): boolean {
  return canonicalPageUrl(a) === canonicalPageUrl(b);
}
