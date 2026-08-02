"use client";

import { cn } from "@/lib/ui/utils";

interface CompareSummaryStatsProps {
  added: number;
  removed: number;
  unchanged: number;
}

export function CompareSummaryStats({
  added,
  removed,
  unchanged,
}: CompareSummaryStatsProps) {
  return (
    <div className="flex items-stretch rounded-xl border border-border/50 bg-card/30 divide-x divide-border/50 overflow-hidden">
      <div
        className={cn(
          "flex-1 flex flex-col items-center justify-center py-5 px-4 min-w-0",
          added > 0 && "bg-destructive/5",
        )}
      >
        <span
          className={cn(
            "text-4xl font-bold tabular-nums leading-none",
            added > 0 ? "text-destructive" : "text-muted-foreground/40",
          )}
        >
          {added}
        </span>
        <span className="text-[11px] text-muted-foreground mt-2 uppercase tracking-wider font-medium">
          New issues
        </span>
      </div>

      <div
        className={cn(
          "flex-1 flex flex-col items-center justify-center py-5 px-4 min-w-0",
          removed > 0 && "bg-emerald-500/5",
        )}
      >
        <span
          className={cn(
            "text-4xl font-bold tabular-nums leading-none",
            removed > 0 ? "text-emerald-500" : "text-muted-foreground/40",
          )}
        >
          {removed}
        </span>
        <span className="text-[11px] text-muted-foreground mt-2 uppercase tracking-wider font-medium">
          Fixed
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center py-5 px-4 min-w-0">
        <span
          className={cn(
            "text-4xl font-bold tabular-nums leading-none",
            unchanged > 0 ? "text-foreground" : "text-muted-foreground/40",
          )}
        >
          {unchanged}
        </span>
        <span className="text-[11px] text-muted-foreground mt-2 uppercase tracking-wider font-medium">
          Unchanged
        </span>
      </div>
    </div>
  );
}
