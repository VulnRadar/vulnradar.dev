// Matches a URL against the small set of user-facing "mute" patterns the
// Settings > Site Alerts page lets people type in, and that the on-page
// card's own "Not this site" quick action writes automatically. This is
// deliberately NOT a general URL-match-pattern engine (like a browser
// extension manifest's match patterns) - just the three shapes a
// non-technical user actually needs for "stop showing me the card here":
//
//   https://example.com            exact origin, any path
//   https://example.com/*          exact origin, any path (same as above)
//   https://*.example.com          wildcard subdomain (+ the bare domain
//                                  itself), any path
//   https://*.example.com/*        wildcard subdomain, any path
//   https://*.example.com/a/b      wildcard subdomain, exact path only
//
// Any other shape - a wildcard mixed into the middle of a hostname, a
// literal (non-wildcard) host paired with one specific path, a wildcard
// partway through a path instead of a trailing "/*" - is rejected by
// isValidUrlPattern() so the Settings UI can give an inline error instead
// of silently storing something that matches nothing (or everything).

const PATTERN_RE = /^(https?):\/\/(\*\.)?([a-z0-9.-]+(?::[0-9]+)?)(\/.*)?$/i;

interface ParsedPattern {
  readonly scheme: string;
  readonly wildcardSubdomain: boolean;
  /** Literal host[:port] - for a wildcard-subdomain pattern this is the
   *  suffix after "*." (e.g. "example.com" for "*.example.com"). */
  readonly host: string;
  /** Raw path segment starting with "/", or null when the pattern had no
   *  path at all (e.g. bare "https://example.com"). */
  readonly path: string | null;
}

function parsePattern(pattern: string): ParsedPattern | null {
  const m = PATTERN_RE.exec(pattern.trim());
  if (!m) return null;
  const [, scheme, wildcardPrefix, host, path] = m;
  return {
    scheme: scheme!.toLowerCase(),
    wildcardSubdomain: wildcardPrefix === "*.",
    host: host!.toLowerCase(),
    path: path ?? null,
  };
}

/**
 * True when `pattern` is one of the three accepted shapes described above.
 * Used by the Settings UI to reject anything else before it's ever stored.
 */
export function isValidUrlPattern(pattern: string): boolean {
  const parsed = parsePattern(pattern);
  if (!parsed) return false;
  const { wildcardSubdomain, path } = parsed;
  // No path, a bare trailing slash, or the whole-path wildcard all mean
  // "any path" and are accepted regardless of host shape.
  if (path === null || path === "/" || path === "/*") return true;
  // Only a trailing "/*" counts as a path wildcard - a "*" anywhere else
  // in the path (e.g. "/foo/*", "/*/bar") isn't one of the three shapes.
  if (path.includes("*")) return false;
  // A specific literal path is only meaningful paired with a wildcard
  // subdomain - a literal host combined with one exact path isn't one of
  // the three accepted shapes either.
  return wildcardSubdomain;
}

/**
 * Escapes every regex metacharacter in a literal string. Applied to the
 * literal host/path fragments of a pattern before they're assembled into a
 * RegExp, so a pattern like "https://example.com/*" can't accidentally be
 * interpreted as a real regular expression (e.g. the "." in a hostname
 * matching any character instead of a literal dot).
 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `url` matches `pattern`. `pattern` must be one of the three
 * shapes isValidUrlPattern() accepts - anything else always returns false
 * rather than throwing, since callers apply this against user-entered
 * strings that were (or should have been) validated separately.
 */
export function matchesUrlPattern(url: string, pattern: string): boolean {
  const parsed = parsePattern(pattern);
  if (!parsed) return false;

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.protocol.replace(/:$/, "").toLowerCase() !== parsed.scheme) {
    return false;
  }

  const hostRegex = new RegExp(
    parsed.wildcardSubdomain
      ? `^(?:.+\\.)?${escapeRegExp(parsed.host)}$`
      : `^${escapeRegExp(parsed.host)}$`,
    "i",
  );
  if (!hostRegex.test(target.host)) return false;

  const { path } = parsed;
  if (path === null || path === "/" || path === "/*") return true;
  return target.pathname === path;
}
