import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CATALOG } from "@/lib/i18n/messages/catalog";
import type { Locale } from "@/lib/i18n/config";

/**
 * The signed-in header's row: logo, nav, then bell / language / theme / log
 * out. Its desktop nav used to be absolutely centred on the viewport from lg
 * (1024px) up, which meant it took no space in the row, so wherever its
 * labels were wider than the gap either side of the centre they ran underneath
 * the right-hand controls (which are painted over it). It now sits in the
 * flow and starts at xl (1280px).
 *
 * No DOM and no layout engine here (vitest.config.ts runs `node`), so this
 * does two things:
 *
 *  1. reads header.tsx for the class contract (which breakpoint shows the
 *     nav, which one swaps in the menu button, that nothing is absolutely
 *     positioned), and
 *  2. runs those breakpoints against widths measured once in a real browser,
 *     and fails if a width changes shape.
 *
 * HOW THE WIDTHS BELOW WERE TAKEN. A page holding the exact class strings
 * from header.tsx was compiled with this repo's Tailwind (4.3.3) and loaded in
 * Chromium on Windows, whose Tailwind default `font-sans` resolves to Segoe
 * UI, at viewport widths 1024, 1100 and 1280. Each label set was the real
 * `nav` namespace from lib/i18n/messages. The numbers are the rendered CSS
 * widths of the link row (first link's left edge to last link's right edge)
 * and of the right-hand cluster, in px. They are not portable to the pixel
 * (macOS and Linux fall back to other sans fonts, Linux's generally wider),
 * which is what the FONT_MARGIN headroom below is for. To re-take them after a
 * label change, rebuild the same page with the new strings and read
 * getBoundingClientRect(); the labels test below tells you when that is due.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Source with comments stripped, so prose naming a class cannot satisfy it. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ─── Tailwind's default breakpoints, in px ───────────────────────────────

const BREAKPOINTS = [
  ["sm", 640],
  ["md", 768],
  ["lg", 1024],
  ["xl", 1280],
  ["2xl", 1536],
] as const;

const DISPLAYS = ["flex", "inline-flex", "block", "inline-block", "grid"];

/**
 * Is an element with these classes displayed at this viewport width? Only the
 * display utilities matter here: `hidden` and `<bp>:hidden` turn it off,
 * `flex`, `<bp>:flex` and friends turn it on, and a later (wider) breakpoint
 * wins over an earlier one, as min-width media queries do.
 */
function displayedAt(classNames: string, width: number): boolean {
  const tokens = classNames.split(/\s+/);
  let shown = !tokens.includes("hidden");
  if (tokens.some((t) => DISPLAYS.includes(t))) shown = true;
  if (tokens.includes("hidden")) shown = false;
  for (const [bp, min] of BREAKPOINTS) {
    if (width < min) break;
    if (tokens.includes(`${bp}:hidden`)) shown = false;
    if (tokens.some((t) => DISPLAYS.some((d) => t === `${bp}:${d}`))) {
      shown = true;
    }
  }
  return shown;
}

// ─── The class contract, read out of header.tsx ──────────────────────────

const header = code("components/scanner/header.tsx");

function classOf(pattern: RegExp, what: string): string {
  const match = header.match(pattern);
  expect(match, `header.tsx: could not find ${what}`).not.toBeNull();
  return match![1];
}

const NAV = classOf(
  /<nav\s+aria-label="Main"\s+className="([^"]+)"/,
  "the Main nav",
);
const ROW = classOf(
  /<div className="([^"]*max-w-7xl[^"]*)">/,
  "the header row container",
);
const RIGHT = classOf(
  /<div className="([^"]*ml-auto[^"]*)">/,
  "the right-hand cluster",
);
const MENU_BUTTON = classOf(
  /aria-label=\{t\("openMenu"\)\}\s+className="([^"]+)"/,
  "the menu button",
);
const LOG_OUT = classOf(
  /onClick=\{handleLogout\}\s+className="([^"]+)"/,
  "the inline log out button",
);
const DIVIDER = classOf(/<div className="([^"]*w-px[^"]*)"/, "the divider");

// ─── Widths measured in a browser, px ────────────────────────────────────

