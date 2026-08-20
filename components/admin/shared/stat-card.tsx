import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/utils";

/**
 * Small, fixed palette for the icon container on a stat segment. Picked per
 * item to tell categories apart at a glance (e.g. a teal volume metric next
 * to a purple protocol breakdown next to an orange warning count), not
 * assigned automatically. Literal class strings only, so Tailwind's
 * static scan finds every one of them.
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

export interface StatBarItem {
  label: string;
  value: string | number;
  onClick?: () => void;
  active?: boolean;
  /**
   * Optional, and deliberately rare. Reach for it only when a reader
   * genuinely needs a visual anchor to tell this segment apart from its
   * neighbors at a glance, not on every segment, that is the icon-card grid
   * pattern this component exists to avoid. When set, the icon sits in a
   * small colored rounded-square container (see `tone`), sized a little
   * larger than the label text next to it.
   */
  icon?: LucideIcon;
  /** Icon container color. Only matters when `icon` is set. Defaults to "primary". */
  tone?: StatTone;
}

/**
 * Inline stat bar: a single joined strip of live counts with hairline
 * dividers between segments, not a grid of decorative icon cards. A segment
 * is only interactive when `onClick` is supplied, e.g. to filter the table
 * rendered below it.
 */
export function StatBar({
  items,
  className,
}: {
  items: StatBarItem[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap rounded-lg border border-border/50 bg-border/50 gap-px overflow-hidden",
        className,
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const inner = (
          <>
            {Icon && (
              <div
                aria-hidden
                className={cn(
                  "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                  STAT_ICON_TONES[item.tone ?? "primary"],
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
            )}
            <div className="flex flex-col gap-0.5 min-w-0">
              <p className="text-lg font-semibold tracking-tight tabular-nums">
                {typeof item.value === "number"
                  ? item.value.toLocaleString()
                  : item.value}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {item.label}
              </p>
            </div>
          </>
        );
        const cellClass = cn(
          "flex-1 min-w-28 bg-card px-4 py-3 flex items-center gap-3 text-left transition-colors",
          item.onClick &&
            "hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          item.active && "bg-primary/5",
        );
        return item.onClick ? (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            aria-pressed={item.active}
            className={cellClass}
          >
            {inner}
          </button>
        ) : (
          <div key={item.label} className={cellClass}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
