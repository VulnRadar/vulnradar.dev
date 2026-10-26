import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * "Locked out? Talk to a human" is the only way out of /login for someone who
 * cannot sign in, and the AuthOutcome footnote carries the fine print on every
 * auth outcome screen. Both were text-xs in `text-muted-foreground/70`.
 * --muted-foreground only clears AA at full strength, so at 70% opacity the
 * link measured 3.1:1 in the light theme and 4.27:1 in dark, under the 4.5:1
 * that 12px text needs (WCAG 1.4.3).
 *
 * The contrast numbers are computed from the real tokens in app/globals.css,
 * so a retune of the palette that moves them is caught here rather than by a
 * reader.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

type Hsl = [h: number, s: number, l: number];
type Rgb = [number, number, number];

const CSS = read("app/globals.css");
const DARK_AT = CSS.indexOf("\n  .dark {");

/** A token declared as `--name: H S% L%;` on its own line (not in a comment). */
function token(css: string, name: string): Hsl {
  const m = css.match(
    new RegExp(
      `^\\s*--${name}:\\s*(\\d+(?:\\.\\d+)?)\\s+(\\d+(?:\\.\\d+)?)%\\s+(\\d+(?:\\.\\d+)?)%;`,
      "m",
    ),
  );
  if (!m) throw new Error(`token --${name} not found`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function toRgb([h, s, l]: Hsl): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) =>
    light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function luminance(c: Rgb): number {
  const lin = (v: number) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` opacity over `bg`, the way a `/70` colour is painted. */
function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as Rgb;
}

const themes = {
  light: CSS.slice(0, DARK_AT),
  dark: CSS.slice(DARK_AT),
} as const;

describe("--muted-foreground on the page background", () => {
  it.each(["light", "dark"] as const)(
    "%s: full strength clears AA for 12px text",
    (theme) => {
      const bg = toRgb(token(themes[theme], "background"));
      const fg = toRgb(token(themes[theme], "muted-foreground"));
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as const)(
    "%s: seventy percent opacity does not, which is why the footer left it",
    (theme) => {
      const bg = toRgb(token(themes[theme], "background"));
      const fg = toRgb(token(themes[theme], "muted-foreground"));
      expect(contrast(over(fg, bg, 0.7), bg)).toBeLessThan(4.5);
    },
  );
});

describe("the auth footer and outcome footnote", () => {
  it("AuthFooter's text is full-strength muted", () => {
    const src = code("components/auth/auth-layout.tsx");
    const footer = src.slice(src.indexOf("export function AuthFooter"));
    expect(footer).toContain("text-xs text-muted-foreground");
    expect(footer).not.toMatch(/text-muted-foreground\/\d+/);
  });

  it("AuthOutcome's footnote is full-strength muted", () => {
    const src = code("components/auth/auth-shell.tsx");
    const outcome = src.slice(
      src.indexOf("export function AuthOutcome"),
      src.indexOf("export function AuthAlert"),
    );
    expect(outcome).toContain("text-xs text-muted-foreground");
    expect(outcome).not.toMatch(/text-muted-foreground\/\d+/);
  });

  it("no text in either file sits on a faded muted-foreground", () => {
    // Decorative glyphs (the unmet-requirement cross, aria-hidden) may fade;
    // anything that also sets a text size is words someone has to read.
    for (const rel of [
      "components/auth/auth-layout.tsx",
      "components/auth/auth-shell.tsx",
    ]) {
      const offenders = code(rel)
        .split("\n")
        .filter(
          (line) =>
            /text-muted-foreground\/\d+/.test(line) &&
            /\btext-(?:xs|sm|base|lg)\b/.test(line),
        );
      expect(offenders, rel).toEqual([]);
    }
  });
});
