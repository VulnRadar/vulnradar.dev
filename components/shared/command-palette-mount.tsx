"use client";

import { useEffect, useState } from "react";
import { LazyMount } from "@/components/shared/lazy-mount";

const loadCommandPalette = () =>
  import("@/components/shared/command-palette").then(
    (mod) => mod.CommandPalette,
  );

/**
 * Puts the command palette in the root layout without putting cmdk, the
 * dialog layer under it and the destination list on every page.
 *
 * The palette only ever opens on Cmd/Ctrl+K, so the chunk is fetched on the
 * first one. This listener is the entire cost until then. It swallows the
 * keystroke itself (the browser would otherwise take Ctrl+K for its own search
 * box) and the palette mounts already open, so the press that asked for it is
 * not lost to the download. From then on the palette's own listener toggles it;
 * this one stays attached, and its only effect on a later press is a second
 * preventDefault and a state set to the value it already holds.
 */
export function CommandPaletteMount() {
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "k" && e.key !== "K") return;
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      setAsked(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <LazyMount
      wanted={asked}
      load={loadCommandPalette}
      componentProps={{ defaultOpen: true }}
    />
  );
}
