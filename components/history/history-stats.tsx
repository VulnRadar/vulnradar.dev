"use client";

import type { ScanRecord } from "./history-types";
import { cn } from "@/lib/ui/utils";

interface HistoryStatsProps {
  scans: ScanRecord[];
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
    <div className="flex items-stretch rounded-xl border border-border/50 bg-card/30 divide-x divide-border/50 overflow-hidden">
      <div className="flex-1 flex flex-col items-center justify-center py-3.5 px-4 min-w-0">
        <span className="text-2xl font-bold tabular-nums text-foreground leading-none">
          {totalScans}
        </span>
        <span className="text-[11px] text-muted-foreground mt-1.5">
          Total scans
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center py-3.5 px-4 min-w-0">
        <span
          className={cn(
            "text-2xl font-bold tabular-nums leading-none",
            cleanScans > 0 ? "text-emerald-500" : "text-muted-foreground/40",
          )}
        >
          {cleanScans}
        </span>
        <span className="text-[11px] text-muted-foreground mt-1.5">Clean</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center py-3.5 px-4 min-w-0">
        <span
          className={cn(
            "text-2xl font-bold tabular-nums leading-none",
            issueScans > 0 ? "text-amber-500" : "text-muted-foreground/40",
          )}
        >
          {issueScans}
        </span>
        <span className="text-[11px] text-muted-foreground mt-1.5">
          With issues
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center py-3.5 px-4 min-w-0">
        <span
          className={cn(
            "text-2xl font-bold tabular-nums leading-none",
            totalIssues > 0
              ? "text-[hsl(var(--severity-high))]"
              : "text-muted-foreground/40",
          )}
        >
          {totalIssues}
        </span>
        <span className="text-[11px] text-muted-foreground mt-1.5">
          Total findings
        </span>
      </div>
    </div>
  );
}
