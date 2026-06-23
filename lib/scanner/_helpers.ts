/**
 * Shared helpers for detector functions.
 *
 * Lives at lib/scanner/_helpers.ts so both the registry and the per-
 * category detector modules can import the same primitives.
 */

let idCounter = 0;
export function generateId(): string {
  return `vuln-${Date.now()}-${idCounter++}`;
}

export function getHeader(headers: Headers, key: string): string | null {
  return headers.get(key);
}

export function hasHeader(headers: Headers, key: string): boolean {
  return headers.has(key);
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cookie parsing helpers.
 */
export function getSetCookies(headers: Headers): string[] {
  // `Headers.getSetCookie()` is the standard API; fall back to scanning
  // comma-joined values if the runtime doesn't support it.
  if (
    typeof (headers as unknown as { getSetCookie?: () => string[] })
      .getSetCookie === "function"
  ) {
    return (
      headers as unknown as { getSetCookie: () => string[] }
    ).getSetCookie();
  }
  const all: string[] = [];
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") all.push(value);
  });
  return all;
}

export function parseCookieName(cookie: string): string {
  return cookie.split("=")[0]?.trim() ?? "";
}

export type EvidenceFn = (
  url: string,
  headers: Headers,
  body: string,
) => string | null;
