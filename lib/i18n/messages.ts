import { DEFAULT_LOCALE, type Locale } from "./config";

/**
 * The words for one language, with English behind them.
 *
 * A translation that is missing a key falls through to English rather than
 * rendering the key: a half-translated page in two languages is usable, and a
 * page of dotted identifiers is not. That also means a new string can ship in
 * English and be translated afterwards without breaking any language.
 *
 * Static imports, not a dynamic path: every message file has to be in the
 * bundle the server runs, and a template literal import leaves the bundler
 * guessing.
 */
import en from "./messages/en.json";
import es from "./messages/es.json";
import fr from "./messages/fr.json";
import de from "./messages/de.json";
import ptBR from "./messages/pt-BR.json";
import ja from "./messages/ja.json";

type Messages = typeof en;

const BY_LOCALE: Record<Locale, Messages> = {
  en,
  es: es as Messages,
  fr: fr as Messages,
  de: de as Messages,
  "pt-BR": ptBR as Messages,
  ja: ja as Messages,
};

/** Deep merge of a translation over English, so every key always resolves. */
function withEnglishBehind(
  translated: Record<string, unknown>,
  english: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...english };
  for (const [key, value] of Object.entries(translated)) {
    const base = english[key];
    merged[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? withEnglishBehind(
            value as Record<string, unknown>,
            (base && typeof base === "object" ? base : {}) as Record<
              string,
              unknown
            >,
          )
        : value;
  }
  return merged;
}

const cache = new Map<Locale, Messages>();

export async function getMessages(locale: Locale): Promise<Messages> {
  if (locale === DEFAULT_LOCALE) return en;
  const cached = cache.get(locale);
  if (cached) return cached;
  const merged = withEnglishBehind(
    BY_LOCALE[locale] as unknown as Record<string, unknown>,
    en as unknown as Record<string, unknown>,
  ) as Messages;
  cache.set(locale, merged);
  return merged;
}

export type { Messages };
