"use client";

import { TrendingDown, TrendingUp, Equal } from "lucide-react";
import {
  type DiffResult,
  formatDate,
  formatTime,
  getRelativeTime,
} from "./compare-types";
import { UrlDisplay } from "./compare-url-display";

interface CompareHeaderProps {
  result: DiffResult;
}

function ScanColumn({ tag, scan }: { tag: string; scan: DiffResult["scanA"] }) {
  return (
    <div className="p-5 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-muted-foreground">
          {tag}
        </span>
        <span className="text-xs text-muted-foreground">
          {getRelativeTime(scan.scanned_at)}
        </span>
      </div>
      <UrlDisplay url={scan.url} size="md" className="mb-2 max-w-full" />
      <p className="flex items-baseline gap-2">
        <span className="text-2xl sm:text-3xl font-semibold tabular-nums">
          {scan.findings_count}
        </span>
        <span className="text-sm text-muted-foreground">issues</span>
      </p>
      <p className="text-xs text-muted-foreground mt-2">
        {formatDate(scan.scanned_at)} at {formatTime(scan.scanned_at)}
      </p>
    </div>
  );
}

export function CompareHeader({ result }: CompareHeaderProps) {
  const delta = result.scanB.findings_count - result.scanA.findings_count;

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] divide-y md:divide-y-0 md:divide-x divide-border/50">
        <ScanColumn tag="base" scan={result.scanA} />

        <div className="flex items-center justify-center p-5 bg-muted/20">
          {delta < 0 ? (
            <span className="flex items-center gap-1.5 text-[hsl(var(--success))]">
              <TrendingDown className="h-4 w-4" aria-hidden="true" />
              <span className="text-sm font-semibold whitespace-nowrap">
                {Math.abs(delta)} fewer
              </span>
            </span>
          ) : delta > 0 ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <TrendingUp className="h-4 w-4" aria-hidden="true" />
              <span className="text-sm font-semibold whitespace-nowrap">
                {delta} more
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Equal className="h-4 w-4" aria-hidden="true" />
              <span className="text-sm font-semibold whitespace-nowrap">
                no change
              </span>
            </span>
          )}
        </div>

        <ScanColumn tag="against" scan={result.scanB} />
      </div>
    </div>
  );
}
