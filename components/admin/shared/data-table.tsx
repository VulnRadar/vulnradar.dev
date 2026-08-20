"use client";

import type { ElementType, ReactNode } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/ui/utils";

interface EmptyStateProps {
  icon: ElementType;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Standard empty state for tables and lists across the admin panel.
 * Use instead of a bare table with just a header row.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-4 text-center",
        className,
      )}
    >
      <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <Icon className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
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
    <div className={cn("overflow-auto", className)} style={{ maxHeight }}>
      {children}
    </div>
  );
}
