import { isLocale } from "@/lib/i18n/config";

/**
 * What a screen reader needs to know about a support message that is not in
 * the page's language.
 *
 * Kept out of the component so the rules can be tested without rendering it.
 */

/**
 * The `lang` for the message text on screen, or undefined to inherit the page's.
 *
 * Only the author's own words carry their language. A translation is written in
 * the reader's language, which is the page's, so it inherits. Without this a
 * Japanese or German original was read out with the English voice and its
 * pronunciation rules (WCAG 3.1.2, Language of Parts).
 *
 * `bodyLocale` comes from the database, but it is checked against the locales
 * the app speaks anyway: an arbitrary string in a lang attribute is a bug of
 * its own.
 */
export function originalTextLang(
  bodyLocale: string | null | undefined,
  readingTranslation: boolean,
): string | undefined {
  if (readingTranslation) return undefined;
  return bodyLocale && isLocale(bodyLocale) ? bodyLocale : undefined;
}

export const TRANSLATE_FAILED_TEXT =
  "Could not translate this one. It is shown as written.";

/** The live region's text: the failure, or nothing. */
export function translateStatusText(failed: boolean): string {
  return failed ? TRANSLATE_FAILED_TEXT : "";
}
