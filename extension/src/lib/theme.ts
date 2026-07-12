// Theme handling. The popup and options pages use the prefers-color-
// scheme media query by default. A user override (light | dark |
// system) is persisted in settings and applied at startup via
// document.documentElement.dataset.theme = "light" | "dark".

import type { ThemeMode } from "./types";

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "system") {
    const prefersDark = window.matchMedia?.(
      "(prefers-color-scheme: dark)",
    ).matches;
    root.dataset.theme = prefersDark ? "dark" : "light";
  } else {
    root.dataset.theme = mode;
  }
}

/**
 * Returns the effective theme (resolves "system" to the OS preference).
 * Useful for picking icon variants or computing background colors
 * that depend on the actual current theme.
 */
export function effectiveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    if (typeof window === "undefined") return "light";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return mode;
}

/**
 * Subscribes to OS color-scheme changes and re-applies the theme.
 * Returns the unsubscribe function. Use in popup/options startup to
 * keep the UI in sync with the OS when the user has chosen "system".
 */
export function watchSystemTheme(
  mode: ThemeMode,
  onChange: (effective: "light" | "dark") => void,
): () => void {
  if (mode !== "system" || typeof window === "undefined") return () => {};
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => onChange(mql.matches ? "dark" : "light");
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}
