"use client";

import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { StatStrip } from "@/components/shared/stat-strip";
import type { AssetRow } from "./assets-types";

export function AssetsStats({ assets }: { assets: AssetRow[] }) {
  const total = assets.length;
  const clean = assets.filter((a) => a.safetyRating === "safe").length;
  const caution = assets.filter((a) => a.safetyRating === "caution").length;
  const unsafe = assets.filter((a) => a.safetyRating === "unsafe").length;

  if (total === 0) return null;

  return (
    <StatStrip
      // One per row on a phone. StatStrip's md track table maps a 3-cell strip
      // to a flat `grid-cols-3`, which is the only count in that table with no
      // phone-width step: on a 390px screen each cell is ~119px, and after the
      // px-4 padding, the 32px icon and the gap that leaves ~43px of text
      // column. "EXPLOITABLE" needs about 74px at 10px with tracking-wider and
      // a four-digit count needs about 67px at 24px, so both the caption and
      // the number were being clipped. Overridden here rather than in the
      // component because /assets is the only 3-cell strip in the product.
      items={[
        // No "Hosts scanned" cell. The h1 subtitle directly above this strip
        // already states that number in a sentence ("37 distinct hosts across
        // your recent scans"), so the page opened by printing the same figure
        // twice about fifty pixels apart, and unlike the /history case the
        // total here is not even independent information: the three cells
        // below partition it. HistoryStats dropped its equivalent cell for the
        // same reason.
        {
          value: clean,
          label: "Clean",
          icon: ShieldCheck,
          textTone: "text-[hsl(var(--success))]",
          iconTone: "success",
        },
        {
          value: caution,
          label: "Caution",
          icon: ShieldAlert,
          textTone: "text-[hsl(var(--severity-medium))]",
          iconTone: "severity-medium",
        },
        {
          // Was text-destructive here, --severity-critical on /shares and
          // --severity-high on /history for the same "exploitable" column.
          // One token now, the severity scale's own.
          value: unsafe,
          label: "Exploitable",
          icon: ShieldX,
          textTone: "text-[hsl(var(--severity-critical))]",
          iconTone: "destructive",
        },
      ]}
    />
  );
}
