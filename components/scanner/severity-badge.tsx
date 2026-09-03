import { cn } from "@/lib/ui/utils";
import type { Severity } from "@/lib/scanner/types";
import { SEVERITY_ORDER } from "@/lib/config/client-constants";

/**
 * Single source of severity styling for the whole product surface.
 *
 * Every colour resolves to the --severity-* variables in globals.css, so
 * there is exactly one severity scale and it tracks the theme. Nothing here
 * hardcodes a Tailwind palette colour.
 */

/** Re-exported so the existing `from "@/components/scanner/severity-badge"`
 *  imports keep working. The ordering itself lives beside SEVERITY_PRIORITY in
 *  lib/config/client-constants.ts, because server-side renderers need it too
 *  and cannot import a component module. ref: AUDIT-013#dup-02 */
export { SEVERITY_ORDER };

export interface SeverityTone {
  label: string;
  /** Filled colour. Rails, dots, distribution bars. */
  solid: string;
  /** Foreground colour on a neutral or tinted surface. */
  text: string;
  /** Tinted surface. Strength scales with severity on purpose. */
  surface: string;
  /**
   * Tint for a whole PANEL rather than a chip. Held at a uniform /5 across
   * every level, unlike `surface`: a badge is a few square centimetres and can
   * carry /15, but the same value across a full-width header washes the panel
   * and eats into the contrast of every foreground colour drawn on it. /5 is
   * the strongest value that keeps the severity's own text colour above 4.5:1
   * on --card in both themes (the binding pair is critical in dark mode, at
   * 4.61:1). Painted as an overlay over bg-card, never as the panel's only
   * background, so the panel keeps a solid base.
   */
  panel: string;
  /** Tinted border to match the surface. */
  border: string;
  /**
   * How loud a finding at this level should read in a dense list. Drives
   * type weight so a critical never looks like an info with a new colour.
   */
  emphasis: "loud" | "normal" | "quiet";
}

export const SEVERITY_TONE: Record<Severity, SeverityTone> = {
  critical: {
    label: "Critical",
    solid: "bg-[hsl(var(--severity-critical))]",
    text: "text-[hsl(var(--severity-critical))]",
    surface: "bg-[hsl(var(--severity-critical))]/15",
    panel: "bg-[hsl(var(--severity-critical))]/5",
    border: "border-[hsl(var(--severity-critical))]/40",
    emphasis: "loud",
  },
  high: {
    label: "High",
    solid: "bg-[hsl(var(--severity-high))]",
    text: "text-[hsl(var(--severity-high))]",
    surface: "bg-[hsl(var(--severity-high))]/15",
    panel: "bg-[hsl(var(--severity-high))]/5",
    border: "border-[hsl(var(--severity-high))]/40",
    emphasis: "loud",
  },
  medium: {
    label: "Medium",
    solid: "bg-[hsl(var(--severity-medium))]",
    text: "text-[hsl(var(--severity-medium))]",
    surface: "bg-[hsl(var(--severity-medium))]/10",
    panel: "bg-[hsl(var(--severity-medium))]/5",
    border: "border-[hsl(var(--severity-medium))]/30",
    emphasis: "normal",
  },
  low: {
    label: "Low",
    solid: "bg-[hsl(var(--severity-low))]",
    text: "text-[hsl(var(--severity-low))]",
    surface: "bg-[hsl(var(--severity-low))]/10",
    panel: "bg-[hsl(var(--severity-low))]/5",
    border: "border-[hsl(var(--severity-low))]/30",
    emphasis: "normal",
  },
  info: {
    label: "Info",
    solid: "bg-[hsl(var(--severity-info))]",
    text: "text-[hsl(var(--severity-info))]",
    surface: "bg-muted",
    // Info is the one level that is not a problem, so its panel stays neutral
    // rather than tinting a whole header grey for no signal.
    panel: "",
    border: "border-border",
    emphasis: "quiet",
  },
};

/** Normalises anything string-shaped coming back from the API. */
export function toSeverity(value: string | undefined | null): Severity {
  const v = (value || "").toLowerCase();
  return (SEVERITY_ORDER as readonly string[]).includes(v)
    ? (v as Severity)
    : "info";
}

export function severityTone(value: string | undefined | null): SeverityTone {
  return SEVERITY_TONE[toSeverity(value)];
}

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
  /** "sm" for dense rows, "md" for detail headers. */
  size?: "sm" | "md";
}

export function SeverityBadge({
  severity,
  className,
  size = "sm",
}: SeverityBadgeProps) {
  const tone = SEVERITY_TONE[severity] ?? SEVERITY_TONE.info;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border font-semibold uppercase tracking-wide tabular-nums",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
        tone.surface,
        tone.border,
        tone.text,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full shrink-0", tone.solid)}
      />
      {tone.label}
    </span>
  );
}

/**
 * Horizontal distribution of findings by severity. Reads as one bar rather
 * than five cards, and the segment widths carry the information.
 */
export function SeverityDistribution({
  counts,
  className,
}: {
  counts: Record<Severity, number>;
  className?: string;
}) {
  const total = SEVERITY_ORDER.reduce((sum, s) => sum + (counts[s] || 0), 0);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={
          total === 0
            ? "No findings"
            : SEVERITY_ORDER.filter((s) => counts[s] > 0)
                .map((s) => `${counts[s]} ${SEVERITY_TONE[s].label}`)
                .join(", ")
        }
      >
        {total > 0 &&
          SEVERITY_ORDER.map((s) => {
            const count = counts[s] || 0;
            if (count === 0) return null;
            return (
              <span
                key={s}
                className={cn("h-full", SEVERITY_TONE[s].solid)}
                style={{ width: `${(count / total) * 100}%` }}
              />
            );
          })}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {SEVERITY_ORDER.map((s) => {
          const count = counts[s] || 0;
          const tone = SEVERITY_TONE[s];
          return (
            <span
              key={s}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs",
                count > 0 ? "text-foreground" : "text-muted-foreground/50",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  count > 0 ? tone.solid : "bg-muted-foreground/30",
                )}
              />
              <span className="font-semibold tabular-nums">{count}</span>
              <span className="text-muted-foreground">{tone.label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
