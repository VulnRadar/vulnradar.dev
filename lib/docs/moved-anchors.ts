/**
 * Sections that left a docs page for another one, keyed by the page the reader
 * lands on and then by the hash (without the #).
 *
 * A fragment never reaches the server, so next.config cannot redirect
 * /docs/api#post-keys. It does survive a 308, which is why a retired page's
 * anchors are keyed on the redirect's destination rather than on the old URL.
 */
export const MOVED_ANCHORS: Record<string, Record<string, string>> = {};

/** Where this path and location hash should forward to, if anywhere. */
export function resolveMovedAnchor(
  pathname: string,
  hash: string,
  table: Record<string, Record<string, string>> = MOVED_ANCHORS,
): string | undefined {
  const key = hash.replace(/^#/, "");
  if (!key) return undefined;
  const page = table[pathname];
  return page && Object.hasOwn(page, key) ? page[key] : undefined;
}
