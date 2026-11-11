/**
 * The page to load instead, when the one asked for came back empty.
 *
 * Deleting the last row on a page, or another admin removing accounts while
 * this one is paging, leaves the requested page past the end of the list: the
 * server answers with no rows but a total that says there are some. Showing
 * that as the answer read as "No users have registered yet" with no way to
 * page back, so the caller asks for the last page that has rows instead.
 *
 * Returns null when the page is fine: it has rows, it is the first page (an
 * empty first page is genuinely empty), or the list really is empty.
 */
export function pageAfterEmpty(
  requestedPage: number,
  rowCount: number,
  total: number,
  totalPages: number,
): number | null {
  if (rowCount > 0 || requestedPage <= 1 || !(total > 0)) return null;
  const last = Math.max(1, totalPages);
  // Never re-ask for the page that just came back empty: that would loop.
  return last < requestedPage ? last : null;
}
