/**
 * Shared helpers for detector functions.
 *
 * Lives at lib/scanner/_helpers.ts so both the registry and the per-
 * category detector modules can import the same primitives.
 */

/**
 * FNV-1a 32-bit hash → base-36 string.
 * Used so that the same check fired against the same URL always produces
 * the same finding ID, making two scans of the same site directly comparable.
 */
function fnvHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

/**
 * Stable, deterministic finding ID: `<checkId>--<urlHash>`.
 * Two scans of the same URL produce the same IDs for the same findings,
 * enabling reliable diffing between scans.
 */
export function generateId(checkId: string, url: string): string {
  return `${checkId}--${fnvHash(url)}`;
}

export function getHeader(headers: Headers, key: string): string | null {
  // Headers.get() throws TypeError for forbidden header names (those
  // starting with ":" — pseudo-headers — and any name containing
  // non-token characters). Detectors occasionally probe for these
  // (e.g. http-no-redirect checks for ":status"); swallow the error
  // and return null so the detector can fall back to a regular
  // header check rather than crashing the scan.
  try {
    return headers.get(key);
  } catch {
    return null;
  }
}

export function hasHeader(headers: Headers, key: string): boolean {
  // Same forbidden-name protection as getHeader: detect() will throw
  // TypeError for keys starting with ":" or containing non-token
  // characters, which would crash a scan mid-flight. Treat as absent.
  try {
    return headers.has(key);
  } catch {
    return false;
  }
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
  // Best-effort strip of non-HTML regions so other detectors don't over-fire
  // on inline JS/CSS. Body is capped at 1 MB by the caller. These patterns
  // match only literal start-tag + end-tag-with-optional-whitespace, which
  // is the narrowest safe form. Exotic variants like </script\n foo> are NOT
  // stripped — that's intentional; they'd cause false positives, not misses.
  let s = input.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " "); // codeql[js/bad-tag-filter]
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " "); // codeql[js/bad-tag-filter]
  s = s.replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, " "); // codeql[js/bad-tag-filter]
  return s.replace(/\s+/g, " ");
}

/**
 * Strip `<script>` and code/example regions (`<code>`, `<pre>`, `<kbd>`,
 * `<samp>`, `<template>`) from a response body for regex matching.
 *
 * Distinct from `stripNonHtml` above: this does NOT strip `<style>` or
 * HTML comments, because secrets/PII detectors intentionally still scan
 * those regions (e.g. a leaked token left in an HTML comment is a real
 * finding). It DOES additionally strip `<code>/<pre>/<kbd>/<samp>` so that
 * documentation pages showing example payloads, IPs, or credit-card
 * numbers as sample text don't self-trigger the same detectors.
 *
 * Same narrow start-tag + end-tag-with-optional-whitespace matching as
 * `stripNonHtml` — see that function's comment for why exotic unclosed
 * variants are deliberately not stripped.
 */
export function stripExampleContent(input: string): string {
  // This removes <script>/<code>/<pre>/<template> regions from a scanned
  // page's body before other detectors run pattern matching on it; the
  // result is never treated as sanitized HTML or rendered anywhere, so an
  // incomplete strip changes detection accuracy, not security.
  let s = input.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ""); // codeql[js/bad-tag-filter,js/incomplete-multi-character-sanitization]
  s = s.replace(
    /<(?:code|pre|kbd|samp|template)\b[^>]*>[\s\S]*?<\/(?:code|pre|kbd|samp|template)\s*>/gi, // codeql[js/bad-tag-filter,js/incomplete-multi-character-sanitization]
    "",
  );
  return s;
}

/**
 * Strip documentation/example rendering regions (`<code>`, `<pre>`, `<kbd>`,
 * `<samp>`) from a response body, WITHOUT touching `<script>` content.
 *
 * Distinct from `stripExampleContent` above: that helper also removes
 * `<script>` blocks, which is wrong for detectors that specifically need
 * to inspect real inline script content (e.g. vibe-code.ts's patterns look
 * for eval(), SQL string concatenation, etc. inside actual <script> tags,
 * not inside a documentation page's <pre> block). This helper only removes
 * the tags a documentation/tutorial page uses to display example code as
 * text, so a page that *talks about* a vulnerable pattern -- this
 * product's own /docs pages included, which render every check's
 * `codeExamples` as literal "Bad (AI-generated)" snippets -- doesn't
 * self-trigger a detector meant to catch the pattern actually shipped in a
 * site's live script.
 */
export function stripDocBlocks(input: string): string {
  return input.replace(
    /<(?:code|pre|kbd|samp)\b[^>]*>[\s\S]*?<\/(?:code|pre|kbd|samp)\s*>/gi, // codeql[js/bad-tag-filter,js/incomplete-multi-character-sanitization]
    "",
  );
}

/**
 * Extract the inner text of every `<script>` element in a response body.
 *
 * Used by detectors that need to inspect JS source specifically (e.g.
 * eval() usage inside inline scripts) rather than exclude it from
 * matching. Same narrow tag-matching rules as `stripNonHtml`.
 */
export function extractScriptContents(input: string): string[] {
  const scripts: string[] = [];
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi; // codeql[js/bad-tag-filter]
  let m: RegExpExecArray | null;
  while ((m = scriptPattern.exec(input)) !== null) {
    scripts.push(m[1]);
  }
  return scripts;
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
