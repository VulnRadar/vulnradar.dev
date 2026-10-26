import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LOCALES, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { showsLegalLanguageNotice } from "@/components/legal/legal-language";
import { LEGAL_NAV_PAGES } from "@/components/legal/legal-pages";

/**
 * Every legal page used to open with "English is the version that applies",
 * rendered by LegalShell above the page title, for English readers too. The
 * notice is now conditional on the locale and sits under the H1.
 *
 * The decision is a pure function so it can be tested for real; where the
 * notice renders is a source-text assertion, because the suite runs under
 * `node` with no DOM (see tests/components/shared/mobile-layout-invariants).
 */

const ROOT = path.resolve(__dirname, "../../..");

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("showsLegalLanguageNotice", () => {
  it("is off for English, where there is no language gap to explain", () => {
    expect(showsLegalLanguageNotice(DEFAULT_LOCALE)).toBe(false);
    expect(showsLegalLanguageNotice("en")).toBe(false);
  });

  it.each(LOCALES.filter((l) => l !== "en"))("is on for %s", (locale) => {
    expect(showsLegalLanguageNotice(locale)).toBe(true);
  });
});

describe("where the notice renders", () => {
  it("LegalShell no longer renders it above the page", () => {
    const shell = code("components/legal/legal-shell.tsx");
    expect(shell).not.toContain("Callout");
    expect(shell).not.toContain("useTranslations");
    expect(shell).not.toContain("languageTitle");
    // The hook was the only reason this was a client component.
    expect(
      fs.readFileSync(
        path.join(ROOT, "components/legal/legal-shell.tsx"),
        "utf8",
      ),
    ).not.toMatch(/^"use client"/);
  });

  it("LegalPageHeader renders it after the H1", () => {
    const header = code("components/legal/legal-page-header.tsx");
    const h1 = header.indexOf("</h1>");
    const notice = header.indexOf("<LegalLanguageNotice");
    expect(h1).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(h1);
  });

  it("the /legal index renders it after its own H1", () => {
    const page = code("app/legal/page.tsx");
    const h1 = page.indexOf("</h1>");
    const notice = page.indexOf("<LegalLanguageNotice");
    expect(h1).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(h1);
  });

  it("the notice component is gated on the locale and keeps the existing copy keys", () => {
    const notice = code("components/legal/legal-language-notice.tsx");
    expect(notice).toContain("useLocale()");
    expect(notice).toContain("showsLegalLanguageNotice(locale)");
    // The copy waits for the translation wave: same two keys, same namespace.
    expect(notice).toContain('useTranslations("legal")');
    expect(notice).toContain('t("languageTitle")');
    expect(notice).toContain('t("languageNotice")');
  });

  it("every legal document page renders LegalPageHeader, which carries the notice", () => {
    for (const page of LEGAL_NAV_PAGES) {
      const rel = `app${page.href}/page.tsx`;
      expect(code(rel), rel).toContain("<LegalPageHeader");
    }
  });
});

describe("LegalNav labels", () => {
  it("writes the short label out instead of taking the first word", () => {
    expect(code("components/legal/legal-nav.tsx")).not.toContain("split(");
    expect(code("components/legal/legal-nav.tsx")).toContain("page.shortLabel");
  });

  it("no short label is a bare 'Acceptable'", () => {
    const acceptable = LEGAL_NAV_PAGES.find(
      (p) => p.href === "/legal/acceptable-use",
    );
    expect(acceptable?.shortLabel).toBe("Acceptable use");
  });

  it("short labels are non-empty, distinct, and never longer than the full label", () => {
    const shorts = LEGAL_NAV_PAGES.map((p) => p.shortLabel);
    expect(new Set(shorts).size).toBe(shorts.length);
    for (const page of LEGAL_NAV_PAGES) {
      expect(page.shortLabel.trim().length).toBeGreaterThan(0);
      expect(page.shortLabel.length).toBeLessThanOrEqual(page.label.length);
    }
  });

  it("lists exactly the documents the /legal index lists", () => {
    const index = fs.readFileSync(
      path.join(ROOT, "app/legal/page.tsx"),
      "utf8",
    );
    const indexHrefs = [...index.matchAll(/href:\s*"(\/legal\/[a-z-]+)"/g)]
      .map((m) => m[1])
      .sort();
    expect(LEGAL_NAV_PAGES.map((p) => p.href).sort()).toEqual(indexHrefs);
  });

  it("every chip points at a real page", () => {
    for (const page of LEGAL_NAV_PAGES) {
      expect(
        fs.existsSync(path.join(ROOT, `app${page.href}/page.tsx`)),
        page.href,
      ).toBe(true);
    }
  });
});
