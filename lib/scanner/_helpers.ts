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

/**
 * Strip non-HTML regions from a response body for regex matching.
 *
 * Removes `<script>`, `<style>`, `<template>`, and HTML comments so that
 * patterns like `eval(`, `md5(`, or HTML tag names don't match against
 * minified JS source, CSS hex values, or framework JSON blobs
 * (`__NEXT_DATA__ = {...}`). The function preserves a single space
 * between removed regions so character offsets in the result roughly
 * align with the input.
 */
export function stripNonHtml(input: string): string {
  return input
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, " ")
    .replace(/\s+/g, " ");
}

/**
 * Detect whether the response body belongs to a SPA framework page.
 *
 * Used to suppress body-regex detectors that would over-fire on
 * framework-emitted JS or hydration markup.
 */
export function isFrameworkPage(body: string): boolean {
  return (
    body.includes("__NEXT_DATA__") ||
    body.includes("__nuxt") ||
    body.includes("/_next/") ||
    body.includes("/_nuxt/") ||
    body.includes("__REACT") ||
    body.includes("data-reactroot") ||
    body.includes("ng-version") ||
    body.includes('id="__svelte')
  );
}

/**
 * Apply a predicate to every Set-Cookie header on a response.
 *
 * Replaces the manual `for (const c of cookies) { ... }` fallback
 * pattern that was producing false positives across multiple cookie
 * detectors. Returns the first non-null predicate result, or null.
 */
export function matchCookie(
  headers: Headers,
  predicate: (raw: string, name: string) => string | null,
): string | null {
  for (const raw of getSetCookies(headers)) {
    const name = parseCookieName(raw);
    const evidence = predicate(raw, name);
    if (evidence) return evidence;
  }
  return null;
}

/**
 * Format a list of observed response header names for use in evidence
 * strings. Used by every "header-missing" detector so the evidence
 * includes the headers that *were* present, not just the absent one.
 *
 * Caps the list at `max` entries to keep evidence strings short.
 */
export function formatObservedHeaders(headers: Headers, max = 12): string {
  const names: string[] = [];
  headers.forEach((_, key) => names.push(key));
  if (names.length === 0) return "(no response headers observed)";
  if (names.length <= max) return names.join(", ");
  return (
    names.slice(0, max).join(", ") + `, ... and ${names.length - max} more`
  );
}

/**
 * Redact a secret value to `prefix****suffix` shape, preserving only
 * the first `prefixLen` and last `suffixLen` characters. Used by
 * secret-detection checks so scan logs and the `evidence` field never
 * contain the full secret.
 */
export function redactSecret(
  value: string,
  prefixLen = 4,
  suffixLen = 4,
): string {
  if (value.length <= prefixLen + suffixLen + 4) {
    return value.slice(0, 2) + "****";
  }
  return (
    value.slice(0, prefixLen) + "****" + value.slice(value.length - suffixLen)
  );
}
