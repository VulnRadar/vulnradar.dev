/**
 * Which language a reader gets (lib/i18n/config.ts).
 *
 * There are no locale-prefixed URLs, so this negotiation IS the routing: the
 * account's saved setting, then the browser's cookie, then Accept-Language,
 * then English.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  LOCALE_ENGLISH_NAMES,
  isLocale,
  negotiateLocale,
  resolveLocale,
} from "@/lib/i18n/config";

describe("negotiateLocale", () => {
  it("takes the exact language when the browser asks for one we have", () => {
    expect(negotiateLocale("pt-BR,pt;q=0.9")).toBe("pt-BR");
    expect(negotiateLocale("ja")).toBe("ja");
  });

  it("falls back to the language when the region is one we do not have", () => {
    // pt-PT is not Brazilian Portuguese, but it is far closer than English.
    expect(negotiateLocale("pt-PT")).toBe("pt-BR");
    expect(negotiateLocale("en-GB")).toBe("en");
    expect(negotiateLocale("es-419,es;q=0.8")).toBe("es");
  });

  it("honours the order the browser puts its languages in", () => {
    expect(negotiateLocale("da, fr;q=0.8, de;q=0.9")).toBe("de");
  });

  it("ignores a language the browser says it does not want", () => {
    expect(negotiateLocale("de;q=0, fr;q=0.5")).toBe("fr");
  });

  it("falls back to English for a header we cannot use", () => {
    expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("*")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("kl-GL")).toBe(DEFAULT_LOCALE);
  });
});

describe("resolveLocale", () => {
  it("prefers the account's own setting over everything else", () => {
    expect(
      resolveLocale({ saved: "ja", cookie: "fr", acceptLanguage: "de" }),
    ).toBe("ja");
  });

  it("uses the cookie for a reader with no account setting", () => {
    expect(
      resolveLocale({ saved: null, cookie: "fr", acceptLanguage: "de" }),
    ).toBe("fr");
  });

  it("asks the browser when nothing has been chosen", () => {
    expect(resolveLocale({ acceptLanguage: "de-AT,de;q=0.9" })).toBe("de");
  });

  it("ignores a saved or stored value that is not a language we have", () => {
    expect(
      resolveLocale({ saved: "klingon", cookie: "nope", acceptLanguage: "es" }),
    ).toBe("es");
  });
});

describe("isLocale", () => {
  it("accepts every locale the app lists and nothing else", () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true);
    expect(isLocale("en-US")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });

  it("names every language, in its own words and in English", () => {
    for (const locale of LOCALES) {
      expect(LOCALE_NAMES[locale]).toBeTruthy();
      expect(LOCALE_ENGLISH_NAMES[locale]).toBeTruthy();
    }
  });
});
