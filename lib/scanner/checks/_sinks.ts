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
