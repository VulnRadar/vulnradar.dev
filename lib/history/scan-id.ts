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

// public_id is gen_random_uuid() with its hyphens removed, filled by the
// column default (lib/database/schema/02-features.mjs), so 32 lowercase hex.
const PUBLIC_ID = /^[0-9a-f]{32}$/;
// The legacy SERIAL primary key that old ?scan=456 bookmarks and the
// dashboard's just-saved result still carry; resolveScanRow accepts both.
const LEGACY_ID = /^[0-9]{1,10}$/;

export function parseScanId(raw: unknown): ScanId | null {
  const value = typeof raw === "number" ? String(raw) : raw;
  if (typeof value !== "string") return null;
  return PUBLIC_ID.test(value) || LEGACY_ID.test(value)
    ? (value as ScanId)
    : null;
}

/** The per-scan history routes a client calls. A closed list on purpose. */
export type ScanHistorySubPath =
  "" | "/share" | "/share/publicly-listed" | "/summary" | "/delete";

/**
 * The API path for one scan, or one of its sub-routes. API.HISTORY_ITEM
 * encodes the id as well, so a slash or a question mark in a value that was
 * cast to ScanId instead of parsed cannot open another segment or a query
 * string.
 */
export function historyItemPath(
  id: ScanId,
  sub: ScanHistorySubPath = "",
): string {
  return `${API.HISTORY_ITEM(id)}${sub}`;
}
