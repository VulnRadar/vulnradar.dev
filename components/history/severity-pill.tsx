"use client";

import { cn } from "@/lib/ui/utils";
import { severityTone } from "@/components/scanner/severity-badge";

interface SeverityPillProps {
  severity: string;
  count: number;
}

export function SeverityPill({ severity, count }: SeverityPillProps) {
  if (count === 0) return null;
  const tone = severityTone(severity);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums",
        tone.surface,
        tone.border,
        tone.text,
      )}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full", tone.solid)}
      />
      {count}
    </span>
  );
}
