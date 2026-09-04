/**
 * Display handling for `Vulnerability.evidenceExcerpts`.
 *
 * An excerpt is a verbatim fragment of a THIRD PARTY's HTTP response: a
 * Set-Cookie header, a script src, a line of their markup. The checks produce
 * it (lib/scanner/check-types.ts's `excerpt()`), the engine attaches it, and
 * the API ships it to the browser unchanged. Every consumer therefore handles
 * attacker-controlled bytes, and a finding panel that rendered a scanned
 * site's HTML into our own DOM would be the exact bug class this product
 * exists to find.
 *
 * Two hazards, and neither is solved by React's automatic escaping alone:
 *
 *  1. **Active markup.** React escapes a text child, so the value must reach
 *     the DOM as a text child and never through dangerouslySetInnerHTML. The
 *     report generators have no such default, which is why the Markdown
 *     export puts excerpts inside a fence and the SARIF export leaves them as
 *     JSON string properties.
 *  2. **Invisible characters.** A NUL, an ESC, a zero-width space or a bidi
 *     override (U+202E and friends) survives escaping intact and changes what
 *     a human reads without changing what the string is. Evidence whose whole
 *     job is "here is exactly what we saw" must not be able to lie about
 *     itself, so those are replaced with a visible U+FFFD rather than passed
 *     through or silently dropped.
 *
 * Pure and client-safe (no DB, no fs), so the issue panel, the Markdown
 * report and the SARIF report all normalize identically.
 */

import type { EvidenceExcerpt } from "./types";

/** Hard cap on how many excerpts any one finding contributes to a view. */
export const MAX_EXCERPTS = 24;

/** Characters to show before the UI offers "show the whole value". */
export const EXCERPT_PREVIEW_CHARS = 160;

/** Excerpts shown before the panel offers "show all". */
export const EXCERPT_PREVIEW_COUNT = 4;

/** Ceiling on a single stored value; `excerpt()` already truncates to 300. */
const MAX_VALUE_CHARS = 400;

/** Ceiling on a label, which is check-authored but still worth bounding. */
const MAX_LABEL_CHARS = 80;

/**
 * Control characters (Cc), format characters (Cf: zero-width joiners, bidi
 * overrides, the BOM) and the two line/paragraph separators. Whitespace is
 * collapsed before this runs, so anything left here is invisible or actively
 * misleading, never meaningful.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** One line of text, with nothing in it that can hide or reorder itself. */
export function sanitizeExcerptValue(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(INVISIBLE, "�")
    .trim()
    .slice(0, MAX_VALUE_CHARS);
}

function sanitizeLabel(label: string): string {
  return sanitizeExcerptValue(label).slice(0, MAX_LABEL_CHARS);
}

/** A 1-based line number, or undefined for anything that isn't one. */
function sanitizeLine(line: unknown): number | undefined {
  if (typeof line !== "number" || !Number.isFinite(line)) return undefined;
  const n = Math.floor(line);
  return n >= 1 ? n : undefined;
}

/**
 * Normalize whatever arrived on the wire into excerpts safe to render.
 *
 * Takes `unknown` on purpose: this runs on a JSON payload, so the shape is a
 * claim rather than a guarantee, and a `.map` over something that turned out
 * not to be an array is how a result page 500s on one malformed row.
 */
export function toDisplayExcerpts(raw: unknown): EvidenceExcerpt[] {
  if (!Array.isArray(raw)) return [];
  const out: EvidenceExcerpt[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { label, value, line } = item as Record<string, unknown>;
    if (typeof value !== "string") continue;
    const cleanValue = sanitizeExcerptValue(value);
    if (cleanValue.length === 0) continue;
    const cleanLine = sanitizeLine(line);
    out.push({
      label: typeof label === "string" ? sanitizeLabel(label) : "evidence",
      value: cleanValue,
      ...(cleanLine === undefined ? {} : { line: cleanLine }),
    });
    if (out.length >= MAX_EXCERPTS) break;
  }
  return out;
}

/** The head of a value plus whether anything was cut off. */
export function truncateExcerpt(
  value: string,
  limit: number = EXCERPT_PREVIEW_CHARS,
): { preview: string; truncated: boolean } {
  if (value.length <= limit) return { preview: value, truncated: false };
  return { preview: value.slice(0, limit), truncated: true };
}

/**
 * One excerpt as a single plain-text line, for the exports. Already
 * sanitized by toDisplayExcerpts, so callers only need their own format's
 * escaping (a Markdown fence, a JSON string) on top.
 */
export function formatExcerptLine(ex: EvidenceExcerpt): string {
  const where = ex.line === undefined ? "" : ` (line ${ex.line})`;
  return `${ex.label}${where}: ${ex.value}`;
}
