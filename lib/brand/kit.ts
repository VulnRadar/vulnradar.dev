/**
 * The brand kit, defined once.
 *
 * scripts/assets/build-brand-kit.mjs reads this module to draw every file in
 * public/brand/, and app/brand renders the same values on the page, so the
 * clear space the diagram shows is the clear space the banners were drawn
 * with and the sizes the chips offer are the sizes on disk. The script runs
 * under plain Node (type stripping, no bundler), so this file imports nothing
 * and uses only syntax Node can erase: no enums, no path aliases.
 *
 * Client-safe: no environment, no server modules. It also carries no Tailwind
 * class strings, because tailwind.config.mjs does not scan lib/.
 */

/** Where public/brand/ is served from. */
export const BRAND_KIT_BASE = "/brand";
export const BRAND_KIT_ZIP = "vulnradar-brand-kit.zip";
/** Every entry in the ZIP sits under this folder, so unzipping it into a
 *  downloads folder makes one folder rather than four plus a README. */
export const BRAND_KIT_ZIP_ROOT = "vulnradar-brand-kit";

/**
 * What the files may be used for, in the one wording both /brand and the
 * kit's README print. The code is GPL-3.0; this sentence is the only grant
 * for the artwork, so it says what is allowed rather than "free to use".
 */
export const USE_TERMS =
  "Free to use when you write about VulnRadar, link to it, or show that something works with it.";

// ─── The mark ──────────────────────────────────────────────────────────────
//
// public/favicon.svg draws the mark on a 24-unit square: a disc of radius 11
// centred in it, so one unit of transparent margin on every side. All the
// proportions below are in units of the disc's diameter (D), not of the
// square, because the disc is the edge a viewer actually sees.

export const MARK_GRID = 24;
export const MARK_DISC_DIAMETER = 22;

/**
 * Clear space X, as a fraction of D. A quarter of the disc: at the 24 px the
 * site header draws the mark, that is about 5.5 px, which is the most a
 * header row can give before it pushes its own links away.
 */
export const CLEAR_SPACE = 0.25;

/** Smallest the mark is drawn, square, in CSS pixels. The favicon's size. */
export const MARK_MIN_PX = 16;

/**
 * Smallest the horizontal lockup is drawn, in CSS pixels of total width.
 * Chosen by rendering it at 80, 96, 112 and 128 px on a standard-density
 * screen. At 80 the mark inside it is 15.8 px square, under the mark's own
 * minimum, and the bowls of "a" and "d" close up. From 96 both read. Below
 * this, use the mark alone.
 */
export const LOCKUP_MIN_WIDTH_PX = 96;

// ─── The wordmark ──────────────────────────────────────────────────────────

/**
 * public/brand/source/vulnradar-wordmark.svg's viewBox: "VulnRadar" in
 * JetBrains Mono SemiBold at 100 units per em, tracking -0.025em, outlined.
 * The box is the ink, so its height is the cap height (73) plus the one unit
 * the round letters dip below the baseline. The build script fails if the
 * file stops matching these.
 */
export const WORDMARK_VIEWBOX = { width: 509.7, height: 74 } as const;

export const WORDMARK_FACE = {
  family: "JetBrains Mono",
  weight: "SemiBold (600)",
  version: "2.304",
  license: "SIL Open Font License 1.1",
  tracking: "-0.025em",
  source: "https://github.com/JetBrains/JetBrainsMono",
} as const;

/** The wordmark is the only part of the lockup that changes colour. */
export const WORDMARK_COLOURS = {
  "on-dark": "#f1f5f9",
  "on-light": "#0f172a",
} as const;

export type LockupVariant = keyof typeof WORDMARK_COLOURS;
export const LOCKUP_VARIANTS: readonly LockupVariant[] = [
  "on-dark",
  "on-light",
];

// ─── The lockup ────────────────────────────────────────────────────────────

/**
 * Horizontal: mark, gap, wordmark, centred on one line. The wordmark's ink is
 * 0.6 D tall, which is the cap height the site header gives "VulnRadar" (18
 * px type beside a 22 px disc). The gap is 0.4 D, a little tighter than the
 * header's half disc, which reads loose once the lockup is drawn large.
 *
 * Stacked: mark above the wordmark, both centred. Used where the slot is too
 * square for the horizontal one to be drawn at a useful size. The wordmark is
 * 2.4 D wide so the mark keeps its weight over it.
 */
