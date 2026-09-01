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
 * Subscribes to OS color-scheme changes and re-applies the theme, returning
 * the unsubscribe function. Called once from popup and options startup:
 * applyTheme() resolves "system" exactly once when the page opens, so an OS
 * light/dark flip while the options tab sat open left it on the stale theme
 * until reload.
 *
 * Takes a getter rather than a fixed mode because the user can switch to (or
 * away from) "system" in Appearance without the page reloading; reading the
 * mode at event time keeps one subscription correct for the page's lifetime,
 * and a non-"system" mode simply ignores the event.
 */
export function watchSystemTheme(getMode: () => ThemeMode): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    const mode = getMode();
    if (mode === "system") applyTheme(mode);
  };
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}
