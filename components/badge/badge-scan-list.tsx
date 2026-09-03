"use client";

import { Search, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import {
  ListSearchInput,
  worthFiltering,
} from "@/components/shared/list-filter-bar";
import { UrlDisplay } from "@/components/shared/url-display";
import { cn } from "@/lib/ui/utils";
import { plural } from "@/lib/ui/plural";
import { focus } from "@/lib/ui/animations";
import {
  type ScanEntry,
  getSeverityColor,
  getSeverityBg,
  getSeverityLabel,
  getSeverityIcon,
  getRelativeTime,
  parseUrl,
} from "./badge-types";

/** The four-track layout the column header band and every row key off: the
 *  rating glyph, the URL, the rating word, the disclosure chevron. */
const GRID = "sm:grid-cols-[2rem_minmax(0,1fr)_auto_1rem]";

interface BadgeScanListProps {
  scans: ScanEntry[];
  selected: ScanEntry | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelect: (scan: ScanEntry) => void;
}

export function BadgeScanList({
  scans,
  selected,
  searchQuery,
  onSearchChange,
  onSelect,
}: BadgeScanListProps) {
  const filteredScans = scans.filter((s) => {
    if (!searchQuery) return true;
    const { subdomain, host, path } = parseUrl(s.url);
    const full = [subdomain, host, path].filter(Boolean).join("");
    return full.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Select a scan</h2>
        <span className="text-xs text-muted-foreground">
          {scans.length} {plural(scans.length, "scan")}
        </span>
      </div>

      {/* The shared search field, not a raw <input> with its own border,
          padding and text size, which is what made this control look unlike
          the one on every other list in the account. The threshold is the
          shared one too: it used to wait for six scans where /teams waited for
          four. flex-none because this sits in a COLUMN, where the field's
          default flex-1 would stretch it to fill the panel below it. */}
      {worthFiltering(scans.length) && (
        <ListSearchInput
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search by domain"
          label="Search recent scans by domain"
          className="flex-none"
        />
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* The column header band, above the scroller so it stays put while
            the rows move under it. The rating was the unlabelled column: a
            pill reading "Caution" sat at the end of every row with nothing
            saying what it rated. Dropped when there is nothing to head. */}
        {filteredScans.length > 0 && (
          <div
            className={cn(
              "hidden gap-3 border-b border-border bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid",
              GRID,
            )}
          >
            <span aria-hidden />
            <span>Scan</span>
            <span>Rating</span>
            <span aria-hidden />
          </div>
        )}
        <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
          {filteredScans.length === 0 ? (
            // Was a bare sentence with nothing to click, so the only way back
            // to the full list was to hand-delete the query. Same clear-filter
            // treatment as /assets.
            <EmptyState
              variant="inline"
              size="sm"
              icon={Search}
              title="Nothing matches that search"
              description={`No scanned domain contains "${searchQuery}".`}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSearchChange("")}
                  className="bg-transparent"
                >
                  Clear search
                </Button>
              }
            />
          ) : (
            filteredScans.map((scan) => {
              const isSelected = selected?.id === scan.id;
              // Same rating the colour and the label below come from, so the
              // glyph can no longer contradict the word next to it.
              const RatingIcon = getSeverityIcon(scan);
              return (
                <button
                  key={scan.id}
                  type="button"
                  onClick={() => onSelect(scan)}
                  aria-pressed={isSelected}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors group sm:grid sm:items-center",
                    GRID,
                    focus.ring,
                    isSelected ? "bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center justify-center w-8 h-8 rounded-lg shrink-0",
                      getSeverityBg(scan),
                    )}
                  >
                    <RatingIcon
                      className={cn("h-4 w-4", getSeverityColor(scan))}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <UrlDisplay url={scan.url} size="md" />
                    <span className="text-xs text-muted-foreground">
                      {getRelativeTime(scan.scanned_at)}
                    </span>
                  </div>
                  {/* The pill and the chevron used to share one wrapper, which
                      left the rating with no track of its own to sit under a
                      header. They are two cells now, so the word lines up down
                      the column the way it does on /assets. */}
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                      getSeverityBg(scan),
                      getSeverityColor(scan),
                    )}
                  >
                    {getSeverityLabel(scan)}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      isSelected && "text-primary rotate-90",
                    )}
                  />
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