export const LOCKUP = {
  horizontal: { wordmarkHeight: 0.6, gap: 0.4 },
  stacked: { wordmarkWidth: 2.4, gap: 0.3 },
} as const;

export type LockupLayout = keyof typeof LOCKUP;

const WORDMARK_ASPECT = WORDMARK_VIEWBOX.width / WORDMARK_VIEWBOX.height;

export interface LockupBox {
  layout: LockupLayout;
  /** Ink box, in units of D. */
  width: number;
  height: number;
  /** The disc's top-left corner inside the box, in D. */
  mark: { x: number; y: number };
  /** The wordmark's box inside the lockup box, in D. */
  wordmark: { x: number; y: number; width: number; height: number };
}

export function lockupBox(layout: LockupLayout): LockupBox {
  if (layout === "horizontal") {
    const { wordmarkHeight, gap } = LOCKUP.horizontal;
    const wordmarkWidth = wordmarkHeight * WORDMARK_ASPECT;
    return {
      layout,
      width: 1 + gap + wordmarkWidth,
      height: 1,
      mark: { x: 0, y: 0 },
      wordmark: {
        x: 1 + gap,
        y: (1 - wordmarkHeight) / 2,
        width: wordmarkWidth,
        height: wordmarkHeight,
      },
    };
  }
  const { wordmarkWidth, gap } = LOCKUP.stacked;
  const wordmarkHeight = wordmarkWidth / WORDMARK_ASPECT;
  const width = Math.max(1, wordmarkWidth);
  return {
    layout,
    width,
    height: 1 + gap + wordmarkHeight,
    mark: { x: (width - 1) / 2, y: 0 },
    wordmark: {
      x: (width - wordmarkWidth) / 2,
      y: 1 + gap,
      width: wordmarkWidth,
      height: wordmarkHeight,
    },
  };
}

/** The disc's diameter in the source lockup SVGs, in SVG units. */
export const SOURCE_LOCKUP_DISC = 100;

/**
 * A source lockup SVG's size in whole pixels, for the width and height of an
 * <img> that shows it. The SVG itself writes the unrounded value.
 */
export function sourceLockupSize(layout: LockupLayout) {
  const box = lockupBox(layout);
  return {
    width: Math.round(box.width * SOURCE_LOCKUP_DISC),
    height: Math.round(box.height * SOURCE_LOCKUP_DISC),
  };
}

export interface LockupFit {
  layout: LockupLayout;
  /** Disc diameter in pixels. */
  d: number;
  /** Top-left of the lockup's ink box on the canvas, in pixels. */
  x: number;
  y: number;
  /** Ink box size in pixels. */
  width: number;
  height: number;
  /** Height of the wordmark's ink in pixels. */
  wordmarkHeight: number;
}

/**
 * The largest lockup that fits a W x H canvas with clear space X on every
 * side, centred. Of the two layouts, the one that draws the wordmark larger
 * wins, because the wordmark is what stops being legible first; a tie goes to
 * the horizontal one.
 */
export function fitLockup(canvasWidth: number, canvasHeight: number) {
  const fits = (["horizontal", "stacked"] as const).map((layout) => {
    const box = lockupBox(layout);
    const d = Math.min(
      canvasWidth / (box.width + 2 * CLEAR_SPACE),
      canvasHeight / (box.height + 2 * CLEAR_SPACE),
    );
    const width = box.width * d;
    const height = box.height * d;
    return {
      layout,
      d,
      x: (canvasWidth - width) / 2,
      y: (canvasHeight - height) / 2,
      width,
      height,
      wordmarkHeight: box.wordmark.height * d,
    } satisfies LockupFit;
  });
  const [horizontal, stacked] = fits;
  return stacked.wordmarkHeight > horizontal.wordmarkHeight
    ? stacked
    : horizontal;
}

// ─── The files ─────────────────────────────────────────────────────────────

export const LOGO_SIZES = [
  16, 32, 48, 64, 96, 128, 144, 152, 180, 192, 256, 512, 1024,
] as const;

