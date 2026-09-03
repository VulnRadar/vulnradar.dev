"use client";

import { Search, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
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

      {scans.length > 5 && (
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Search by domain"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search recent scans by domain"
            className={cn(
              // rounded-md, not rounded-lg: this is a control, and it was
              // wearing the card rung of the radius ladder.
              "w-full pl-9 pr-3 py-2.5 rounded-md border border-border bg-card text-base sm:text-sm text-foreground placeholder:text-muted-foreground transition-colors",
              focus.ring,
            )}
          />
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
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
                    "flex items-center gap-3 px-4 py-3 text-left transition-colors w-full group",
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
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        "text-xs font-medium px-2 py-0.5 rounded-full",
                        getSeverityBg(scan),
                        getSeverityColor(scan),
                      )}
                    >
                      {getSeverityLabel(scan)}
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        isSelected && "text-primary rotate-90",
                      )}
                    />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
