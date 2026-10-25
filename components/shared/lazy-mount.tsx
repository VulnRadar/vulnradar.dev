"use client";

import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";

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
  /** Drawn if the import fails. Most surfaces leave this off: they were
   *  absent before they were wanted, and staying absent is a fair failure.
   *  It is for the one that something else is waiting on, where a missing
   *  surface is a dead end rather than a missing extra. */
  fallback?: ReactNode;
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
  fallback,
}: LazyMountProps<P>) {
  const [Component, setComponent] = useState<ComponentType<P> | null>(null);
  const [failed, setFailed] = useState(false);

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
        // A chunk that 404s after a deploy, or a dropped connection, lands
        // here. The surface stays unmounted, which is what it was before it
        // was ever wanted, so this reports it and draws the fallback if the
        // caller gave one.
        console.error("[lazy-mount] failed to load:", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wanted, Component, load]);

  if (Component) return <Component {...(componentProps as P)} />;
  return failed ? (fallback ?? null) : null;
}
