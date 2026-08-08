"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { focus } from "@/lib/ui/animations";
import {
  type ScanOption,
  formatDate,
  formatTime,
  getRelativeTime,
  parseUrl,
} from "./compare-types";

interface CompareHostScanPickerProps {
  scans: ScanOption[];
  selectedA: number | null;
  selectedB: number | null;
  onToggle: (id: number) => void;
}

/**
 * Step 2: pick two scans from a single host's own history. Order does not
 * matter, whichever of the two picks is older is labeled "base" and the
 * other "against" as soon as both are chosen, the same way the comparison
 * result itself will label them.
 */
export function CompareHostScanPicker({
  scans,
  selectedA,
  selectedB,
  onToggle,
}: CompareHostScanPickerProps) {
  const bothPicked = selectedA !== null && selectedB !== null;
  const olderId = bothPicked
    ? new Date(scans.find((s) => s.id === selectedA)!.scanned_at).getTime() <=
      new Date(scans.find((s) => s.id === selectedB)!.scanned_at).getTime()
      ? selectedA
      : selectedB
    : null;

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      <ul className="flex flex-col max-h-[480px] overflow-y-auto divide-y divide-border/50">
        {scans.map((scan) => {
          const isSelected = selectedA === scan.id || selectedB === scan.id;
          const tag = bothPicked && isSelected
            ? scan.id === olderId
              ? "base"
              : "against"
            : null;
          const path = parseUrl(scan.url).path;

          return (
            <li key={scan.id}>
              <button
                type="button"
                onClick={() => onToggle(scan.id)}
                aria-pressed={isSelected}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 text-left w-full transition-colors",
                  focus.ring,
                  isSelected
                    ? "bg-primary/5 border-l-2 border-l-primary"
                    : "hover:bg-muted/50",
                )}
              >
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {formatDate(scan.scanned_at)} at{" "}
                      {formatTime(scan.scanned_at)}
                    </span>
                    {path && (
                      <span className="font-mono text-xs text-muted-foreground/70 truncate">
                        {path}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    <span>{getRelativeTime(scan.scanned_at)}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        scan.findings_count === 0
                          ? "text-[hsl(var(--success))]"
                          : "text-foreground",
                      )}
                    >
                      {scan.findings_count}{" "}
                      {scan.findings_count === 1 ? "issue" : "issues"}
                    </span>
                  </span>
                </span>
                {tag && (
                  <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-muted-foreground shrink-0">
                    {tag}
                  </span>
                )}
                {isSelected && (
                  <Check
                    className="h-4 w-4 text-primary shrink-0"
                    aria-hidden="true"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
