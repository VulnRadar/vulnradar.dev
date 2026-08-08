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
  const cells: {
    value: number;
    label: string;
    active: boolean;
    tone: string;
    surface: string;
  }[] = [
    {
      value: added,
      label: "New",
      active: added > 0,
      tone: "text-destructive",
      surface: "bg-destructive/5",
    },
    {
      value: removed,
      label: "Fixed",
      active: removed > 0,
      tone: "text-[hsl(var(--success))]",
      surface: "bg-[hsl(var(--success))]/5",
    },
    {
      value: unchanged,
      label: "Unchanged",
      active: unchanged > 0,
      tone: "text-foreground",
      surface: "",
    },
  ];

  return (
    <dl className="flex items-stretch rounded-xl border border-border/50 bg-card/30 divide-x divide-border/50 overflow-hidden">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className={cn(
            "flex-1 flex flex-col items-center justify-center py-5 px-3 min-w-0",
            cell.active && cell.surface,
          )}
        >
          <dd
            className={cn(
              "text-3xl sm:text-4xl font-semibold tabular-nums leading-none",
              cell.active ? cell.tone : "text-muted-foreground/40",
            )}
          >
            {cell.value}
          </dd>
          <dt className="text-[11px] text-muted-foreground mt-2 uppercase tracking-wider font-medium text-center">
            {cell.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}
