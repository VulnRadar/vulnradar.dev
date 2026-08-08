"use client";

import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/ui/utils";

export interface PageActionItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export type PageActionEntry = PageActionItem | { separator: true };

interface PageActionsMenuProps {
  items: PageActionEntry[];
  /** Accessible name for the trigger button. Not shown as visible text. */
  label?: string;
  align?: "start" | "end";
  triggerClassName?: string;
}

/**
 * Kebab-menu trigger for pages or rows that would otherwise need a wall of
 * individual buttons (export formats, share, view, delete, and similar).
 * Consecutive `{ separator: true }` entries collapse harmlessly, and a
 * separator at either end of the list is skipped, so callers can filter
 * items in and out (e.g. hiding "Delete" for a non-owner) without also
 * hand-tracking where the dividers should go.
 */
export function PageActionsMenu({
  items,
  label = "Actions",
  align = "end",
  triggerClassName,
}: PageActionsMenuProps) {
  const visible = items.filter((entry, index) => {
    if (!("separator" in entry)) return true;
    const isEdge = index === 0 || index === items.length - 1;
    const prevIsSeparator = index > 0 && "separator" in items[index - 1];
    return !isEdge && !prevIsSeparator;
  });

  if (visible.every((entry) => "separator" in entry)) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn(
            "h-9 w-9 shrink-0 border-border/60 bg-muted/40",
            triggerClassName,
          )}
          aria-label={label}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        {visible.map((entry, index) =>
          "separator" in entry ? (
            <DropdownMenuSeparator key={`separator-${index}`} />
          ) : (
            <DropdownMenuItem
              key={entry.key}
              disabled={entry.disabled}
              onSelect={() => entry.onSelect()}
              className={cn(
                "gap-2",
                entry.destructive &&
                  "text-destructive focus:bg-destructive/10 focus:text-destructive",
              )}
            >
              <entry.icon className="h-4 w-4" aria-hidden="true" />
              {entry.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
