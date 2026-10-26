import { DEFAULT_LOCALE } from "@/lib/i18n/config";

/**
 * Whether the "English is the version that applies" notice belongs on a legal
 * page for this reader.
 *
 * It is a statement about the gap between the language being read and the
 * language the agreement is written in. For a reader already in English there
 * is no gap, and the notice used to tell them to switch to English at the top
 * of a page that was English.
 */
export function showsLegalLanguageNotice(locale: string): boolean {
  return locale !== DEFAULT_LOCALE;
}
