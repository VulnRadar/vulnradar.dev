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
 * Wraps a <Table> with a bordered, rounded container that scrolls
 * horizontally on narrow screens and, once maxHeight is reached, vertically
 * with the header pinned via `sticky top-0` on <TableHeader>.
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
    <div
      className={cn("overflow-auto [&>div]:overflow-visible", className)}
      style={{ maxHeight }}
    >
      {children}
    </div>
  );
}
