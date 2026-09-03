import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/utils";

/**
 * The admin panel's one way of saying "this thing is fine / this thing is
 * not". Before this existed, every panel spelled a state out in plain
 * `font-medium` prose: the Backups tab printed "Last run failed" in exactly
 * the colour it printed "Idle", the Updater printed the raw job enum
 * ("completed", "failed") into a grey Badge, and a not-enforced access rule
 * was the quietest element in its own row. An operator scanning for the thing
 * that is wrong could not find it by colour, which is the only way anyone
 * scans a dense tool.
 *
 * Four tones, and they mean what the health list means, so the vocabulary is
 * the same everywhere in the panel:
 *
 *   ok       working as intended. Green.
 *   warn     needs a human eventually. Amber.
 *   crit     needs a human now, or has already failed. Red.
 *   info     true but not a verdict (a version, a mode, a count). Blue.
 *   neutral  off, idle, or not applicable. Grey, and deliberately quiet.
 *
 * Severity tokens (`--severity-*`) are NOT used here. Those encode how bad a
 * scan finding is; reusing them for operational state gives one meaning two
 * palettes. See audits/AUDIT-011/design-language.md D5.
 */
export type AdminStatusTone = "ok" | "warn" | "crit" | "info" | "neutral";

const TONE_CLASSES: Record<AdminStatusTone, string> = {
  ok: "border-[hsl(var(--success))]/25 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
  warn: "border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]",
  crit: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-primary/25 bg-primary/10 text-primary",
  neutral: "border-border bg-muted/50 text-muted-foreground",
};

const DOT_CLASSES: Record<AdminStatusTone, string> = {
  ok: "bg-[hsl(var(--success))]",
  warn: "bg-[hsl(var(--warning))]",
  crit: "bg-destructive",
  info: "bg-primary",
  neutral: "bg-muted-foreground/50",
};

export function StatusPill({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: AdminStatusTone;
  /** Optional glyph. Without one the pill shows a dot, so the tone is never
   *  carried by the fill colour alone at small sizes. */
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {Icon ? (
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      ) : (
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASSES[tone])}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

/**
 * The same verdict at field size: a value with its state carried by colour,
 * for the "Last backup / Status / Version" fact grids that panels open with.
 * Those grids used to render every value in the same `font-medium`, so the
 * one word that could be bad sat at the weight of the four that could not.
 */
export function StatusValue({
  tone,
  children,
  className,
}: {
  tone: AdminStatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        tone === "ok"
          ? "text-[hsl(var(--success))]"
          : tone === "warn"
            ? "text-[hsl(var(--warning))]"
            : tone === "crit"
              ? "text-destructive"
              : tone === "info"
                ? "text-foreground"
                : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
