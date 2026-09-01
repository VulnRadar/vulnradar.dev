// Title and meta-description builders for the ~750 per-check SEO pages.
//
// Both of these used to live in app/checks/[id]/page.tsx as a single hard
// clamp over a concatenated string, and both produced bad output at scale.
// The title was "How to fix: " plus the check title cut at 36 characters,
// which put an ellipsis in 348 of the 749 titles and collapsed 22 pages onto
// 8 identical strings (five different Permissions-Policy directives all
// published as "How to fix: Permissions-Policy..."), because the part that
// distinguishes a check is at the END of its title and a head clamp always
// removed it. The description concatenated a boilerplate lead-in, the
// description and riskImpact and clamped the lot to 155, so 682 of 749
// snippets ended mid-clause.
//
// The rule now is the same for both: add a part only when it fits whole, and
// never truncate the part that makes the page distinct. They live here rather
// than in the page so tests/lib/seo/check-meta.test.ts can assert over the
// whole check set that no two pages publish the same title.

import { clampText } from "@/lib/seo/metadata";
import {
  getAllChecks,
  getCategoryLabel,
  type SeoCheck,
} from "@/lib/seo/checks-content";

/** Titles minus " | VulnRadar" (12 chars) against the ~60-char display width. */
const TITLE_BUDGET = 48;

const DESCRIPTION_MAX = 155;

/** Collapse runs of whitespace so a JSON entry with a newline still measures right. */
function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Check titles that more than one check shares. Three exist today
 * (two `Usage Detected` titles that appear in two categories each, plus a
 * Django one), and they are the only reason two /checks pages could still
 * publish the same <title>. Disambiguated with the category label rather than
 * truncated, so both pages stay findable.
 */
const AMBIGUOUS_TITLES: ReadonlySet<string> = (() => {
  const seen = new Map<string, number>();
  for (const check of getAllChecks()) {
    const title = normalise(check.title);
    seen.set(title, (seen.get(title) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([title]) => title));
})();

export function buildCheckTitle(check: SeoCheck): string {
  const title = normalise(check.title);
  const base = AMBIGUOUS_TITLES.has(title)
    ? `${title} (${getCategoryLabel(check.category)})`
    : title;
  // Keep the "how to fix" query phrasing when it fits, fall back to the
  // shorter " fix" suffix, and finally publish the title on its own. A long
  // title is left whole: search engines truncate the display themselves, and
  // a distinct-but-long title beats an ellipsised duplicate.
  if (`How to fix: ${base}`.length <= TITLE_BUDGET)
    return `How to fix: ${base}`;
  if (`${base} fix`.length <= TITLE_BUDGET) return `${base} fix`;
  return base;
}

/**
 * Longest prefix of `text` that ends on a sentence terminator and fits in
 * `max`, or null when the only such prefix would be shorter than `min` (which
 * would leave the snippet as the boilerplate lead-in and nothing else).
 */
function endOnSentence(text: string, max: number, min: number): string | null {
  const clean = normalise(text);
  if (clean.length <= max) return clean;
  const match = clean.slice(0, max).match(/^[\s\S]*[.!?](?=\s|$)/);
  if (match && match[0].length >= min) return match[0].trimEnd();
  return null;
}

export function buildCheckDescription(check: SeoCheck): string {
  const severity = check.severity;
  const label = getCategoryLabel(check.category).toLowerCase();
  const lead = `${severity.charAt(0).toUpperCase()}${severity.slice(1)}-severity ${label} finding.`;
  const full = `${lead} ${normalise(check.description)}`;
  if (full.length > DESCRIPTION_MAX) {
    // Prefer stopping on a complete sentence; the word-boundary clamp is the
    // last resort for a check whose first sentence is itself over the window.
    // clampText's `max` bounds the text BEFORE its ellipsis, so the budget it
    // gets has to leave room for the three dots it appends.
    return (
      endOnSentence(full, DESCRIPTION_MAX, 100) ??
      clampText(full, DESCRIPTION_MAX - 3)
    );
  }
  const risk = check.riskImpact ? normalise(check.riskImpact) : "";
  // riskImpact is appended only when the whole sentence fits, so a terse
  // description still fills the window without ever being cut in half.
  return risk && full.length + 1 + risk.length <= DESCRIPTION_MAX
    ? `${full} ${risk}`
    : full;
}