type Measured = {
  /** The `nav` namespace labels the widths were measured with, in link order. */
  labels: readonly string[];
  logOut: string;
  /** First link's left edge to last link's right edge, without Admin. */
  nav: number;
  /** Bell, language, theme, divider and log out, with the inline nav showing. */
  right: number;
};

const NAV_KEYS = [
  "scanner",
  "history",
  "repos",
  "compare",
  "shared",
  "teams",
  "badge",
  "profile",
] as const;

const MEASURED: Record<string, Measured> = {
  en: {
    labels: [
      "Scanner",
      "History",
      "Repos",
      "Compare",
      "Shared",
      "Teams",
      "Badge",
      "Profile",
    ],
    logOut: "Log out",
    nav: 523.1,
    right: 252.1,
  },
  de: {
    labels: [
      "Scanner",
      "Verlauf",
      "Repositorys",
      "Vergleichen",
      "Geteilt",
      "Teams",
      "Badge",
      "Profil",
    ],
    logOut: "Abmelden",
    nav: 561.3,
    right: 268.4,
  },
  fr: {
    labels: [
      "Scanner",
      "Historique",
      "Dépôts",
      "Comparer",
      "Partagés",
      "Équipes",
      "Badge",
      "Profil",
    ],
    logOut: "Se déconnecter",
    nav: 566.8,
    right: 300.7,
  },
  es: {
    labels: [
      "Escáner",
      "Historial",
      "Repositorios",
      "Comparar",
      "Compartidos",
      "Equipos",
      "Insignia",
      "Perfil",
    ],
    logOut: "Cerrar sesión",
    nav: 618.5,
    right: 285.5,
  },
  "pt-BR": {
    labels: [
      "Scanner",
      "Histórico",
      "Repositórios",
      "Comparar",
      "Compartilhados",
      "Times",
      "Selo",
      "Perfil",
    ],
    logOut: "Sair",
    nav: 608.9,
    right: 226.8,
  },
  ja: {
    labels: [
      "スキャナー",
      "履歴",
      "リポジトリ",
      "比較",
      "共有",
      "チーム",
      "バッジ",
      "プロフィール",
    ],
    logOut: "ログアウト",
    nav: 563.9,
    right: 272.6,
  },
};

/** Logo mark plus the 18px mono wordmark. */
const LOGO = 119;
/** The Admin link staff get at the end of the row: label, padding and gap. */
const ADMIN_LINK = 58.7;
/** Bell, language, theme toggle and the 44px menu button below xl. */
const RIGHT_BELOW_XL = 192;
/** A classic Windows scrollbar, which the media query counts and layout does not. */
const SCROLLBAR = 17;
/** Link row must clear this share of its own width, for a wider font. */
const FONT_MARGIN = 0.12;

// ─── The layout model ────────────────────────────────────────────────────

const MAX_CONTAINER = 1280; // max-w-7xl
const PAD_X = 24; // sm:px-6, each side, from 640px
const GAP = Number(ROW.match(/\bgap-(\d+)\b/)?.[1] ?? 0) * 4;

function innerWidth(viewport: number, scrollbar: number): number {
  return Math.min(viewport - scrollbar, MAX_CONTAINER) - 2 * PAD_X;
}

/**
 * Free space in the row, px, as the layout in header.tsx lays it out: logo, a
 * flex-1 nav (when shown) and the right-hand cluster, with the row's gap
 * between. Negative means the row does not fit.
 */
function freeSpace(
  viewport: number,
  m: Measured,
  staff: boolean,
  scrollbar = 0,
): { free: number; navShown: boolean; navWidth: number } {
  const navShown = displayedAt(NAV, viewport);
  const navWidth = navShown ? m.nav + (staff ? ADMIN_LINK : 0) : 0;
  const right = navShown ? m.right : RIGHT_BELOW_XL;
  const gaps = navShown ? 2 * GAP : GAP;
  return {
    free: innerWidth(viewport, scrollbar) - (LOGO + navWidth + right + gaps),
    navShown,
    navWidth,
  };
}

/**
 * How far the previous layout's nav overran the right-hand cluster. The nav
 * was absolutely centred, so it was centred on the row's inner width whatever
 * the cluster beside it measured: its right edge sat at inner/2 + nav/2 and the
 * cluster started at inner - right.
 */