/** Banner and social slots, as [width, height]. */
export const LOCKUP_SLOTS: readonly (readonly [number, number])[] = [
  [970, 250],
  [970, 90],
  [728, 90],
  [468, 60],
  [320, 100],
  [320, 50],
  [234, 60],
  [300, 250],
  [300, 600],
  [1200, 630],
  [1200, 300],
  [1500, 500],
  [960, 540],
  [1920, 600],
];

export const PROFILE_SIZES = [128, 192, 256, 512, 1024] as const;
/** The opaque ones, for an avatar slot that flattens transparency. */
export const PROFILE_NAVY_SIZES = [512, 1024] as const;

/** The disc's colour, which the -navy profile pictures fill the square with. */
export const PROFILE_NAVY = "#0f172a";

/**
 * How large the -navy profile pictures draw the radar, as a fraction of the
 * square. The disc is the same navy as the fill, so it vanishes and only the
 * radar reads; drawing it smaller leaves the arcs a margin inside a circular
 * crop.
 */
export const PROFILE_NAVY_SCALE = 0.8;

export type BrandFileKind = "logo" | "lockup" | "profile" | "source" | "readme";

export interface BrandFile {
  /** Path under public/brand/, and inside the ZIP's root folder. */
  path: string;
  kind: BrandFileKind;
  width?: number;
  height?: number;
  /** PNGs only: transparent corners, or the opaque navy square. */
  background?: "transparent" | "navy";
  variant?: LockupVariant;
  layout?: LockupLayout;
}

const px = (w: number, h: number) => `${w}x${h}`;

export const logoFile = (size: number) =>
  `logo/vulnradar-logo-${px(size, size)}.png`;
export const lockupFile = (variant: LockupVariant, w: number, h: number) =>
  `lockup/vulnradar-lockup-${variant}-${px(w, h)}.png`;
export const profileFile = (size: number, navy = false) =>
  `profile/vulnradar-profile-${px(size, size)}${navy ? "-navy" : ""}.png`;

export const SOURCE_FILES = {
  mark: "source/vulnradar-logo.svg",
  wordmark: "source/vulnradar-wordmark.svg",
  lockup: {
    horizontal: {
      "on-dark": "source/vulnradar-lockup-on-dark.svg",
      "on-light": "source/vulnradar-lockup-on-light.svg",
    },
    stacked: {
      "on-dark": "source/vulnradar-lockup-stacked-on-dark.svg",
      "on-light": "source/vulnradar-lockup-stacked-on-light.svg",
    },
  },
} as const;

export const README_FILE = "README.md";

