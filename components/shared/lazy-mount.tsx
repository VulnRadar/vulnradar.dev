"use client";

import { useEffect, useState } from "react";
import type { ComponentType } from "react";

interface LazyMountProps<P extends object> {
  /** Flips true when the surface has something to show. Never flipped back:
   *  once imported, it stays mounted for the life of the page. */
  wanted: boolean;
  /** The dynamic import, resolving to the component. A stable reference (a
   *  module-level function, not an inline arrow): it is an effect dependency,
   *  and an inline one is a new function every render. */
  load: () => Promise<ComponentType<P>>;
  /** Props handed to the component once it has loaded. */
  componentProps?: P;
}

/**
 * Imports a component the first time `wanted` is true and renders it from then
 * on.
 *
 * The root layout is in every route's entry chunk, so anything it imports
 * statically ships to ~790 pages whether or not that page will ever draw it.
 * The pieces that only some readers ever see (the command palette, the OAuth
 * profile prompts, the terms modal, the backup-code reminder) each sit behind
 * a tiny always-loaded gate that decides when it is time, and this is the part
 * of that decision they all share: it turns "this has become necessary" into
 * one dynamic import, once. chat-widget-mount.tsx makes the same trade for the
 * AI widget and keeps its own copy, because it also has to buffer an event
 * that arrives before the import lands.
 */
export function LazyMount<P extends object = Record<string, never>>({
  wanted,
  load,
  componentProps,
}: LazyMountProps<P>) {
  const [Component, setComponent] = useState<ComponentType<P> | null>(null);

  useEffect(() => {
    if (!wanted || Component) return;
    let cancelled = false;
    load()
      .then((loaded) => {
        // Through an updater, so React does not mistake the component for a
        // lazy state initialiser and call it.
        if (!cancelled) setComponent(() => loaded);
      })
      .catch((err: unknown) => {
        // A chunk that 404s after a deploy lands here. The surface stays
        // unmounted, which is what it was before it was ever wanted, so this
        // reports and leaves it at that.
        console.error("[lazy-mount] failed to load:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [wanted, Component, load]);

  return Component ? <Component {...(componentProps as P)} /> : null;
}
