/**
 * The one string a scanned site is known by.
 *
 * scan_history.url is the key every later read is looked up by (the previous
 * scan the regression diff compares against, the host page, the badge) and
 * every finding id hashes it (lib/scanner/_helpers.ts generateId). Each entry
 * point used to store whatever arrived: the dashboard sends what was typed
 * ("example.com"), the extension sends the tab's address
 * ("https://example.com/"), the CLI sends its flag. One site therefore had a
 * baseline and a set of finding ids per spelling, and moving between entry
 * points reset its triage and re-alerted on findings already dealt with.
 */

/**
 * C0 controls, DEL and C1 controls. None of them belongs in a URL anyone
 * typed, the URL parser silently drops some (tab, newline) and keeps others
 * percent-encoded, and the raw string is what reaches the scan summary prompt
 * and the public host page, where a newline is the start of an injected
 * instruction.
 */
// oxlint-disable-next-line no-control-regex -- finding them is the point
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * A scheme the input already names, digits included (pop3://, pop3s://).
 * Exported so the two other places that ask "is this already a URL"
 * (lib/scanner/_helpers.ts and normalizeUrl) ask it the same way.
 */
export const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function hasControlCharacters(input: string): boolean {
  return CONTROL_CHARACTER.test(input);
}

/**
 * The canonical form of a scan target, or null when the input is not one.
 *
 * - Surrounding whitespace is trimmed, and a bare host gets https://, as
 *   every entry point already promised.
 * - The host is lowercased and read the way an http host is read, for every
 *   scheme. The URL parser leaves the host of ssh:// or mongodb:// opaque, so
 *   "ssh://LOC%61LHOST" would otherwise keep a spelling no address rule
 *   recognises as localhost.
 * - The fragment is dropped: it never reaches the server, so it cannot
 *   change what is scanned.
 * - The root is always written "/". Anywhere else the path is kept exactly as
 *   given, trailing slash included, because /docs and /docs/ are allowed to
 *   be different pages and the scan has to fetch the one that was asked for.
 *   The query is kept for the same reason.
 *
 * Input with a control character is refused outright rather than cleaned:
 * the routes answer it with a 400 before they get here, and anything else
 * calling this should not be quietly scanning a different address.
 */
export function canonicalScanUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || hasControlCharacters(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = new URL(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (!parsed.hostname) return null;

  try {
    parsed.hostname = new URL(`http://${parsed.hostname}`).hostname;
  } catch {
    return null;
  }
  parsed.hash = "";
  if (parsed.pathname === "") parsed.pathname = "/";
  return parsed.href;
}

/**
 * Every stored spelling a lookup by `input` should match, canonical first.
 *
 * Rows written before canonicalScanUrl existed hold the root without its
 * slash ("https://example.com"), which is how the dashboard used to store a
 * typed host. A lookup by the canonical form alone would treat those as a
 * different site, so the next scan of it would read as its first. Use as
 * `url = ANY($n::text[])`.
 */
export function scanUrlLookupForms(input: string): string[] {
  const canonical = canonicalScanUrl(input);
  if (!canonical) return [];
  const parsed = new URL(canonical);
  if (parsed.pathname !== "/") return [canonical];
  const withoutSlash = `${parsed.protocol}//${parsed.host}${parsed.search}`;
  return [canonical, withoutSlash];
}
