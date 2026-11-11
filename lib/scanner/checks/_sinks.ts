/**
 * Helpers for the checks that report a dangerous call only when something
 * could actually reach it.
 */

function skipSpace(src: string, from: number): number {
  let i = from;
  while (i < src.length && " \t\r\n".includes(src[i])) i++;
  return i;
}

/**
 * The offset just past the string literal opening at `start`, or -1 when
 * nothing there is a complete, constant string. A template with `${` is not
 * constant, and a quoted string broken by a raw newline is not a string.
 */
function endOfStringLiteral(src: string, start: number): number {
  const quote = src[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") return -1;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
    } else if (c === quote) {
      return i + 1;
    } else if (quote === "`") {
      if (c === "$" && src[i + 1] === "{") return -1;
    } else if (c === "\n" || c === "\r") {
      return -1;
    }
  }
  return -1;
}

/**
 * True when every argument of the call whose `(` is at `openParenIndex` is a
 * constant string.
 *
 * `eval("require('crypto')")` is how a library hides a require from bundlers:
 * the code it runs was fixed when the file was written, so no input of anyone
 * else's can reach it. Every argument counts because `new Function("a", body)`
 * has a constant first argument and a body that is not. Anything this cannot
 * read as a plain literal answers false, so an unusual shape keeps reporting.
 */
export function isLiteralArgument(
  src: string,
  openParenIndex: number,
): boolean {
  let i = skipSpace(src, openParenIndex + 1);
  while (src[i] !== ")") {
    i = endOfStringLiteral(src, i);
    if (i === -1) return false;
    i = skipSpace(src, i);
    if (src[i] === ",") {
      i = skipSpace(src, i + 1);
    } else if (src[i] !== ")") {
      return false;
    }
  }
  return true;
}

/**
 * A browser-controlled value: something an attacker who can shape a link or
 * a message can put into the expression.
 *
 * The sink inventories (innerHTML, setAttribute) use it to tell a write that
 * a URL or a postMessage can reach from a write of a constant or of a value
 * the page built for itself. Callers match it against the expression text and
 * against the one assignment that defined an identifier, so it names sources,
 * not every property of them.
 */
export const UNTRUSTED_SOURCE =
  /\b(?:location(?:\.(?:hash|search|href|pathname))?|document\.(?:URL|documentURI|referrer|cookie|baseURI)|window\.name|URLSearchParams|\.searchParams|localStorage|sessionStorage|event\.data|e\.data|msg\.data|postMessage)\b/;

/** A script shorter than this is never judged by its line shape. */
const BUNDLE_MIN_CHARS = 4096;
/** A minified bundle is a line or two; hand-written code has many. */
const BUNDLE_MAX_LINES = 3;
const BUNDLE_LONG_LINE = 2000;
/** The banner comment minifiers keep on purpose: a bang after the opener. */
const PRESERVED_BANNER = /^\s*\/\*!([\s\S]{0,500}?)\*\//;
const SEMVER = /\bv?\d+\.\d+\.\d+/;

/**
 * True when an inline script is shaped like a vendor library and not like the
 * site's own code: at least 4 KB that is either three lines or fewer or has a
 * line over 2000 characters (minified), or a script that opens with a
 * preserved bang comment carrying an x.y.z version.
 *
 * This is a shape test, not an identification: it cannot tell a site's own
 * minified bootstrap from jQuery. It is meant for the sink inventories, which
 * are noise on a library whatever the library is. A sink that reads a
 * browser-controlled source is reported either way.
 */
export function looksBundled(code: string): boolean {
  const banner = PRESERVED_BANNER.exec(code);
  if (banner && SEMVER.test(banner[1])) return true;
  if (code.length < BUNDLE_MIN_CHARS) return false;

  let lines = 1;
  let longest = 0;
  let lineStart = 0;
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) !== 10) continue;
    longest = Math.max(longest, i - lineStart);
    lineStart = i + 1;
    lines++;
  }
  longest = Math.max(longest, code.length - lineStart);
  return lines <= BUNDLE_MAX_LINES || longest > BUNDLE_LONG_LINE;
}
