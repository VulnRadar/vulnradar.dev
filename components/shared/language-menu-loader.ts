import type { ComponentType } from "react";
import type { LanguageMenuImplProps } from "@/components/shared/language-menu-impl";

export type LanguageMenuImpl = ComponentType<LanguageMenuImplProps>;

let loaded: LanguageMenuImpl | null = null;
let pending: Promise<LanguageMenuImpl> | null = null;

/**
 * Imports the language menu once, however many hover, focus and press events
 * ask for it, and shares the result with every header on the page.
 *
 * A rejected import is forgotten, so the next press tries again. A chunk that
 * 404s after a deploy or a dropped connection should cost one click, not the
 * language switcher until the next full page load.
 */
export function loadLanguageMenuImpl(): Promise<LanguageMenuImpl> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= import("@/components/shared/language-menu-impl")
    .then((mod) => {
      loaded = mod.LanguageMenuImpl;
      return loaded;
    })
    .catch((err: unknown) => {
      pending = null;
      throw err;
    });
  return pending;
}

/** The menu if it has already been imported, for a header that mounts later. */
export function peekLanguageMenuImpl(): LanguageMenuImpl | null {
  return loaded;
}

/** Forgets what was imported. For tests. */
export function resetLanguageMenuLoader(): void {
  loaded = null;
  pending = null;
}
