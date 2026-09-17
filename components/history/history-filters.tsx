"use client";

import { ArrowUpDown, Calendar, Filter, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tourAnchor } from "@/lib/tour/anchors";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FilterDropdown,
  filterTriggerClass,
  ListFilterBar,
  ListSearchInput,
} from "@/components/shared/list-filter-bar";
import {
  DATE_FILTER_LABELS,
  SEVERITY_FILTER_LABELS,
  SORT_LABELS,
  type HistoryQuery,
} from "@/components/history/history-filter-utils";

interface HistoryFiltersProps {
  query: HistoryQuery;
  onChange: (patch: Partial<HistoryQuery>) => void;
  allTags: string[];
  /** Narrowing controls only. The search field is always rendered. */
  showDropdowns?: boolean;
}

/**
 * The history filter row.
 *
 * Used to be a search box, a tag dropdown and Clear All. No user-facing list
 * in the product had a sort control and history had no severity or date filter
 * at all, despite every row already rendering per-severity counts. "Show me
 * every scan that turned up a critical" and "show me last week" are the two
 * questions a security team asks of a scan history, so they are the two
 * filters here.
 *
 * Built on the shared list-filter-bar recipe (ListFilterBar / ListSearchInput
 * / FilterDropdown) rather than its own hand-rolled search box and trigger
 * geometry, the same shape /repos and /shares already use. The tag filter
 * stays a plain DropdownMenu because its options are account data, not a
 * fixed enum FilterDropdown's `labels` table can express.
 *
 * Clear All is deliberately gone from this row: it deleted every scan on the
 * account from a button sitting immediately beside the search input, which is
 * the control a user touches constantly. It lives in the page header now,
 * behind a type-DELETE confirmation, rather than beside a search box.
 */
export function HistoryFilters({
  query,
  onChange,
  allTags,
  showDropdowns = true,
}: HistoryFiltersProps) {
  return (
    <ListFilterBar>
      {/* The wrapping div, not ListSearchInput itself, carries the tour
          anchor: the shared component's props are closed and do not accept a
          passthrough data-tour attribute. flex-1 here is what min-w-[12rem]
          flex-1 was doing directly on the search box before. */}
      <div {...tourAnchor("historySearch")} className="min-w-[12rem] flex-1">
        <ListSearchInput
          value={query.search}
          onChange={(search) => onChange({ search })}
          placeholder="Search by URL..."
          label="Filter scan history by URL"
        />
      </div>

      {showDropdowns && (
        <div className="flex flex-wrap items-center gap-2">
          {allTags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Filter scan history by tag"
                  className={filterTriggerClass(!!query.tag)}
                >
                  <Filter aria-hidden className="h-4 w-4" />
                  <span>{query.tag || "All tags"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onChange({ tag: null })}>
                  All tags
                </DropdownMenuItem>
                {allTags.map((tag) => (
                  <DropdownMenuItem key={tag} onClick={() => onChange({ tag })}>
                    {tag}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <FilterDropdown
            icon={ShieldAlert}
            label="Filter scan history by severity"
            value={query.severity}
            labels={SEVERITY_FILTER_LABELS}
            active={query.severity !== "any"}
            onChange={(severity) => onChange({ severity })}
          />

          <FilterDropdown
            icon={Calendar}
            label="Filter scan history by date"
            value={query.date}
            labels={DATE_FILTER_LABELS}
            active={query.date !== "any"}
            onChange={(date) => onChange({ date })}
          />

          <FilterDropdown
            icon={ArrowUpDown}
            label="Sort scan history"
            value={query.sort}
            labels={SORT_LABELS}
            active={query.sort !== "newest"}
            onChange={(sort) => onChange({ sort })}
          />
        </div>
      )}
    </ListFilterBar>
  );
}
