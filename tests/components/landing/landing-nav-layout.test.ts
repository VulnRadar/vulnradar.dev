import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LOCALES } from "@/lib/i18n/config";

/**
 * The public top bar has to fit the screen it is on, in every language.
 *
 * It did not. The inline links appeared at md (768px) and, in English, the row
 * came to about 826px: a 768px iPad lost the end of the "Start free" button.
 * On a 375px phone the sign-up label in French ("Commencer gratuitement") or
 * German pushed the menu button off the right edge, and html and body are
 * overflow-x: clip, so nothing scrolled: the control was just gone, and it is
 * the only way to reach Pricing, Docs and Contact on a phone.
 *
 * This file cannot measure a layout (vitest runs `node`, there is no DOM and
 * no layout engine, same constraint as mobile-layout-invariants.test.ts), so it
 * does the next best thing: it reads the real label strings out of every
 * locale's message file, prices each element of the bar in pixels, and asks the
 * question the browser would. The widths are the ones measured in Chromium on
 * a replica of this bar, old and new, across 720 viewport/locale/state
 * combinations:
 *
 *   - text-sm labels came out at 6.1 to 7.5px per character in Latin script,
 *     so 7.6 is a ceiling rather than an average. Full-width CJK is 14.
 *   - the mono wordmark is 76px on Windows and about 86px with Menlo, so the
 *     mark, its gap and the wordmark are budgeted at 124.
 *
 * The estimate is deliberately on the high side. A false failure here means
 * "measure it again", a false pass means a clipped button on somebody's phone.
 */
const ROOT = path.resolve(__dirname, "../../..");
const NAV = "components/landing/landing-nav.tsx";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Source with comments stripped, so prose about a class cannot satisfy it. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

type NavMessages = Record<
  | "pricing"
  | "docs"
  | "demo"
  | "changelog"
  | "contact"
  | "logIn"
  | "signUp"
  | "startFree",
  string
>;

function navMessages(locale: string): NavMessages {
  const file = path.join(ROOT, "lib/i18n/messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")).nav;
}

const LATIN_PX = 7.6;
const CJK_PX = 14;
const WORDMARK_PX = 124;
const LANGUAGE_MENU_PX = 36;
const THEME_TOGGLE_PX = 64;
const MENU_BUTTON_PX = 44;
const ARROW_PX = 6 + 16;

function textPx(label: string): number {
  let px = 0;
  for (const ch of label) {
    px += /[　-鿿＀-￯]/.test(ch) ? CJK_PX : LATIN_PX;
  }
  return px;
}

/** A Button size="sm" is its label plus px-2.5 below sm and px-3 from sm up. */
const buttonPx = (label: string, padX: number, extra = 0) =>
  textPx(label) + padX * 2 + extra;

/** Tailwind's default screens, which tailwind.config.mjs does not override. */
const SCREEN_PX: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
};

/** The breakpoint the inline link row appears at, read from the component. */
function inlineLinksBreakpoint(): string {
  const match = code(NAV).match(/hidden (sm|md|lg|xl):flex items-center gap-6/);
  if (!match) throw new Error("the inline link row is not in landing-nav.tsx");
  return match[1];
}

