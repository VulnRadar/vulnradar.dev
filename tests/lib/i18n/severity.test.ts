/**
 * The severity words (lib/i18n/severity.ts) and the label function built from
 * them, in every language, for a request, a hook and a mail with no request.
 */
import { describe, it, expect, vi } from "vitest";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { CATALOG } from "@/lib/i18n/messages/catalog";
import {
  SEVERITY_LABEL_KEYS,
  severityLabeller,
  type ResultTranslator,
} from "@/lib/i18n/severity";
import { SEVERITY_LABELS, SEVERITY_ORDER } from "@/lib/config/client-constants";

vi.mock("@/lib/database/db", () => ({ default: { query: vi.fn() } }));

const result = (locale: Locale) =>
  CATALOG[locale].result as Record<string, string>;

describe("SEVERITY_LABEL_KEYS", () => {
  it("has one key for each severity the product knows, no more", () => {
    expect(Object.keys(SEVERITY_LABEL_KEYS).sort()).toEqual(
      [...SEVERITY_ORDER].sort(),
    );
  });

  it.each(LOCALES)(
    "names a real message in %s for every severity",
    (locale) => {
      for (const severity of SEVERITY_ORDER) {
        expect(
          result(locale)[SEVERITY_LABEL_KEYS[severity]],
          `${locale}.result.${SEVERITY_LABEL_KEYS[severity]}`,
        ).toEqual(expect.any(String));
      }
    },
  );

  it("agrees with the English label the untranslated surfaces print", () => {
    // SEVERITY_LABELS is what a surface that has not moved to t() shows; the
    // two must not call the same rung different things (it was once "Info" on
    // the scan pages and "Informational" on the public ones).
    for (const severity of SEVERITY_ORDER) {
      expect(result("en")[SEVERITY_LABEL_KEYS[severity]]).toBe(
        SEVERITY_LABELS[severity],
      );
    }
  });

  it.each(LOCALES.filter((l) => l !== "en"))(
    "is translated in %s, not copied from English",
    (locale) => {
      const same = SEVERITY_ORDER.filter(
        (s) =>
          result(locale)[SEVERITY_LABEL_KEYS[s]] ===
          result("en")[SEVERITY_LABEL_KEYS[s]],
      );
      // "Info" is the same word in several languages; the other four are not
      // the same word in any of the five translations.
      expect(same.filter((s) => s !== "info")).toEqual([]);
    },
  );
});

describe("severityLabeller", () => {
  const t: ResultTranslator = (key) => `<${key}>`;

  it("asks the translator for the key of the severity", () => {
    const label = severityLabeller(t);
    expect(label("critical")).toBe("<severityCritical>");
    expect(label("info")).toBe("<severityInfo>");
  });

  it("prints a value it has no word for as it is", () => {
    // A row written by an older engine; a dotted key on screen is worse.
    const label = severityLabeller(t);
    expect(label("informational" as never)).toBe("informational");
  });
});

describe("getSeverityLabeller (a mail away from a request)", () => {
  it.each(LOCALES)("speaks %s", async (locale) => {
    const { getSeverityLabeller } = await import("@/lib/i18n/translate");
    const label = await getSeverityLabeller(locale);
    for (const severity of SEVERITY_ORDER) {
      expect(label(severity)).toBe(
        result(locale)[SEVERITY_LABEL_KEYS[severity]],
      );
    }
  });
});