function previousOverlap(
  viewport: number,
  m: Measured,
  staff: boolean,
): number {
  const nav = m.nav + (staff ? ADMIN_LINK : 0);
  const inner = innerWidth(viewport, 0);
  return inner / 2 + nav / 2 - (inner - m.right);
}

const ASKED_ABOUT = ["en", "de", "fr", "es"] as const;
const ALL_LOCALES = Object.keys(MEASURED);

// ─── Tests ───────────────────────────────────────────────────────────────

describe("the measurements are for the labels the app ships", () => {
  it.each(ALL_LOCALES)("%s", (locale) => {
    const messages = CATALOG[locale as Locale] as {
      nav: Record<string, string>;
    };
    const m = MEASURED[locale];
    expect(NAV_KEYS.map((k) => messages.nav[k])).toEqual([...m.labels]);
    expect(messages.nav.logOut).toBe(m.logOut);
  });

  it("covers every locale the app has", () => {
    const shipped = fs
      .readdirSync(path.join(ROOT, "lib/i18n/messages"), {
        withFileTypes: true,
      })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect([...ALL_LOCALES].sort()).toEqual(shipped);
  });
});

describe("the inline nav is in the flow and starts at xl", () => {
  it("is displayed from xl and not before", () => {
    expect(displayedAt(NAV, 1023)).toBe(false);
    expect(displayedAt(NAV, 1024)).toBe(false);
    expect(displayedAt(NAV, 1100)).toBe(false);
    expect(displayedAt(NAV, 1279)).toBe(false);
    expect(displayedAt(NAV, 1280)).toBe(true);
  });

  it("takes the width between the logo and the right-hand cluster", () => {
    const tokens = NAV.split(/\s+/);
    expect(tokens).toContain("flex-1");
    // Without min-w-0 a flex item will not shrink below its content, and the
    // nav would push the right-hand cluster out instead of giving way.
    expect(tokens).toContain("min-w-0");
    expect(tokens).toContain("justify-center");
  });

  it("is not absolutely positioned or translated out of the flow", () => {
    expect(NAV).not.toMatch(/\babsolute\b/);
    expect(NAV).not.toMatch(/translate-x/);
    expect(ROW).not.toMatch(/\brelative\b/);
    expect(header).not.toMatch(/left-1\/2/);
    // The z-10 on the right-hand cluster and the logo existed only to paint
    // them over a nav that overlapped them.
    expect(RIGHT).not.toMatch(/\bz-\d+/);
  });

  it("keeps the right-hand cluster at its full width", () => {
    expect(RIGHT.split(/\s+/)).toContain("shrink-0");
  });

  it("keeps each link on one line", () => {
    expect(header).toMatch(/whitespace-nowrap px-2\.5 py-1\.5/);
    expect(header).toMatch(/whitespace-nowrap px-2 py-1\.5/);
  });
});

describe("the menu button covers exactly the widths the nav does not", () => {
  it.each([320, 640, 768, 1024, 1100, 1279])(
    "at %ipx the nav is hidden, the menu button shown",
    (width) => {
      expect(displayedAt(NAV, width)).toBe(false);
      expect(displayedAt(MENU_BUTTON, width)).toBe(true);
    },
  );

  it.each([1280, 1440, 1536, 1920])(
    "at %ipx the nav is shown, the menu button gone",
    (width) => {
      expect(displayedAt(NAV, width)).toBe(true);
      expect(displayedAt(MENU_BUTTON, width)).toBe(false);
    },
  );

  it("swaps log out and its divider at the same width as the nav", () => {
    for (const width of [1023, 1024, 1100, 1279, 1280, 1600]) {
      const navShown = displayedAt(NAV, width);
      expect(displayedAt(LOG_OUT, width), `log out at ${width}`).toBe(navShown);
      expect(displayedAt(DIVIDER, width), `divider at ${width}`).toBe(navShown);
    }
  });
});

