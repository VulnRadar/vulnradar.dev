/**
 * The address the scanner's URL parser fetches, for a stored or submitted URL
 * string that holds a character the parser rewrites.
 *
 * The parser reads a backslash in an http(s) authority as a slash and drops
 * tabs and newlines wherever they are, so a string holding one of those is not
 * the address that gets scanned. Everything that reads scan_history.url later
 * (the host expressions in lib/database/sql-fragments.ts, reputation, history)
 * has to see the parsed form, or it disagrees with the scan about which site it
 * was. Any other string, including one the parser refuses, comes back as it
 * was, so validation downstream still sees what was sent.
 */
export function parsedFormOf(url: string): string {
  // oxlint-disable-next-line no-control-regex -- finding them is the point
  if (!/[\\\u0000-\u001f\u007f]/.test(url)) return url;
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}
