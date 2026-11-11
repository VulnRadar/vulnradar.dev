import { isPublicScanId, parseIdParam } from "@/lib/api/path-id";
import { API } from "@/lib/config/client-constants";

/**
 * A scan id in a shape the history API issues, and therefore safe to put in a
 * request path. Branded so the type checker refuses a raw string where a path
 * is built: the only way to get one is parseScanId.
 *
 * The id reaches the client from places the visitor controls (/history?scan=
 * above all), and the browser resolves dot segments before it sends a request.
 * An unchecked `${API.HISTORY}/${id}` with id "../keys/5/revoke?" is a
 * same-origin, cookie-bearing request to /api/v3/keys/5/revoke, which the
 * Origin-based CSRF check has no reason to refuse.
 */
export type ScanId = string & { readonly __brand: "ScanId" };

/**
 * The rule is the server's, from lib/api/path-id (which imports nothing, so it
 * is safe here): a 32 character public_id, or the legacy SERIAL primary key
 * that old ?scan=456 bookmarks and the dashboard's just-saved result carry,
 * with no leading zero and nothing above INT4. A looser client rule sent
 * /history?scan=007 as a request that always answered 404.
 */
export function parseScanId(raw: unknown): ScanId | null {
  const value = typeof raw === "number" ? String(raw) : raw;
  if (typeof value !== "string") return null;
  return isPublicScanId(value) || parseIdParam(value) !== null
    ? (value as ScanId)
    : null;
}

// The per-scan history routes a client reaches through a ScanId, each from its
// own API entry. A closed list on purpose, and never a suffix appended to the
// scan's path: the entries do not share one prefix once the API moves.
const SCAN_ROUTES = {
  item: API.HISTORY_ITEM,
  share: API.HISTORY_SHARE,
  summary: API.HISTORY_SUMMARY,
  delete: API.HISTORY_DELETE,
} as const;

export type ScanHistoryRoute = keyof typeof SCAN_ROUTES;

/**
 * The API path for one scan, or one of its sub-routes. The entries encode the
 * id as well, so a slash or a question mark in a value that was cast to
 * ScanId instead of parsed cannot open another segment or a query string.
 */
export function historyItemPath(
  id: ScanId,
  route: ScanHistoryRoute = "item",
): string {
  return SCAN_ROUTES[route](id);
}