describe("the public top bar fits, in every language", () => {
  describe.each([...LOCALES])("%s", (locale) => {
    const t = navMessages(locale);

    it("fits a 375px phone with the wordmark, the sign-up button and the menu button", () => {
      // px-4 each side, gap-3 between the three items, gap-2 inside the right
      // group, and the short label with no arrow (both are sm-and-up).
      const inner = 375 - 32;
      const needed =
        WORDMARK_PX + 12 + buttonPx(t.signUp, 10) + 8 + MENU_BUTTON_PX;
      expect(needed).toBeLessThanOrEqual(inner);
    });

    it("fits a 768px tablet below the inline-links breakpoint", () => {
      // From sm up: px-6, gap-6, the language menu, log in, the full sign-up
      // button with its arrow, and the menu button, at gap-2 apart.
      const inner = 768 - 48;
      const needed =
        WORDMARK_PX +
        24 +
        LANGUAGE_MENU_PX +
        8 +
        buttonPx(t.logIn, 12) +
        8 +
        buttonPx(t.startFree, 12, ARROW_PX) +
        8 +
        MENU_BUTTON_PX;
      expect(needed).toBeLessThanOrEqual(inner);
    });

    it("fits the bar with the inline links at the breakpoint they appear at", () => {
      const bp = SCREEN_PX[inlineLinksBreakpoint()];
      const inner = bp - 48;
      const links =
        [t.pricing, t.docs, t.demo, t.changelog, t.contact]
          .map(textPx)
          .reduce((a, b) => a + b, 0) +
        4 * 24;
      // The theme toggle joins the bar here, and the menu button leaves it.
      const right =
        LANGUAGE_MENU_PX +
        THEME_TOGGLE_PX +
        8 +
        buttonPx(t.logIn, 12) +
        8 +
        buttonPx(t.startFree, 12, ARROW_PX);
      const needed = WORDMARK_PX + 24 + links + 24 + right;
      expect(needed).toBeLessThanOrEqual(inner);
    });
  });
});

describe("the short sign-up label earns its place", () => {
  it("is needed: French's full label alone overflows a 375px phone", () => {
    // If this starts passing, the full label fits everywhere and the
    // sm:hidden swap in the nav is dead weight to delete.
    const t = navMessages("fr");
    const inner = 375 - 32;
    const withFullLabel =
      WORDMARK_PX +
      12 +
      buttonPx(t.startFree, 10, ARROW_PX) +
      8 +
      MENU_BUTTON_PX;
    expect(withFullLabel).toBeGreaterThan(inner);
  });
});

describe("landing-nav.tsx keeps the contract the numbers above assume", () => {
  const src = code(NAV);

  it("shows the inline links from lg, and not before", () => {
    expect(inlineLinksBreakpoint()).toBe("lg");
  });

  it("hides the menu button and the menu panel at the same breakpoint", () => {
    const bp = inlineLinksBreakpoint();
    expect(src).toContain(`"${bp}:hidden inline-flex shrink-0`);
    expect(src).toMatch(
      new RegExp(`id="landing-nav-mobile"\\s+className="${bp}:hidden `),
    );
    expect(src).not.toMatch(/\bmd:(?:hidden|flex)\b/);
  });

  it("keeps the theme toggle out of the bar below lg and in the menu panel", () => {
    // Once in a `hidden lg:block` wrapper in the bar, once bare in the panel.
    expect(src).toMatch(
      /<div className="hidden lg:block">\s*<ThemeToggle \/>\s*<\/div>/,
    );
    expect(src.match(/<ThemeToggle \/>/g)).toHaveLength(2);
  });

  it("swaps the sign-up label to the short nav.signUp below sm", () => {
    expect(src).toContain('<span className="sm:hidden">{t("signUp")}</span>');
    expect(src).toContain(
      '<span className="hidden sm:inline">{t("startFree")}</span>',
    );
    // The arrow is the other half of the saving.
    expect(src).toMatch(/<ArrowRight className="hidden [^"]*sm:block" \/>/);
  });

  it("puts `hidden` on the log in anchor itself, not on a button inside it", () => {
    // asChild merges the classes onto the <a>. Around a hidden button the
    // anchor stayed rendered with no text and still took a tab stop.
    expect(src).toMatch(
      /asChild\s+variant="ghost"\s+size="sm"\s+className="hidden sm:inline-flex h-8"/,
    );
  });

  it("lets the logo link give way and keeps the right group at full size", () => {
    // Measured: with min-w-0 on the right group it shrank under its own
    // nowrap buttons and the menu button hung out of it at 320px; as shrink-0
    // the wordmark yields instead and nothing clips.
    expect(src).toMatch(/className="flex shrink-0 items-center gap-2 ml-auto"/);
    expect(src).toMatch(
      /"flex h-6 min-w-0 flex-wrap items-center gap-x-2\.5 overflow-hidden rounded-sm"/,
    );
  });
});
