import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/utils";

/**
 * Shared palette for the icon container on a stat cell, matching the
 * pattern established in components/admin/shared/stat-card.tsx: a small
 * colored rounded-square, not a bare inline icon. Centralized here so every
 * non-admin stat row (dashboard, scan summary, history, shares, ...) picks
 * from the same fixed set instead of each file inventing its own colors.
 */
const STAT_ICON_TONES = {
  primary: "bg-primary/10 text-primary",
  purple: "bg-purple-500/10 text-purple-500",
  orange: "bg-orange-500/10 text-orange-500",
  success: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
  destructive: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
  "severity-low":
    "bg-[hsl(var(--severity-low))]/10 text-[hsl(var(--severity-low))]",
  "severity-medium":
    "bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))]",
  "severity-high":
    "bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))]",
} as const;

export type StatTone = keyof typeof STAT_ICON_TONES;

/**
 * Small colored icon container for a stat cell. `size="md"` (32px) matches
 * a headline stat (text-2xl value); `size="sm"` (28px) matches a compact
 * stat (text-sm value).
 */
export function StatIcon({
  icon: Icon,
  tone = "primary",
  size = "md",
  className,
}: {
  icon: LucideIcon;
  tone?: StatTone;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        size === "sm" ? "h-7 w-7 rounded-md" : "h-8 w-8",
        STAT_ICON_TONES[tone],
        className,
      )}
    >
      <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
    </div>
  );
}
