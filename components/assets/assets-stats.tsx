"use client";

import { Globe, ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { StatIcon, type StatTone } from "@/components/shared/stat-icon";
import type { AssetRow } from "./assets-types";

function Cell({
  value,
  label,
  icon,
  textTone,
  iconTone = "muted",
}: {
  value: number;
  label: string;
  icon: LucideIcon;
  textTone?: string;
  iconTone?: StatTone;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3 bg-card">
      <StatIcon icon={icon} tone={value > 0 ? iconTone : "muted"} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            "text-2xl font-semibold leading-none tabular-nums tracking-tight",
            value > 0
              ? textTone || "text-foreground"
              : "text-muted-foreground/40",
          )}
        >
          {value}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}

export function AssetsStats({ assets }: { assets: AssetRow[] }) {
  const total = assets.length;
  const clean = assets.filter((a) => a.safetyRating === "safe").length;
  const caution = assets.filter((a) => a.safetyRating === "caution").length;
  const unsafe = assets.filter((a) => a.safetyRating === "unsafe").length;

  if (total === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border overflow-hidden rounded-md border border-border">
      <Cell
        value={total}
        label="Hosts scanned"
        icon={Globe}
        iconTone="primary"
      />
      <Cell
        value={clean}
        label="Clean"
        icon={ShieldCheck}
        textTone="text-[hsl(var(--success))]"
        iconTone="success"
      />
      <Cell
        value={caution}
        label="Caution"
        icon={ShieldAlert}
        textTone="text-[hsl(var(--severity-medium))]"
        iconTone="severity-medium"
      />
      <Cell
        value={unsafe}
        label="Exploitable"
        icon={ShieldX}
        textTone="text-destructive"
        iconTone="destructive"
      />
    </div>
  );
}
