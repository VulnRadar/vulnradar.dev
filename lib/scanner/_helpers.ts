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
 * Stable, deterministic finding ID: `<checkId>--<hash>`.
 * Two scans of the same URL produce the same IDs for the same findings,
 * enabling reliable diffing between scans.
 *
 * `distinguisher`, when given, is folded into the hash alongside `url`. A
 * check's `run()` is allowed to return more than one `CheckHit` for a single
 * page (see check-types.ts's `CheckHit | CheckHit[] | null`), and without a
 * per-hit distinguisher every hit from that check on that page would
 * collapse onto the exact same id: a React list key collision, and a
 * false_positive mark on one hit (scan_finding_feedback is keyed on this id)
 * silently suppressing the other, unrelated hit too. Leaving it undefined
 * (every single-hit check, which is the overwhelming majority) reproduces
 * the exact id this function has always produced, so existing feedback rows
 * and regression-alert baselines keyed on the old id stay valid.
 */
export function generateId(
  checkId: string,
  url: string,
  distinguisher?: string,
): string {
  const hashInput = distinguisher ? `${url} ${distinguisher}` : url;
  return `${checkId}--${fnvHash(hashInput)}`;
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
 * The CSP header string plus any <meta http-equiv="Content-Security-Policy">
 * content, concatenated. A meta-tag CSP is exactly as binding on the
 * browser as the header (a page can carry one and not the other, or
 * different directives in each -- both apply), so "is directive X present"
 * checks need to see both, not just the header. Was previously only done
 * ad hoc in csp-frame-src-missing (lib/scanner/checks/headers.ts); every
 * other CSP check silently ignored a meta-only CSP, either wrongly
 * reporting "no CSP at all" (csp-missing) or wrongly skipping a directive
 * check entirely, since the header string alone was empty.
 */
export function getEffectiveCsp(headers: Headers, body: string): string {
  const headerCsp = getHeader(headers, "content-security-policy") || "";
  const metaTag = body.match(
    /<meta\b[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/i,
  )?.[0];
  // A real CSP value is full of single quotes ('self', 'unsafe-inline',
  // ...), so a shared [^"']* class terminates at the FIRST one -- e.g.
  // content="default-src 'self'; form-action 'self'" would capture only
  // "default-src " and silently drop everything after it. Match
  // double-quoted and single-quoted attribute forms separately instead,
  // each only stopping at ITS OWN quote character.
  const metaCsp =
    metaTag?.match(/content="([^"]*)"/i)?.[1] ??
    metaTag?.match(/content='([^']*)'/i)?.[1] ??
    "";
  if (headerCsp && metaCsp) return `${headerCsp}; ${metaCsp}`;
  return headerCsp || metaCsp;
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
