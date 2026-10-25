"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/utils";

export interface FilterChipOption<T extends string = string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  /** Shown after the label when present, so a chip can say how many rows it
   *  would leave without the operator having to click it to find out. */
  count?: number;
}

/**
 * A row of mutually exclusive filter chips.
 *
 * The audit log drew its own copy of this and the staff directory and the user
 * list were about to draw two more, each with a slightly different padding.
 * It wraps rather than scrolling: an overflow-x strip hid most of the chips on
 * a phone with no cue that more existed.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly FilterChipOption<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Names the group for a screen reader, e.g. "Filter by role". */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-pressed={value === option.id}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border whitespace-nowrap shrink-0",
            "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            value === option.id
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted border-border/40",
          )}
        >
          {option.icon && (
            <option.icon className="h-3 w-3" aria-hidden="true" />
          )}
          {option.label}
          {option.count !== undefined && (
            <span className="tabular-nums opacity-75">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
