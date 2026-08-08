"use client";

import {
  BarChart3,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  type LucideIcon,
} from "lucide-react";
import type { ScanRecord } from "./history-types";
import { cn } from "@/lib/ui/utils";
import { StatIcon, type StatTone } from "@/components/shared/stat-icon";

interface HistoryStatsProps {
  scans: ScanRecord[];
}

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
  /** Number color when value > 0; dims to muted at zero either way. */
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

export function HistoryStats({ scans }: HistoryStatsProps) {
  const totalScans = scans.length;
  const cleanScans = scans.filter((s) => s.findings_count === 0).length;
  const issueScans = scans.filter((s) => s.findings_count > 0).length;
  const totalIssues = scans.reduce(
    (acc, s) => acc + (s.findings_count || 0),
    0,
  );

  if (totalScans === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border overflow-hidden rounded-md border border-border">
      <Cell
        value={totalScans}
        label="Total scans"
        icon={BarChart3}
        iconTone="primary"
      />
      <Cell
        value={cleanScans}
        label="Came back clean"
        icon={ShieldCheck}
        textTone="text-[hsl(var(--success))]"
        iconTone="success"
      />
      <Cell
        value={issueScans}
        label="Had findings"
        icon={ShieldAlert}
        textTone="text-[hsl(var(--severity-medium))]"
        iconTone="severity-medium"
      />
      <Cell
        value={totalIssues}
        label="Findings total"
        icon={ShieldX}
        textTone="text-[hsl(var(--severity-high))]"
        iconTone="severity-high"
      />
    </div>
  );
}
