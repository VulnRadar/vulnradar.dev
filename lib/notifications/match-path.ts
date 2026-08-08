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
 */
export function matchesPathPattern(
  pathname: string,
  pattern: string | null | undefined,
): boolean {
  const trimmed = pattern?.trim();
  if (!trimmed) return true;
  const escaped = trimmed
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(pathname);
}
