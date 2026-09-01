"use client";

import { Globe, ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
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
      items={[
        {
          value: total,
          label: "Hosts scanned",
          icon: Globe,
          iconTone: "primary",
        },
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
