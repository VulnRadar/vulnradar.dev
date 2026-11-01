/**
 * The URLs a page names, read as host plus path, for detectors that decide
 * where something is loaded from.
 *
 * Those detectors used to search the body for a vendor's hostname as text
 * (`/cdn\.tailwindcss\.com/`). That also matched a host that merely contains
 * the name (evilcdn.tailwindcss.com, cdn.tailwindcss.com.evil.example) and
 * the name sitting in another URL's query string, and the body is the scan
 * target's own markup, so the target decided what the report said it loads.
 * Reading every absolute and protocol-relative URL and comparing its whole
 * hostname is what those detections meant.
 *
 * A URL carried in another URL's query string is part of that outer URL's
 * path, not a host of its own. Inline loader snippets keep working because
 * they hold the URL as a string literal ('https://static.hotjar.com/c/...'),
 * and JSON-escaped slashes (`https:\/\/`, as in RSC payloads and WordPress
 * settings blobs) are read as plain ones.
 */

export interface UrlRef {
  /** Lower-cased hostname, without port. */
  host: string;
  /** Path plus query, starting with "/" or "?", or "" when the URL has none. */
  path: string;
}

export interface HostRule {
  host: string;
  /** Also accept any subdomain of `host`, for a vendor that serves the same
   *  file from several (www.google-analytics.com, ssl.google-analytics.com). */
  subdomains?: boolean;
  /** Tested against UrlRef.path, so it is written with a leading ^. */
  path?: RegExp;
}

// The lookbehind stops a URL from starting inside a word, a hostname, a query
// string or after a backslash (which a browser reads as a slash), which is
// what kept evil.example/?//cdn.example from counting.
// The lookahead is what makes the captured run the host: the authority has to
// end right after it and its port. Otherwise the run is user info
// (https://cdn.example@evil.example/) or the start of a longer name spelled
// with a percent-escape or a full-width stop, and the browser loads from some
// other host. A quote, a space or the end of the body count as that end
// because attribute values end there. Which quote opened an attribute is not
// known here, so markup contrived to disagree with the browser can still be
// misread, but a page can name any URL it likes in a comment anyway.
// A backslash does not end a path: in a JSON string it starts an escape, such
// as the one Next.js writes for every ampersand in a query.
// The host is one character class per label, so a failed attempt costs at
// most the length of one host and the whole scan stays linear in the body.
const URL_CANDIDATE =
  /(?<![\w.:/?&#%+\\-])(?:https?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)\.?(?::\d{1,5})?(?=[/?#\s"'`<>]|\\["']|&(?:quot|apos|#0*3[49]|#x0*2[27]);|$)([/?#][^\s"'`<>()]*)?/gi;

/** Every absolute or protocol-relative http(s) URL in `body`. */
export function urlRefs(body: string): UrlRef[] {
  const text = body.includes("\\/") ? body.replace(/\\\//g, "/") : body;
  const refs: UrlRef[] = [];
  for (const m of text.matchAll(URL_CANDIDATE)) {
    refs.push({ host: m[1].toLowerCase(), path: m[2] ?? "" });
  }
  return refs;
}

/** True when `host` is the rule's host, or a subdomain of it if allowed. */
export function hostMatches(host: string, rule: HostRule): boolean {
  const h = host.toLowerCase();
  return (
    h === rule.host || (rule.subdomains === true && h.endsWith(`.${rule.host}`))
  );
}

/** True when any of `refs` satisfies any of `rules`. */
export function loadsFrom(refs: UrlRef[], rules: HostRule[]): boolean {
  return refs.some((ref) =>
    rules.some(
      (rule) =>
        hostMatches(ref.host, rule) && (!rule.path || rule.path.test(ref.path)),
    ),
  );
}

/**
 * The hostname at the start of a matched URL-shaped secret, with or without
 * a scheme ("hooks.slack.com/services/..." or "https://x.firebaseio.com").
 */
export function leadingHost(match: string): string {
  return match
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[/?#:]/, 1)[0]
    .toLowerCase();
}
