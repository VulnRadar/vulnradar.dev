/**
 * One unauthenticated GET of the scanned page, shared by the async checks
 * that need to read it.
 *
 * The OSV.dev library lookup, the public-bucket listing check and the CSP
 * nonce check each fetched the page themselves, and they run concurrently in
 * one scan, so a site received the same GET three times in the same second on
 * top of the scan's own fetch. They now share one in-flight request per URL.
 * It is dropped as soon as it settles, so nothing is cached across scans, and
 * a check that needs a genuinely separate response (the nonce check's second
 * request) makes its own.
 */

import { readBoundedBody } from "./read-bounded-body";
import { safeFetch } from "./safe-fetch";
import { SCANNER_UA } from "./user-agent";

const PAGE_FETCH_TIMEOUT_MS = 8000;
/**
 * The same ceiling the scan applies to the body it checks. It is a byte cap
 * on the read, not a slice afterwards: the page belongs to the site being
 * scanned, and `res.text()` buffered all of it before slicing, so an endless
 * body grew the heap until the fetch deadline.
 */
const MAX_BODY_BYTES = 1_000_000;

export interface FetchedPage {
  status: number;
  ok: boolean;
  headers: Headers;
  body: string;
  /** The page was longer than MAX_BODY_BYTES (or stalled) and `body` is its head. */
  truncated: boolean;
}

const inFlight = new Map<string, Promise<FetchedPage | null>>();

/** The page at `url`, or null when it could not be fetched at all. */
export function readPage(url: string): Promise<FetchedPage | null> {
  const pending = inFlight.get(url);
  if (pending) return pending;
  const run = fetchPage(url).finally(() => inFlight.delete(url));
  inFlight.set(url, run);
  return run;
}

async function fetchPage(url: string): Promise<FetchedPage | null> {
  try {
    const res = await safeFetch(url, {
      method: "GET",
      headers: { "User-Agent": SCANNER_UA },
      signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
    });
    const { text: body, truncated } = await readBoundedBody(
      res,
      MAX_BODY_BYTES,
      PAGE_FETCH_TIMEOUT_MS,
    );
    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      body,
      truncated,
    };
  } catch {
    return null;
  }
}
