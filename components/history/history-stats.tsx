"use client";

import { Clock, ShieldCheck, AlertTriangle, BarChart3 } from "lucide-react";
import type { ScanRecord } from "./history-types";

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
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="flex items-center gap-3 p-4 rounded-xl border border-border/50 bg-card/50">
        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
          <BarChart3 className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums">{totalScans}</p>
          <p className="text-xs text-muted-foreground">Total Scans</p>
        </div>
      </div>
      <div className="flex items-center gap-3 p-4 rounded-xl border border-border/50 bg-card/50">
        <div className="p-2 rounded-lg bg-emerald-500/10 shrink-0">
          <ShieldCheck className="h-4 w-4 text-emerald-500" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums text-emerald-500">
            {cleanScans}
          </p>
          <p className="text-xs text-muted-foreground">Clean</p>
        </div>
      </div>
      <div className="flex items-center gap-3 p-4 rounded-xl border border-border/50 bg-card/50">
        <div className="p-2 rounded-lg bg-amber-500/10 shrink-0">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums text-amber-500">
            {issueScans}
          </p>
          <p className="text-xs text-muted-foreground">With Issues</p>
        </div>
      </div>
      <div className="flex items-center gap-3 p-4 rounded-xl border border-border/50 bg-card/50">
        <div className="p-2 rounded-lg bg-muted shrink-0">
          <Clock className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums">{totalIssues}</p>
          <p className="text-xs text-muted-foreground">Total Issues</p>
        </div>
      </div>
    </div>
  );
}