describe("1024px and 1100px, in the four languages that overran", () => {
  it.each(
    ASKED_ABOUT.flatMap((locale) =>
      [1024, 1100].flatMap((width) =>
        [false, true].map((staff) => [locale, width, staff] as const),
      ),
    ),
  )(
    "%s at %ipx (staff: %s) has no nav to overlap and room to spare",
    (locale, width, staff) => {
      const m = MEASURED[locale];
      const { free, navShown } = freeSpace(width, m, staff, SCROLLBAR);
      expect(navShown).toBe(false);
      // Nothing is left in the row but the logo and four icon buttons.
      expect(free).toBeGreaterThan(500);
    },
  );

  it("is the reason the nav moved: the old centred nav overran there", () => {
    // 1024px: every one of the four, with or without the Admin link.
    for (const locale of ASKED_ABOUT) {
      for (const staff of [false, true]) {
        expect(
          previousOverlap(1024, MEASURED[locale], staff),
          `${locale} staff=${staff} at 1024`,
        ).toBeGreaterThan(0);
      }
    }
    // 1100px: English fits for an ordinary user, and nothing else does.
    expect(previousOverlap(1100, MEASURED.en, false)).toBeLessThan(0);
    expect(previousOverlap(1100, MEASURED.en, true)).toBeGreaterThan(0);
    for (const locale of ["de", "fr", "es"]) {
      for (const staff of [false, true]) {
        expect(
          previousOverlap(1100, MEASURED[locale], staff),
          `${locale} staff=${staff} at 1100`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("matches what the audit measured at 1024px, to a few px", () => {
    // 23 / 52 / 58 / 93 / 103 px for en / en staff / de / fr / es, taken on a
    // separate rebuild of the row. A model that disagrees by more than the
    // font rounding has stopped describing the layout.
    const near = (got: number, want: number) =>
      expect(Math.abs(got - want)).toBeLessThanOrEqual(5);
    near(previousOverlap(1024, MEASURED.en, false), 23);
    near(previousOverlap(1024, MEASURED.en, true), 52);
    near(previousOverlap(1024, MEASURED.de, false), 58);
    near(previousOverlap(1024, MEASURED.fr, false), 93);
    near(previousOverlap(1024, MEASURED.es, false), 103);
  });

  it("is also why taking the nav out of absolute alone was not enough", () => {
    // Put in the flow at lg, Spanish staff still do not fit at 1100px, and
    // French and Spanish staff do not fit at 1024px: a menu would have been
    // needed anyway. Evaluated as though the nav were shown at these widths.
    const inFlow = (viewport: number, locale: string, staff: boolean) => {
      const m = MEASURED[locale];
      const nav = m.nav + (staff ? ADMIN_LINK : 0);
      return innerWidth(viewport, 0) - (LOGO + nav + m.right + 2 * GAP);
    };
    expect(inFlow(1100, "es", true)).toBeLessThan(0);
    expect(inFlow(1024, "fr", true)).toBeLessThan(0);
    expect(inFlow(1024, "es", true)).toBeLessThan(0);
  });
});

describe("from xl up the nav fits in the flow, with room for a wider font", () => {
  const cases = ALL_LOCALES.flatMap((locale) =>
    [1280, 1366, 1440, 1920].flatMap((width) =>
      [false, true].flatMap((staff) =>
        [0, SCROLLBAR].map(
          (scrollbar) => [locale, width, staff, scrollbar] as const,
        ),
      ),
    ),
  );

  it.each(cases)(
    "%s at %ipx (staff: %s, scrollbar: %ipx)",
    (locale, width, staff, scrollbar) => {
      const m = MEASURED[locale];
      const { free, navShown, navWidth } = freeSpace(
        width,
        m,
        staff,
        scrollbar,
      );
      expect(navShown).toBe(true);
      expect(free).toBeGreaterThanOrEqual(navWidth * FONT_MARGIN);
    },
  );

  it("the tightest case still has the margin, so xl is not accidental", () => {
    // Spanish staff at exactly 1280px with a classic scrollbar: the narrowest
    // the nav is ever shown, with the longest label set.
    const { free, navWidth } = freeSpace(1280, MEASURED.es, true, SCROLLBAR);
    expect(free).toBeGreaterThan(0);
    expect(free / navWidth).toBeGreaterThanOrEqual(FONT_MARGIN);
    // And lg would not have had it, which is what the margin is buying.
    const atLg =
      innerWidth(1024, SCROLLBAR) -
      (LOGO + navWidth + MEASURED.es.right + 2 * GAP);
    expect(atLg).toBeLessThan(0);
  });
});
