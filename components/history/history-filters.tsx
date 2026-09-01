"use client";

import {
  ArrowUpDown,
  Calendar,
  Filter,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DATE_FILTER_LABELS,
  SEVERITY_FILTER_LABELS,
  SORT_LABELS,
  type HistoryDateFilter,
  type HistoryQuery,
  type HistorySeverityFilter,
  type HistorySort,
} from "@/components/history/history-filter-utils";

interface HistoryFiltersProps {
  query: HistoryQuery;
  onChange: (patch: Partial<HistoryQuery>) => void;
  allTags: string[];
}

// One trigger shape for all four dropdowns, so a filter row does not read as
// four different controls that happen to sit next to each other.
const TRIGGER_CLASS = "h-10 shrink-0 gap-2 bg-transparent";

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
 * Clear All is deliberately gone from this row: it deleted every scan on the
 * account from a button sitting immediately beside the search input, which is
 * the control a user touches constantly. It lives in the page header now,
 * behind a type-DELETE confirmation, rather than beside a search box.
 */
export function HistoryFilters({
  query,
  onChange,
  allTags,
}: HistoryFiltersProps) {
  const severityKeys = Object.keys(
    SEVERITY_FILTER_LABELS,
  ) as HistorySeverityFilter[];
  const dateKeys = Object.keys(DATE_FILTER_LABELS) as HistoryDateFilter[];
  const sortKeys = Object.keys(SORT_LABELS) as HistorySort[];

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-[12rem] flex-1">
        <Search
          aria-hidden
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          placeholder="Search by URL..."
          value={query.search}
          onChange={(e) => onChange({ search: e.target.value })}
          aria-label="Filter scan history by URL"
          className="h-10 bg-card/50 pl-9"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {allTags.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={TRIGGER_CLASS}>
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={TRIGGER_CLASS}>
              <ShieldAlert aria-hidden className="h-4 w-4" />
              <span>{SEVERITY_FILTER_LABELS[query.severity]}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {severityKeys.map((key) => (
              <DropdownMenuItem
                key={key}
                onClick={() => onChange({ severity: key })}
              >
                {SEVERITY_FILTER_LABELS[key]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={TRIGGER_CLASS}>
              <Calendar aria-hidden className="h-4 w-4" />
              <span>{DATE_FILTER_LABELS[query.date]}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {dateKeys.map((key) => (
              <DropdownMenuItem
                key={key}
                onClick={() => onChange({ date: key })}
              >
                {DATE_FILTER_LABELS[key]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={TRIGGER_CLASS}>
              <ArrowUpDown aria-hidden className="h-4 w-4" />
              <span>{SORT_LABELS[query.sort]}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {sortKeys.map((key) => (
              <DropdownMenuItem
                key={key}
                onClick={() => onChange({ sort: key })}
              >
                {SORT_LABELS[key]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
