/**
 * Turns a redirect target someone else may have written (`?redirect=` on
 * /login, a `next` carried through a sign-in) into a path on this origin, or
 * the fallback.
 *
 * The value ends up in `router.push`, which resolves it with `new URL()`. That
 * parser deletes ASCII tab and newline anywhere in the input and reads a
 * backslash as a slash, so a check on the first characters is not a check:
 * `/<TAB>/evil.com` starts like a path and parses as `//evil.com`. Instead,
 * any character the parser rewrites is refused outright, what is left is
 * parsed against a fixed origin, and only a result on that origin is
 * accepted. What comes back is the parsed path, so the router is handed
 * exactly the URL that was judged.
 */
const PROBE_ORIGIN = "https://redirect.invalid";
const MAX_LENGTH = 512;

/** C0 and C1 controls, DEL, any Unicode space, or a backslash. */
function hasUnsafeCharacter(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
    if (ch === "\\" || /\s/.test(ch)) return true;
  }
  return false;
}

export function safeRedirect(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value || value.length > MAX_LENGTH) return fallback;
  if (!value.startsWith("/") || hasUnsafeCharacter(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;

  // Dot segments collapse during parsing, so `/..//evil.com` has the pathname
  // `//evil.com`. Handed back to the router, that is protocol-relative.
  if (url.pathname.startsWith("//")) return fallback;

  return url.pathname + url.search + url.hash;
}
