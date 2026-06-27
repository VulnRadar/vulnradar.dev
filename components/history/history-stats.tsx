"use client";

import { Layers, ShieldCheck, AlertTriangle, Bug } from "lucide-react";
import type { ScanRecord } from "./history-types";
import { cn } from "@/lib/ui/utils";

interface HistoryStatsProps {
  scans: ScanRecord[];
}

function StatCard({
  value,
  label,
  icon: Icon,
  color,
  valueColor,
}: {
  value: string | number;
  label: string;
  icon: React.ElementType;
  color: string;
  valueColor?: string;
}) {
  const bgColorMap: Record<string, string> = {
    primary: "bg-primary/10",
    emerald: "bg-emerald-500/10",
    amber: "bg-amber-500/10",
    red: "bg-red-500/10",
  };
  const ringColorMap: Record<string, string> = {
    primary: "ring-primary/20",
    emerald: "ring-emerald-500/20",
    amber: "ring-amber-500/20",
    red: "ring-red-500/20",
  };
  const fgColorMap: Record<string, string> = {
    primary: "text-primary",
    emerald: "text-emerald-500",
    amber: "text-amber-500",
    red: "text-red-500",
  };
  const valueColorMap: Record<string, string> = {
    emerald: "text-emerald-500",
    amber: "text-amber-500",
    red: "text-red-500",
  };

  return (
    <div className="group relative flex items-center gap-3 p-3.5 sm:p-4 rounded-xl border border-border/50 bg-card/30 hover:bg-card/60 hover:border-border transition-all duration-200">
      <div
        className={cn(
          "p-2 sm:p-2.5 rounded-lg shrink-0 ring-1 transition-transform duration-200 group-hover:scale-105",
          bgColorMap[color],
          ringColorMap[color],
        )}
      >
        <Icon className={cn("h-4 w-4 sm:h-5 sm:w-5", fgColorMap[color])} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-xl sm:text-2xl font-bold tracking-tight tabular-nums leading-none",
            valueColor ? valueColorMap[valueColor] : "text-foreground",
          )}
        >
          {value}
        </p>
        <p className="text-[11px] sm:text-xs text-muted-foreground truncate mt-1">
          {label}
        </p>
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
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
      <StatCard
        value={totalScans}
        label="Total scans"
        icon={Layers}
        color="primary"
      />
      <StatCard
        value={cleanScans}
        label="Clean"
        icon={ShieldCheck}
        color="emerald"
        valueColor="emerald"
      />
      <StatCard
        value={issueScans}
        label="With issues"
        icon={AlertTriangle}
        color="amber"
        valueColor="amber"
      />
      <StatCard
        value={totalIssues}
        label="Total findings"
        icon={Bug}
        color="red"
        valueColor="red"
      />
    </div>
  );
}
