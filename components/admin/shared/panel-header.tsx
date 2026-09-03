"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/ui/utils";
import type { AdminStatusTone } from "./status-pill";

/**
 * One card header for every admin panel.
 *
 * There were four header grammars across the twenty-odd tabs: CardHeader with
 * a `text-base` CardTitle, a raw div with an `h3`, a bare `text-sm` section
 * label, and one panel with a `text-lg` `h3` inside a filled band. The refresh
 * button existed at h-8, h-9, h-10 and with no height class at all, and the
 * count badge came in two shapes or was missing. Nothing about that variation
 * carried information; it just meant the panel changed shape as you moved
 * between tabs, which is the specific thing that made /admin feel unfinished.
 *
 * The shape here is the one the strongest existing panels already used
 * (Scanner Queue and the System Health card): a toned icon tile, a title with
 * a one-line subtitle that says what the numbers mean, and the actions on the
 * right at a single height. `tone` colours the icon tile, so a panel whose
 * subject is currently unhealthy says so before you read a word.
 */
const TONE_TILE: Record<AdminStatusTone, string> = {
  ok: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
  warn: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]",
  crit: "bg-destructive/10 text-destructive",
  info: "bg-primary/10 text-primary",
  neutral: "bg-muted text-muted-foreground",
};

export function AdminPanelHeader({
  icon: Icon,
  tone = "info",
  title,
  subtitle,
  status,
  actions,
  children,
  className,
}: {
  icon: LucideIcon;
  /** Colours the icon tile. Defaults to the brand blue "this is just a panel"
   *  state; pass warn/crit when the panel's own subject is in that state. */
  tone?: AdminStatusTone;
  title: string;
  /** One line saying what the panel holds or what its numbers mean. Not a
   *  restatement of the title. */
  subtitle?: ReactNode;
  /** A StatusPill or count badge, sitting with the title rather than in the
   *  action row so it reads as part of the heading. */
  status?: ReactNode;
  /** Buttons. Use the house geometry: `size="sm" className="h-9 px-3 gap-2"`. */
  actions?: ReactNode;
  /** Extra rows below the heading, e.g. a search field or filter chips. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-b border-border/50 px-4 sm:px-5 pt-5 pb-4 space-y-4",
        className,
      )}
    >
      {/* Stacked below sm, and the title no longer truncates. The actions
          cluster is shrink-0 and a single h-9 button is about 100px, so on a
          320px screen the icon tile, the gaps and one button left roughly
          130px for the heading: "Look Up Any Host or URL" needs about 185px
          and rendered as "Look Up Any H...". A panel title is a string we
          wrote, so the row is given enough width to print it rather than
          ellipsing it. The title line wraps too, for the panels that also pass
          a status pill. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn("p-2 rounded-md shrink-0", TONE_TILE[tone])}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <h2 className="text-base font-semibold tracking-tight">
                {title}
              </h2>
              {status}
            </div>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}
