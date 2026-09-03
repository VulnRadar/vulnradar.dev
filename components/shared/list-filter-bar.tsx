"use client";

import type { LucideIcon } from "lucide-react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/ui/utils";

/**
 * The filter row the account's list pages share.
 *
 * /history already had this shape: a search field paired with a cluster of
 * dropdown triggers. Every other list in the account had a different fraction
 * of it. /repos drew a bare full-width input with no filters at all, /shares
 * had neither, /teams an input at different metrics, and /badge a raw
 * `<input>` with its own hand-written border and padding. Five lists doing one
 * job, drawn five ways, is most of why /repos and /history read as different
 * products. The recipe lives here so a sixth list cannot invent a sixth
 * version of it.
 */

/**
 * A list at or below this length is already entirely on screen, so a control
 * for narrowing it is noise rather than help. components/teams/teams-list.tsx
 * made that call first ("it appears once there is enough here to be worth
 * filtering") and this is the same number everywhere now: /badge used to wait
 * for six rows and /repos offered a search box over a single repository.
 */
export const LIST_FILTER_MIN_ITEMS = 3;

/** Whether a list of `count` rows is long enough to be worth filtering. */
export function worthFiltering(count: number): boolean {
  // Governs the DROPDOWNS only. Search is unconditional: it costs one row,
  // stays useful on a short list, and gating it here is what removed the
  // search box from /repos for an account with exactly three repositories.
  return count > LIST_FILTER_MIN_ITEMS;
}

/**
 * The row itself: search on its own line below sm, inline with the trigger
 * cluster from sm up.
 */
export function ListFilterBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The search field. `flex-1` is the shape it takes inside a ListFilterBar; a
 * caller rendering it on its own in a COLUMN (where flex-grow would stretch it
 * vertically) passes `className="flex-none"`.
 */
export function ListSearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** Accessible name. The placeholder disappears the moment anyone types. */
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-[12rem] flex-1", className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-10 bg-card/50 pl-9"
      />
    </div>
  );
}

// One trigger shape for every dropdown in the row, so a filter cluster does
// not read as three different controls that happen to sit next to each other.
// h-11 below sm because a trigger is a standalone touch target and 40px is
// under the floor; it steps back to the search field's height from sm up,
// where the two share a line.
const TRIGGER_CLASS = "h-11 shrink-0 gap-2 bg-transparent sm:h-10";

// An engaged filter is the single most important thing this row can say, and
// an unstyled active trigger looks exactly like an idle one: a list narrowed
// to "Has findings" reads as the whole list, with the only clue being the word
// inside the button. Same brand-blue chip the findings list uses for its own
// active filters.
const ACTIVE_TRIGGER_CLASS =
  "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary";

export function filterTriggerClass(active: boolean): string {
  return cn(TRIGGER_CLASS, active && ACTIVE_TRIGGER_CLASS);
}

/**
 * One dropdown in the cluster. The options are the keys of `labels`, in
 * declaration order, which keeps the menu and the trigger's own text reading
 * off a single table.
 */
export function FilterDropdown<T extends string>({
  icon: Icon,
  label,
  value,
  labels,
  active,
  onChange,
}: {
  icon: LucideIcon;
  /** Accessible name, e.g. "Filter repositories by scan status". The trigger
   *  shows only the selected option, which does not say what it selects. */
  label: string;
  value: T;
  labels: Record<T, string>;
  /** Whether this filter is narrowing anything, i.e. not on its default. */
  active: boolean;
  onChange: (next: T) => void;
}) {
  const keys = Object.keys(labels) as T[];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={label}
          className={filterTriggerClass(active)}
        >
          <Icon aria-hidden className="h-4 w-4" />
          <span>{labels[value]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {keys.map((key) => (
          <DropdownMenuItem key={key} onClick={() => onChange(key)}>
            {labels[key]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
