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

import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { safeFetch } from "./safe-fetch";

const PAGE_FETCH_TIMEOUT_MS = 8000;
/** The same ceiling the scan applies to the body it checks. */
const MAX_BODY_CHARS = 1_000_000;
const USER_AGENT = `Mozilla/5.0 (compatible; ${APP_NAME}/1.0; +${APP_URL})`;

export interface FetchedPage {
  status: number;
  ok: boolean;
  headers: Headers;
  body: string;
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
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
    });
    const body = (await res.text()).slice(0, MAX_BODY_CHARS);
    return { status: res.status, ok: res.ok, headers: res.headers, body };
  } catch {
    return null;
  }
}
