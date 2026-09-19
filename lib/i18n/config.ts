/**
 * The languages the app speaks, and how it decides which one to use.
 *
 * Deliberately without locale-prefixed URLs. Every page keeps the address it
 * has, which matters here more than usual: /checks alone is ~750 statically
 * generated pages, and prefixing them per language would multiply the build
 * and split the links people have already shared. The language comes from the
 * reader instead, in this order:
 *
 *   1. the signed-in account's saved setting (mirrored into the cookie below
 *      when it is set, and when a session starts, so rendering never needs a
 *      database round trip),
 *   2. this browser's cookie, for a visitor who is not signed in,
 *   3. the Accept-Language header the browser sends,
 *   4. English.
 *
 * Pure, and free of next-intl, so the negotiation is testable on its own and
 * usable from the email sender, which has no request behind it.
 */

export const LOCALES = ["en", "es", "fr", "de", "pt-BR", "ja"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Each language's name in that language, which is how a switcher lists them. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  "pt-BR": "Português (Brasil)",
  ja: "日本語",
};

/**
 * Each language's name in English, for the one reader that is not a person:
 * the AI's system prompt, which follows "Answer in Japanese" more reliably
 * than it follows "Answer in 日本語".
 */
export const LOCALE_ENGLISH_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  "pt-BR": "Brazilian Portuguese",
  ja: "Japanese",
};

/** Cookie the browser carries the choice in. Readable by the server only. */
export const LOCALE_COOKIE = "vr_locale";

/** A year: the choice is a preference, not a session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/**
 * The closest language we have to what the browser asked for.
 *
 * Matches the exact tag first (pt-BR), then the language on its own (pt), so a
 * browser asking for pt-PT gets Brazilian Portuguese rather than English, and
 * one asking for en-GB gets English. Quality values are honoured, since that
 * is how a browser says which of its languages it prefers.
 */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number.parseFloat(q);
      return {
        tag: tag.trim(),
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    if (tag === "*") return DEFAULT_LOCALE;
    const exact = LOCALES.find(
      (locale) => locale.toLowerCase() === tag.toLowerCase(),
    );
    if (exact) return exact;
    const language = tag.split("-")[0].toLowerCase();
    const byLanguage = LOCALES.find(
      (locale) => locale.split("-")[0].toLowerCase() === language,
    );
    if (byLanguage) return byLanguage;
  }
  return DEFAULT_LOCALE;
}

/** The locale to render in, given what this request carries. */
export function resolveLocale(input: {
  saved?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(input.saved)) return input.saved;
  if (isLocale(input.cookie)) return input.cookie;
  return negotiateLocale(input.acceptLanguage ?? null);
}
