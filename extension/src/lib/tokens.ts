// Typed view of lib/tokens.json, plus the CSS text built from it.
//
// Two consumers, one source. src/tokens.css is generated from the same JSON by
// scripts/gen-tokens.mjs (called from scripts/build.mjs) and imported by
// popup.css, which options.css already imports. The site-alert card can't use
// a stylesheet at all -- it renders in a shadow root behind
// `:host { all: initial }` on arbitrary third-party pages -- so it takes
// TOKENS_CSS as a string instead of redeclaring the palette a second time,
// which is how the two had drifted to a white card against a blue-tinted
// popup and a white-on-#60a5fa button the popup had already fixed as
// sub-3:1 contrast.

import tokens from "./tokens.json";
import type { Severity } from "./types";

export type ThemeName = "light" | "dark";

export const METRICS = tokens.metrics;
export const THEMES = tokens.themes;

/**
 * Filled severity colour: rails, dots, bar segments. Theme-agnostic callers
 * (the finding row's left rail, the score ladder) take the dark-theme ramp,
 * which is the saturated one and reads on either surface. Anything drawn as
 * text on a tinted surface should use the CSS variables instead, since those
 * follow the theme the way --severity-* does in the app.
 */
export const SEVERITY_SOLID: Record<Severity, string> =
  tokens.themes.dark.severity;

/** Solid green for a clean, zero-finding state. Counterpart to the ramp above. */
export const CLEAN_SOLID: string = tokens.themes.dark.success;

const SEVERITY_KEYS = ["critical", "high", "medium", "low", "info"] as const;

function themeBlock(theme: ThemeName, indent: string): string {
  const t = tokens.themes[theme];
  const lines = [
    `--vr-bg: ${t.bg};`,
    `--vr-card: ${t.card};`,
    `--vr-muted-bg: ${t.mutedBg};`,
    `--vr-text: ${t.text};`,
    `--vr-text-muted: ${t.textMuted};`,
    `--vr-border: ${t.border};`,
    `--vr-input: ${t.input};`,
    `--vr-primary: ${t.primary};`,
    `--vr-primary-text: ${t.primaryText};`,
    `--vr-primary-fg: ${t.primaryFg};`,
    `--vr-success: ${t.success};`,
    `--vr-warning: ${t.warning};`,
    `--vr-danger: ${t.danger};`,
    `--vr-info: ${t.info};`,
    ...SEVERITY_KEYS.map((k) => `--vr-sev-${k}: ${t.severity[k]};`),
    ...SEVERITY_KEYS.map((k) => `--vr-sev-${k}-text: ${t.severityText[k]};`),
  ];
  return lines.map((line) => indent + line).join("\n");
}

function metricsBlock(indent: string): string {
  const lines = [
    `--vr-radius: ${METRICS.radius};`,
    `--vr-radius-sm: ${METRICS.radiusSm};`,
    `--vr-radius-pill: ${METRICS.radiusPill};`,
    `--vr-font: ${METRICS.font};`,
    `--vr-mono: ${METRICS.mono};`,
    `--vr-shadow: ${METRICS.shadow};`,
  ];
  return lines.map((line) => indent + line).join("\n");
}

/**
 * The four blocks popup.css needs: a light default, the system-preference
 * dark override, and the two explicit `[data-theme]` selectors the theme
 * switcher sets so an explicit choice beats the system preference.
 */
export function buildTokensCss(): string {
  return [
    ":root {",
    metricsBlock("  "),
    themeBlock("light", "  "),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    themeBlock("dark", "    "),
    "  }",
    "}",
    "",
    '[data-theme="light"] {',
    themeBlock("light", "  "),
    "}",
    "",
    '[data-theme="dark"] {',
    themeBlock("dark", "  "),
    "}",
    "",
  ].join("\n");
}

/**
 * Same values scoped to a selector, for the shadow-DOM site-alert card.
 * `prefers-color-scheme` still applies inside a shadow root, so the card
 * follows the OS the way the popup does.
 */
export function buildScopedTokensCss(selector: string): string {
  return [
    `${selector} {`,
    metricsBlock("  "),
    themeBlock("light", "  "),
    "}",
    "@media (prefers-color-scheme: dark) {",
    `  ${selector} {`,
    themeBlock("dark", "    "),
    "  }",
    "}",
  ].join("\n");
}
