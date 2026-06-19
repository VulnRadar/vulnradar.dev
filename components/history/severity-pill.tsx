"use client";

import { cn } from "@/lib/ui/utils";

interface SeverityPillProps {
  severity: string;
  count: number;
}

const styles: Record<string, string> = {
  critical: "bg-red-500/10 text-red-500 border-red-500/20",
  high: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  low: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  info: "bg-muted text-muted-foreground border-border",
};

const dotStyles: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-500",
  info: "bg-muted-foreground",
};

export function SeverityPill({ severity, count }: SeverityPillProps) {
  if (count === 0) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border tabular-nums",
        styles[severity] || styles.info,
      )}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          dotStyles[severity] || dotStyles.info,
        )}
      />
      {count}
    </span>
  );
}
