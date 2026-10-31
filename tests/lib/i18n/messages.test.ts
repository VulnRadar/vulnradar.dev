/**
 * The translation files themselves (lib/i18n/messages/).
 *
 * English is the source. A translation may not lose a placeholder (a sentence
 * with a hole where the host name goes). Which keys each language has is
 * key-parity.test.ts.
 *
 * It also holds the rule in lib/i18n/README.md that some things are the same
 * in every language: the documentation domain and IP in particular, which are
 * reserved for exactly that (RFC 2606, RFC 5737), where a translated
 * "ejemplo.com" is a real domain somebody owns.
 */
import { describe, it, expect } from "vitest";
import { LOCALES, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { flatten, loadLocale as load } from "./_messages";

/** The {placeholders} a string interpolates, ignoring plural machinery. */
function placeholders(value: string): Set<string> {
  return new Set(
    [...value.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*[,}]/g)].map((m) => m[1]),
  );
}

const english = flatten(load(DEFAULT_LOCALE));
const translations = LOCALES.filter((l) => l !== DEFAULT_LOCALE);

describe("every translation", () => {
  it.each(translations)("%s keeps every placeholder", (locale) => {
    const wrong: string[] = [];
    for (const [key, value] of flatten(load(locale))) {
      const expected = english.get(key);
      if (expected === undefined) continue;
      const missing = [...placeholders(expected)].filter(
        (name) => !placeholders(value).has(name),
      );
      if (missing.length > 0)
        wrong.push(`${key}: missing {${missing.join("}, {")}}`);
    }
    expect(wrong).toEqual([]);
  });

  it.each(translations)(
    "%s leaves the documentation domain and IP alone",
    (locale) => {
      const value = flatten(load(locale)).get("scan.urlPlaceholder") ?? "";
      expect(value).toContain("example.com");
      expect(value).toContain("203.0.113.10");
    },
  );

  it.each(LOCALES)("%s is complete enough to read, or falls back", (locale) => {
    // Not a completeness requirement: the merge in lib/i18n/messages.ts puts
    // English behind every language on purpose. What must hold is that the
    // file parses and is a tree of strings.
    const flat = flatten(load(locale));
    expect(flat.size).toBeGreaterThan(0);
    for (const value of flat.values()) expect(typeof value).toBe("string");
  });
});
