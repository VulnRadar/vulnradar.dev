import { describe, expect, it } from "vitest";

import tokens from "../src/lib/tokens.json";

/**
 * WCAG 2.1 contrast, computed rather than eyeballed, for every
 * foreground/background pair the extension actually paints, in both themes.
 *
 * This exists because eyeballing is how the light theme got into the state
 * this suite was written to fix. Measured before the fix: 44 of 58 pairs
 * failed on the light theme, including every link and every severity label,
 * because the palette reused dark-theme accents (a #60a5fa link at 2.00:1, a
 * #f5a623 warning label at 1.68:1, an "off" switch at 1.53:1 against the card
 * behind it). The dark theme was almost entirely fine, which is exactly why
 * nobody noticed: the extension is developed in dark mode.
 *
 * The pairs below are transcribed from the stylesheets, so a rule that changes
 * which token paints what has to be reflected here. Anything deliberately
 * exempt is listed at the bottom with the reason, rather than quietly omitted.
 *
 * SC 1.4.3 (Contrast, Minimum, AA): 4.5:1 for normal text. Every piece of text
 * in this extension is normal text: the largest type anywhere is the 32px
 * score number, which IS large-scale, but it is coloured from the severity
 * ramp and held to the stricter bar anyway rather than tracked as a special
 * case.
 *
 * SC 1.4.11 (Non-text Contrast, AA): 3:1 for the boundary or fill that
 * identifies a control and its state.
 */

type Rgb = readonly [number, number, number];

function parseHex(color: string): Rgb {
  const s = color.replace("#", "");
  const full =
    s.length === 3
      ? s
          .split("")
          .map((c) => c + c)
          .join("")
      : s;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ] as const;
}

