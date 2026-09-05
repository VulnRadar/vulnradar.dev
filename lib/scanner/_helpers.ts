/**
 * Shared helpers for detector functions.
 *
 * Lives at lib/scanner/_helpers.ts so both the registry and the per-
 * category detector modules can import the same primitives.
 */

// checks/_tag-scan.ts is the one place that knows how to walk HTML tags in a
// single forward pass. The strippers below used to carry their own
// `<tag\b[^>]*>[\s\S]*?</tag\s*>` copies of the exact shape it was written to
// replace, which is why they stayed quadratic after every detector that used
// that shape had been fixed.
import { stripTagElements, tagElementContents } from "./checks/_tag-scan";

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

/**
 * True when a single Set-Cookie string carries the given attribute
 * (e.g. "Secure", "HttpOnly", "SameSite"). Splits on ';' and matches the
 * attribute TOKEN, skipping the leading name=value segment -- a naive
 * `cookie.includes("secure")` treats `sid=x; Domain=secure.example.com` (the
 * word "secure" is in the domain) or a `__Secure-`/`session` NAME as having the
 * flag, which silently suppressed missing-Secure/HttpOnly/SameSite findings on
 * real session cookies. Matches both boolean flags ("secure") and valued
 * attributes ("samesite=lax").
 */
export function cookieHasAttribute(cookie: string, attribute: string): boolean {
  const attr = attribute.toLowerCase();
  const parts = cookie.split(";").slice(1); // drop name=value; keep attributes
  for (const part of parts) {
    const token = part.trim().toLowerCase();
    if (token === attr || token.startsWith(`${attr}=`)) return true;
  }
  return false;
}

export type EvidenceFn = (
  url: string,
  headers: Headers,
  body: string,
) => string | null;

/** Tags a documentation or tutorial page uses to render example code as
 *  literal text. */
const DOC_BLOCK_TAGS = ["code", "pre", "kbd", "samp"] as const;

/**
 * Strip `<script>` and code/example regions (`<code>`, `<pre>`, `<kbd>`,
 * `<samp>`, `<template>`) from a response body for regex matching.
 *
 * Does NOT strip `<style>` or HTML comments, because secrets/PII detectors
 * intentionally still scan those regions (e.g. a leaked token left in an
 * HTML comment is a real finding). It DOES strip `<code>/<pre>/<kbd>/<samp>`
 * so that documentation pages showing example payloads, IPs, or credit-card
 * numbers as sample text don't self-trigger the same detectors.
 *
 * The result is never treated as sanitized HTML or rendered anywhere, so an
 * incomplete strip changes detection accuracy, not security.
 */
export function stripExampleContent(input: string): string {
  return stripTagElements(stripTagElements(input, ["script"]), [
    ...DOC_BLOCK_TAGS,
    "template",
  ]);
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
  return stripTagElements(input, DOC_BLOCK_TAGS);
}

/**
 * `stripDocBlocks` memoised on the body it was last given.
 *
 * Three detector modules (api.ts, supply-chain.ts, vibe-code.ts) wrap EVERY
 * detector they export in a `stripDocBlocks(body)` call, which is roughly 150
 * strips of the same body per scan. Making the strip linear (see
 * `stripTagElements`) fixes the shape of the cost but not the multiplier: 150
 * linear strips of a 1 MB body is still 150 MB of copying that produces the
 * same string every time. The engine hands every detector the same body
 * string object, so a one-entry memo collapses all of it to one strip per
 * scan, across all three modules rather than one each.
 *
 * It holds one body (the 1 MB execute-scan caps at, at most) until the next
 * scan replaces it. That is deliberate and is the whole mechanism: the entry
 * has to outlive the individual detector call to be worth anything.
 */
let lastStripInput: string | null = null;
let lastStripOutput = "";

/**
 * Wrap a raw detector map so every detector sees the body with
 * documentation/example regions already removed, stripping ONCE per body
 * rather than once per detector.
 */
export function withDocBlocksStripped(
  raw: Record<string, EvidenceFn>,
): Record<string, EvidenceFn> {
  return Object.fromEntries(
    Object.entries(raw).map(([id, fn]) => [
      id,
      ((url, headers, body) => {
        if (body !== lastStripInput) {
          lastStripOutput = stripDocBlocks(body);
          lastStripInput = body;
        }
        return fn(url, headers, lastStripOutput);
      }) as EvidenceFn,
    ]),
  );
}

/**
 * Extract the inner text of every `<script>` element in a response body.
 *
 * Used by detectors that need to inspect JS source specifically (e.g.
 * eval() usage inside inline scripts) rather than exclude it from
 * matching.
 */
export function extractScriptContents(input: string): string[] {
  return tagElementContents(input, ["script"]);
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
