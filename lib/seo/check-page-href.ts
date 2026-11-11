// From a finding id to the public fix guide for its check, for the places that
// show a finding to someone who then asks "how do I fix this".
//
// Client-safe on purpose: it reads the generated id list and nothing from the
// scanner, so the finding page can import it without the catalogue.

import { extractCheckId } from "@/lib/scanner/check-id";
import { ROUTES } from "@/lib/config/client-constants";
import {
  ASYNC_CHECK_PAGE_IDS,
  CHECK_PAGE_IDS,
} from "./check-page-ids.generated";

const PAGE_IDS: ReadonlySet<string> = new Set(CHECK_PAGE_IDS);

/**
 * The /checks page id for a finding id (`<checkId>--<hash>`) or a bare check
 * id, or null when the check has no page of its own. Findings from the async
 * layer carry `async-<title slug>`, which no page uses as its id, so they go
 * through the map the compiler wrote from each page's `emittedAs`.
 */
export function checkPageId(findingId: string): string | null {
  // Stored findings are JSON read back from the database, not typed input.
  if (typeof findingId !== "string") return null;
  const checkId = extractCheckId(findingId);
  if (PAGE_IDS.has(checkId)) return checkId;
  // hasOwn: a finding id is data, and "constructor" is a key on every object.
  return Object.hasOwn(ASYNC_CHECK_PAGE_IDS, checkId)
    ? ASYNC_CHECK_PAGE_IDS[checkId]
    : null;
}

/** The site-relative path of the fix guide for a finding, or null if there is none. */
export function checkPageHref(findingId: string): string | null {
  const id = checkPageId(findingId);
  return id ? `${ROUTES.CHECKS}/${id}` : null;
}