/** Every file in the kit, in the order the ZIP lists them. */
export function brandKitFiles(): BrandFile[] {
  const files: BrandFile[] = [];
  for (const size of LOGO_SIZES) {
    files.push({
      path: logoFile(size),
      kind: "logo",
      width: size,
      height: size,
      background: "transparent",
    });
  }
  for (const variant of LOCKUP_VARIANTS) {
    for (const [w, h] of LOCKUP_SLOTS) {
      files.push({
        path: lockupFile(variant, w, h),
        kind: "lockup",
        width: w,
        height: h,
        background: "transparent",
        variant,
        layout: fitLockup(w, h).layout,
      });
    }
  }
  for (const size of PROFILE_SIZES) {
    files.push({
      path: profileFile(size),
      kind: "profile",
      width: size,
      height: size,
      background: "transparent",
    });
  }
  for (const size of PROFILE_NAVY_SIZES) {
    files.push({
      path: profileFile(size, true),
      kind: "profile",
      width: size,
      height: size,
      background: "navy",
    });
  }
  files.push({ path: SOURCE_FILES.mark, kind: "source" });
  files.push({ path: SOURCE_FILES.wordmark, kind: "source" });
  for (const layout of ["horizontal", "stacked"] as const) {
    for (const variant of LOCKUP_VARIANTS) {
      files.push({
        path: SOURCE_FILES.lockup[layout][variant],
        kind: "source",
        variant,
        layout,
      });
    }
  }
  files.push({ path: README_FILE, kind: "readme" });
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The URL a file is served at. */
export const brandUrl = (path: string) => `${BRAND_KIT_BASE}/${path}`;

/**
 * The icons the site itself ships, outside public/brand/. All of them are
 * the mark exactly as public/favicon.svg draws it, on a transparent square.
 */
export const SITE_ICONS = {
  ico: { path: "favicon.ico", sizes: [16, 32, 48] },
  png: [
    { path: "icon-192.png", size: 192 },
    { path: "icon-512.png", size: 512 },
    { path: "apple-touch-icon.png", size: 180 },
  ],
} as const;

// ─── Colour ────────────────────────────────────────────────────────────────

/**
 * Every colour public/favicon.svg uses, and the part of the mark it paints.
 * tests/lib/brand/kit.test.ts reads the SVG and fails if this drifts.
 */
export const LOGO_PALETTE = [
  { name: "Disc", hex: "#0f172a", part: "The disc everything sits on" },
  {
    name: "Sweep",
    hex: "#3b82f6",
    part: "The two filled sectors, at 20% and 40% opacity",
  },
  { name: "Arcs", hex: "#60a5fa", part: "The radar arcs and the centre dot" },
  { name: "Beam", hex: "#ffffff", part: "The sweep line" },
  { name: "Contacts", hex: "#fbbf24", part: "The two blips on the scope" },
] as const;

/**
 * The interface tokens, as app/globals.css defines them (HSL) converted to
 * hex. Light is the :root block, dark the .dark block. The test converts the
 * CSS again and compares, so editing a token without this table fails.
 */
export const UI_PALETTE = [
  {
    token: "primary",
    name: "Primary",
    use: "Buttons, focus rings, the one accent",
    light: { hsl: "213 94% 68%", hex: "#61a6fa" },
    dark: { hsl: "213 94% 68%", hex: "#61a6fa" },
  },
  {
    token: "background",
    name: "Background",
    use: "The page",
    light: { hsl: "213 25% 90%", hex: "#dfe5ec" },
    dark: { hsl: "224 20% 6%", hex: "#0c0e12" },
  },
  {
    token: "card",
    name: "Card",
    use: "Panels and cards on the page",
    light: { hsl: "213 22% 95%", hex: "#eff2f5" },
    dark: { hsl: "224 18% 9%", hex: "#13151b" },
  },
  {
    token: "foreground",
    name: "Foreground",
    use: "Body text and headings",
    light: { hsl: "220 20% 10%", hex: "#14181f" },
    dark: { hsl: "210 20% 95%", hex: "#f0f2f5" },
  },
  {
    token: "muted-foreground",
    name: "Muted foreground",
    use: "Secondary text, captions, metadata",
    light: { hsl: "220 12% 35%", hex: "#4f5664" },
    dark: { hsl: "220 8% 65%", hex: "#9fa3ad" },
  },
  {
    token: "border",
    name: "Border",
    use: "Hairlines, panel edges, dividers",
    light: { hsl: "213 16% 78%", hex: "#bec6d0" },
    dark: { hsl: "224 15% 16%", hex: "#23262f" },
  },
] as const;

export const SEVERITY_PALETTE = [
  {
    token: "severity-critical",
    name: "Critical",
    light: { hsl: "0 84% 33%", hex: "#9b0d0d" },
    dark: { hsl: "0 84% 60%", hex: "#ef4343" },
  },
  {
    token: "severity-high",
    name: "High",
    light: { hsl: "25 95% 28%", hex: "#8b3c04" },
    dark: { hsl: "25 95% 53%", hex: "#f97415" },
  },
  {
    token: "severity-medium",
    name: "Medium",
    light: { hsl: "45 93% 26%", hex: "#806105" },
    dark: { hsl: "45 93% 47%", hex: "#e7b008" },
  },
  {
    token: "severity-low",
    name: "Low",
    light: { hsl: "210 90% 39%", hex: "#0a63bd" },
    dark: { hsl: "210 90% 56%", hex: "#2a8ff4" },
  },
  {
    token: "severity-info",
    name: "Info",
    light: { hsl: "220 10% 41%", hex: "#5e6573" },
    dark: { hsl: "215 15% 55%", hex: "#7b899d" },
  },
] as const;

// ─── Type ──────────────────────────────────────────────────────────────────

/**
 * The stacks the interface renders in: Tailwind's defaults, which the app
 * uses unchanged (tailwind.config.mjs extends no fontFamily). The test reads
 * them out of the installed tailwindcss/theme.css.
 */
export const INTERFACE_FONTS = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
} as const;

// ─── Contrast ──────────────────────────────────────────────────────────────

function channel(value: number) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of a #rrggbb colour. */
export function luminance(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two #rrggbb colours, 1 to 21. */
export function contrastRatio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
