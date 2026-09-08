"use client";

import type { ElementType, ReactNode } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/ui/utils";

/**
 * An empty table is not always the same event, and this component used to draw
 * all of them identically: a grey circle and a grey sentence. So "Couldn't
 * load billing overview" (the request failed, the figures below are unknown)
 * and "No accounts past due" (the best news the panel can deliver) were the
 * same element, which is the one distinction an operator actually needs.
 *
 * default  a list is empty. Quiet, because an absence is not a verdict.
 * success  the thing you were looking for does not exist, and that is good.
 * warning  empty because a filter excluded everything, or something is off.
 * error    we could not read it. NOT the same as "there is nothing here".
 */
type EmptyStateTone = "default" | "success" | "warning" | "error";

const EMPTY_TONE: Record<
  EmptyStateTone,
  { ring: string; icon: string; title: string }
> = {
  default: {
    ring: "bg-muted/50",
    icon: "text-muted-foreground/50",
    title: "text-foreground",
  },
  success: {
    ring: "bg-[hsl(var(--success))]/10",
    icon: "text-[hsl(var(--success))]",
    title: "text-[hsl(var(--success))]",
  },
  warning: {
    ring: "bg-[hsl(var(--warning))]/10",
    icon: "text-[hsl(var(--warning))]",
    title: "text-[hsl(var(--warning))]",
  },
  error: {
    ring: "bg-destructive/10",
    icon: "text-destructive",
    title: "text-destructive",
  },
};

interface EmptyStateProps {
  icon: ElementType;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Leave unset for an ordinary empty list. See the table above. */
  tone?: EmptyStateTone;
  className?: string;
}

/**
 * Standard empty state for tables and lists across the admin panel.
 * Use instead of a bare table with just a header row.
 *
 * This is the admin geometry (a filled circle, tighter type) and is separate
 * from components/shared/empty-state.tsx, which is the page-level one with a
 * dashed container. Use that one on a user-facing page; use this one inside an
 * admin card that already has its own border.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "default",
  className,
}: EmptyStateProps) {
  const styles = EMPTY_TONE[tone];
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-4 text-center",
        className,
      )}
    >
      <div
        className={cn(
          "h-12 w-12 rounded-full flex items-center justify-center mb-4",
          styles.ring,
        )}
      >
        <Icon className={cn("h-6 w-6", styles.icon)} aria-hidden="true" />
      </div>
      <p className={cn("text-sm font-medium", styles.title)}>{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export type SortDirection = "asc" | "desc" | null;

interface SortableHeaderProps {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  className?: string;
  align?: "left" | "right" | "center";
}

/**
 * Clickable column header with a sort indicator. Wraps its own button so it
 * can sit inside a <TableHead>/<th> without changing that cell's padding.
 */
export function SortableHeader({
  label,
  active,
  direction,
  onClick,
  className,
  align = "left",
}: SortableHeaderProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors rounded-sm",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        align === "right" && "flex-row-reverse",
        align === "center" && "mx-auto",
        className,
      )}
      aria-label={`Sort by ${label}${active ? (direction === "asc" ? ", ascending" : ", descending") : ""}`}
    >
      {label}
      {active ? (
        direction === "asc" ? (
          <ChevronUp className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        )
      ) : (
        <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * Tiny helper for toggling a client-side sort state on a single column.
 * Cycles asc -> desc -> off. Sorts data already loaded on the page; does not
 * trigger a refetch.
 */
export function nextSortDirection(
  column: string,
  activeColumn: string | null,
  direction: SortDirection,
): { column: string | null; direction: SortDirection } {
  if (activeColumn !== column) return { column, direction: "asc" };
  if (direction === "asc") return { column, direction: "desc" };
  return { column: null, direction: null };
}

interface TableScrollAreaProps {
  children: ReactNode;
  className?: string;
  /** Cap the visible height so long tables get a sticky header + own scrollbar. */
  maxHeight?: string;
}

/**
 * The cap can never fall below this, however short the viewport is.
 *
 * Every caller states its cap in `vh`, which is a fraction of the WHOLE
 * viewport and takes no account of the browser chrome above it or of how much
 * of the page this table starts down. On a short viewport 65vh lands close to
 * the 40px header, and the table becomes a pinned header with a sliver of one
 * row under it: reported as "it's not tall enough and stuff bleeds behind it
 * when scrolling, because of a little line that shows up", which is exactly
 * what it looks like. Measured at 43.5px tall against a 40px header.
 *
 * Expressed with CSS max() rather than a min-height, deliberately. max-height
 * only ever caps, so a table with two rows is still two rows tall and gains no
 * dead space; a min-height would reserve 17rem under every short table in the
 * panel. When the viewport really is tiny the table simply grows past it and
 * the page scrolls, which is the better of the two failures.
 */
const MIN_TABLE_CAP = "17rem";

/**
 * Wraps a <Table> with a bordered, rounded container that scrolls
 * horizontally on narrow screens and, once maxHeight is reached, vertically
 * with the header pinned via `sticky top-0` on <TableHeader>. The cap never
 * drops below MIN_TABLE_CAP, so a short viewport cannot squeeze the table down
 * to its own header.
 */
export function TableScrollArea({
  children,
  className,
  maxHeight = "70vh",
}: TableScrollAreaProps) {
  return (
    // [&>div]:overflow-visible neutralises the `relative w-full overflow-auto`
    // wrapper that components/ui/table.tsx puts around every <table>. That
    // inner div is a scroll container with no height cap, so its scrollTop is
    // always 0; `position: sticky` binds to the nearest scrolling ancestor, so
    // the sticky header was pinned to a box that never scrolled while this
    // outer div did the actual scrolling. Every admin sticky header was inert.
    //
    // border-separate is what stops rows painting THROUGH the pinned header.
    //
    // components/ui/table.tsx leaves the table at `border-collapse: collapse`,
    // and Chrome does not apply the scroll container's clip correctly to a
    // table that has a sticky <thead> under the collapsed border model: the
    // bottom few pixels of the row that has just scrolled away keep painting
    // in the band ABOVE the header, outside the scrollport entirely. It reads
    // as a thin line of leftover text sitting on top of the header, and it was
    // reported three times before it was pinned down.
    //
    // Established by elimination against the live page, not by reasoning:
    // hiding <tbody> cleared the band (so it was real row content, not a
    // screenshot artifact), `display: contents` on the wrapper did not help
    // (so it was not the unclipped intermediate), and border-separate alone
    // fixed it with the header cells still transparent. border-spacing-0 keeps
    // the geometry identical to collapse, and the row rules come from
    // divide-y/border-b on the rows themselves, so nothing doubles.
    //
    // Two earlier attempts are deliberately absent, both measured and both
    // wrong: a background on the header cells (the row group already paints;
    // `elementFromPoint` returns the <th> throughout even transparent), and
    // scroll snapping (it fought the scroll and hid 48px of a row against
    // 0.5px unsnapped).
    <div
      className={cn(
        "overflow-auto [&>div]:overflow-visible",
        "[&_table]:border-separate [&_table]:border-spacing-0",
        className,
      )}
      style={{ maxHeight: `max(${maxHeight}, ${MIN_TABLE_CAP})` }}
    >
      {children}
    </div>
  );
}
