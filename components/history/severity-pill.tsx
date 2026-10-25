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
  const name = tone.label.toLowerCase();

  // The severity used to live in the dot's colour alone, so a row with two
  // criticals and five mediums read to a screen reader as "2 5", and to anyone
  // who cannot tell red from amber as two unlabelled numbers (WCAG 1.4.1,
  // 1.3.1). On the history list's sm-and-up layout this pill row is the only
  // severity information the row carries. The word is in the accessible name
  // instead of beside the number because a visible label would not fit five
  // pills in the findings column; the title gives sighted hover users the same
  // thing. Fixed here, it fixes every list that renders the pill.
  return (
    <span
      title={`${count} ${name}`}
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
      <span className="sr-only"> {name}</span>
    </span>
  );
}
