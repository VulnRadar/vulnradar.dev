import type { LucideIcon } from "lucide-react";
import { StatStrip, type StatStripItem } from "@/components/shared/stat-strip";
import type { StatTone } from "@/components/shared/stat-icon";

export type { StatTone };

/**
 * The admin panel's inline stat bar. It used to carry its own copy of the
 * icon-tone palette, which had already drifted: it still mapped `purple` and
 * `orange` to raw Tailwind palette colours (`purple-500`, `orange-500`) that
 * do not participate in theming, while the shared table in
 * components/shared/stat-icon.tsx had moved both onto `--chart-4` / `--chart-3`.
 * Two tables meant an admin strip and a dashboard strip could not agree on
 * what "purple" was. There is one table now, and this is a wrapper over the
 * shared strip (components/shared/stat-strip.tsx) at its compact density.
 */
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
   * small colored rounded-square container (see `tone`).
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
  const stripItems: StatStripItem[] = items.map((item) => ({
    label: item.label,
    value: item.value,
    icon: item.icon,
    // The admin default has always been "primary"; the shared strip's own
    // default is "muted", so it has to be spelled out here rather than left
    // to fall through.
    iconTone: item.tone ?? "primary",
    onClick: item.onClick,
    active: item.active,
  }));
  return <StatStrip items={stripItems} size="sm" className={className} />;
}