/** WCAG 2.x relative luminance. */
function relativeLuminance(rgb: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(rgb[0]) +
    0.7152 * channel(rgb[1]) +
    0.0722 * channel(rgb[2])
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [
    relativeLuminance(parseHex(a)),
    relativeLuminance(parseHex(b)),
  ].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `color-mix(in srgb, C p%, transparent)` composited over an opaque surface.
 * The stylesheets tint with a translucent colour rather than a solid one, so
 * the real background behind a badge label is this blend, not the token.
 */
function tint(color: string, percent: number, over: string): string {
  const c = parseHex(color);
  const base = parseHex(over);
  const f = percent / 100;
  return (
    "#" +
    [0, 1, 2]
      .map((i) =>
        Math.round(c[i] * f + base[i] * (1 - f))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

/** popup.css's graded badge tint, copied from the app's SEVERITY_TONE. */
const BADGE_TINT: Record<(typeof SEVERITIES)[number], number | null> = {
  critical: 15,
  high: 15,
  medium: 10,
  low: 10,
  info: null, // neutral --vr-muted-bg surface, not a tint of its own hue
};

interface Pair {
  readonly what: string;
  readonly fg: string;
  readonly bg: string;
  readonly min: number;
}

function pairsFor(theme: "light" | "dark"): Pair[] {
  const t = tokens.themes[theme];
  const out: Pair[] = [];
  const text = (what: string, fg: string, bg: string) =>
    out.push({ what, fg, bg, min: 4.5 });
  const nonText = (what: string, fg: string, bg: string) =>
    out.push({ what, fg, bg, min: 3 });

  // ---- body copy, on each of the three surfaces it lands on
  text("body text on the page", t.text, t.bg);
  text("body text on a card", t.text, t.card);
  text("body text on a muted surface", t.text, t.mutedBg);
  text("secondary text on the page", t.textMuted, t.bg);
  text("secondary text on a card", t.textMuted, t.card);
  text("secondary text on a muted surface", t.textMuted, t.mutedBg);

  // ---- the brand blue in its two jobs
  text("link / primary text on the page", t.primaryText, t.bg);
  text("link / primary text on a card", t.primaryText, t.card);
  text(
    "options nav active item, on its own 12% tint",
    t.primaryText,
    tint(t.primary, 12, t.bg),
  );
  text("label on a filled primary button", t.primaryFg, t.primary);
  text("family-id / stale chip", t.textMuted, t.mutedBg);

  // ---- status banners: coloured text on a 12% tint of itself
  for (const key of ["success", "danger", "info", "warning"] as const) {
    text(
      `status banner "${key}" label on its own tint`,
      t[key],
      tint(t[key], 12, t.card),
    );
  }
  text(
    "popup error banner on its own 8% tint",
    t.danger,
    tint(t.danger, 8, t.bg),
  );
  text(
    "target-warning icon on its own 8% tint",
    t.warning,
    tint(t.warning, 8, t.bg),
  );
  text(
    "target-warning body text on the warning tint",
    t.text,
    tint(t.warning, 8, t.bg),
  );
  text(
    "dialog danger button label on its 12% tint",
    t.danger,
    tint(t.danger, 12, t.card),
  );

  // ---- severity chips: the LABEL is severityText, the tint is severity
  for (const key of SEVERITIES) {
    const pct = BADGE_TINT[key];
    const surfaces =
      pct === null
        ? [["muted surface", t.mutedBg] as const]
        : ([
            ["over a card", tint(t.severity[key], pct, t.card)],
            ["over the page", tint(t.severity[key], pct, t.bg)],
          ] as const);
    for (const [where, surface] of surfaces) {
      text(
        `severity chip "${key}" label, ${where}`,
        t.severityText[key],
        surface,
      );
    }
  }
  text(
    'the "clean" chip on its own tint',
    t.success,
    tint(t.success, 15, t.card),
  );
  text(
    'the "unfinished" chip on its own tint',
    t.warning,
    tint(t.warning, 15, t.card),
  );

  // ---- other coloured text
  text("incomplete-scan note", t.warning, t.card);
  text("history trend, improved", t.success, t.bg);
  text("history trend, worse", t.danger, t.bg);
  text("export error", t.danger, t.card);
  text("danger button label", t.danger, t.bg);
  text("unlimited-scans label", t.primaryText, t.card);
  text("toast", t.bg, t.text);

  // ---- the injected site-alert card (its own shadow-DOM stylesheet)
  text("card verdict, safe", t.success, t.card);
  text("card verdict, caution", t.warning, t.card);
  text("card verdict, unsafe", t.danger, t.card);
  text("card severity chip text", t.text, t.mutedBg);
  text("card mute-row buttons", t.textMuted, t.card);
  text("card primary button label", t.primaryFg, t.primary);

  // ---- SC 1.4.11: control edges and states
  nonText("control edge on the page", t.input, t.bg);
  nonText("control edge on a card", t.input, t.card);
  nonText("control edge on a muted surface", t.input, t.mutedBg);
  nonText("switch, off: track against the card", t.input, t.card);
  nonText("switch, off: thumb against the track", t.bg, t.input);
  nonText("switch, on: edge against the card", t.primaryText, t.card);
  nonText("switch, on: thumb against the track", t.primaryFg, t.primary);
  nonText("selected checkbox / family card edge", t.primaryText, t.bg);
  nonText("selected card-position corner", t.primaryText, t.bg);
  nonText("focus ring on the page", t.primaryText, t.bg);
  nonText("focus ring on a card", t.primaryText, t.card);
  nonText("focus ring on a muted surface", t.primaryText, t.mutedBg);
  nonText("rate-limit bar fill against its track", t.primaryText, t.border);
  nonText("card verdict rail, safe", t.success, t.card);
  nonText("card verdict rail, caution", t.warning, t.card);
  nonText("card verdict rail, unsafe", t.danger, t.card);

  return out;
}

describe.each(["light", "dark"] as const)("%s theme contrast", (theme) => {
  const pairs = pairsFor(theme);

  it.each(pairs)("$what clears $min:1", ({ fg, bg, min }) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe("severity ramp stays an ordered scale", () => {
  // app/globals.css's --severity-* comment is the long version. An earlier AA
  // pass darkened each severity until it just cleared 4.5:1 and stopped, which
  // put all five on nearly the same luminance: adjacent steps differed by
  // 1.003:1 to 1.028:1, so in greyscale or to a red-green colour vision
  // deficiency, critical / high / medium were one colour. That matters more
  // here than almost anywhere, since severity is the extension's entire
  // output. The ramp was re-spread; this is the guard that keeps it spread.
  //
  // The floor is deliberately modest. The quiet end (medium/low/info) is meant
  // to be close together and is already at its contrast ceiling, so this
  // asserts what the fix was actually about: that the LOUD end separates.
  it("separates critical from high in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const { severity } = tokens.themes[theme];
      expect(
        contrast(severity.critical, severity.high),
        `${theme} critical vs high`,
      ).toBeGreaterThan(1.1);
    }
  });

  it("draws the light ramp's loud end darker than its quiet end", () => {
    // On a light theme "more severe" reads as darker ink. NOT asserted as a
    // strict monotonic order across all five, because the ramp is not one and
    // is not meant to be: globals.css leaves medium, low and info at their
    // shared contrast ceiling, and medium is fractionally LIGHTER than low
    // (they sit 1.028:1 apart). Writing the stricter assertion here would be
    // asserting a property the design does not claim, and the next person to
    // touch the ramp would have to weaken a test to make a correct change.
    //
    // What the second pass actually restored, and therefore what is worth
    // guarding, is that critical and high separate from the quiet three
    // instead of collapsing into them.
    const { severity } = tokens.themes.light;
    const lum = (k: (typeof SEVERITIES)[number]) =>
      relativeLuminance(parseHex(severity[k]));
    const quietest = Math.min(lum("medium"), lum("low"), lum("info"));
    expect(lum("critical"), "light critical vs the quiet end").toBeLessThan(
      quietest,
    );
    expect(lum("high"), "light high vs the quiet end").toBeLessThan(quietest);
    expect(lum("critical"), "light critical vs high").toBeLessThan(lum("high"));
  });

  it("keeps every severity label within 4 points of lightness of its fill", () => {
    // severityText only exists to lift a label off its own tint. If one ever
    // has to move far from its fill, the tint is the thing that is wrong, not
    // the ramp: see the graded .badge tint in popup.css.
    for (const theme of ["light", "dark"] as const) {
      const { severity, severityText } = tokens.themes[theme];
      for (const key of SEVERITIES) {
        const fill = relativeLuminance(parseHex(severity[key]));
        const label = relativeLuminance(parseHex(severityText[key]));
        expect(
          Math.abs(fill - label),
          `${theme} ${key}: ${severity[key]} vs ${severityText[key]}`,
        ).toBeLessThan(0.06);
      }
    }
  });
});

/**
 * Measured, under the bar, and deliberate. Recorded as assertions so a future
 * change that "fixes" one of these has to come here and read why it was left.
 */
describe("documented exemptions", () => {
  it("leaves --border below 3:1, because it is a container edge", () => {
    // Same split, and the same reasoning, as --border vs --input in
    // app/globals.css: SC 1.4.11 asks for 3:1 on "user interface components
    // and their states", and the outline of a card, a panel or a section rule
    // is not a component you operate. Holding it to 3:1 draws a hard line
    // around every container in the product for no conformance gain. Controls
    // use --vr-input, which is asserted at 3:1 above.
    for (const theme of ["light", "dark"] as const) {
      const t = tokens.themes[theme];
      expect(contrast(t.border, t.bg)).toBeLessThan(3);
      expect(contrast(t.input, t.bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it("leaves the corner-picker's unselected dots below 3:1 as fills", () => {
    // The four dots in the card-position picker are drawn in --vr-card on a
    // --vr-bg "screen", which is about 1.1:1. What identifies them is their
    // --vr-input edge (asserted above) and the picker prints the selected
    // corner's name in text beside it, so the fill is not carrying the state.
    for (const theme of ["light", "dark"] as const) {
      const t = tokens.themes[theme];
      expect(contrast(t.card, t.bg)).toBeLessThan(3);
      expect(contrast(t.input, t.bg)).toBeGreaterThanOrEqual(3);
    }
  });
});
