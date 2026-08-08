"use client";

import { Loader2, Globe, ChevronRight } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { focus } from "@/lib/ui/animations";
import { type HostGroup, getRelativeTime } from "./compare-types";

interface CompareHostPickerProps {
  hosts: HostGroup[];
  loading: boolean;
  searchActive: boolean;
  onSelect: (host: string) => void;
}

/**
 * Step 1: pick which host to compare. Only hosts with 2+ scans are ever
 * passed in, since anything else has nothing to diff against, so there is
 * no dead-end selection possible here.
 */
export function CompareHostPicker({
  hosts,
  loading,
  searchActive,
  onSelect,
}: CompareHostPickerProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      {loading ? (
        <div className="flex items-center justify-center py-14">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading scans</span>
        </div>
      ) : hosts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center px-4 gap-2">
          <Globe
            className="h-7 w-7 text-muted-foreground/40"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            {searchActive
              ? "No hosts match that filter"
              : "Nothing to compare yet"}
          </p>
          <p className="text-xs text-muted-foreground/70 max-w-xs">
            {searchActive
              ? "Try a different search, or clear it to see every host with more than one scan."
              : "Scan the same host twice and it shows up here, ready to diff."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col max-h-[480px] overflow-y-auto divide-y divide-border/50">
          {hosts.map(({ host, scans }) => (
            <li key={host}>
              <button
                type="button"
                onClick={() => onSelect(host)}
                aria-label={`Compare scans for ${host}`}
                className={cn(
                  "flex items-center gap-3 px-4 py-3.5 text-left w-full transition-colors hover:bg-muted/50",
                  focus.ring,
                )}
              >
                <span className="flex-1 min-w-0">
                  <span className="font-mono text-sm font-medium truncate block">
                    {host}
                  </span>
                  <span className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    <span>{scans.length} scans</span>
                    <span aria-hidden="true">·</span>
                    <span>latest {getRelativeTime(scans[0].scanned_at)}</span>
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 text-muted-foreground shrink-0"
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
