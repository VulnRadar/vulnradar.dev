/**
 * Matches a page pathname against an admin-configured notification
 * "path_pattern" (the Targeting > Page Filter field in the notifications
 * admin UI). Pure and client-safe: no server imports, so it can be used
 * from both the bell dropdown and the site-wide banner/modal/toast
 * renderer.
 *
 * An empty/null pattern matches every page. `*` is a wildcard that matches
 * any run of characters, e.g. "/dashboard*" matches "/dashboard" and
 * "/dashboard/settings".
 *
 * Implemented as a linear greedy walk rather than `new RegExp(pattern
 * .replace(/\*​/g, ".*"))`. That construction has the classic catastrophic-
 * backtracking shape (a pattern like "/a*a*a*a*b" is exponential in the
 * pathname length), and this function runs in EVERY visitor's browser on
 * every route change, driven by a string an admin typed. The walk below
 * is O(pattern + pathname) with no backtracking at all: because `.*` is
 * greedy over an unrestricted character class, taking the FIRST occurrence
 * of each literal segment can never miss a match that a later occurrence
 * would have found.
 */
export function matchesPathPattern(
  pathname: string,
  pattern: string | null | undefined,
): boolean {
  const trimmed = pattern?.trim();
  if (!trimmed) return true;

  const segments = trimmed.split("*");

  // No wildcard at all: an exact comparison, same as the anchored regex.
  if (segments.length === 1) return pathname === trimmed;

  // The pattern is anchored at both ends, so the first and last literal
  // segments must sit exactly at the start and end of the pathname.
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!pathname.startsWith(first)) return false;
  if (!pathname.endsWith(last)) return false;

  // Everything the two anchors leave for the middle segments to consume.
  // `start > end` means the anchors overlap, which only a shorter pathname
  // than the pattern's literal characters can produce.
  let cursor = first.length;
  const end = pathname.length - last.length;
  if (cursor > end) return false;

  for (let i = 1; i < segments.length - 1; i++) {
    const segment = segments[i];
    // Consecutive wildcards ("**") produce an empty segment, which consumes
    // nothing and always matches.
    if (segment === "") continue;
    const found = pathname.indexOf(segment, cursor);
    if (found === -1 || found + segment.length > end) return false;
    cursor = found + segment.length;
  }
  return true;
}
