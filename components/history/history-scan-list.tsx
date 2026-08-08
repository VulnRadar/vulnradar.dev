"use client";

import type { ScanRecord } from "./history-types";
import { HistoryScanRow } from "./history-scan-row";

interface HistoryScanListProps {
  scans: ScanRecord[];
  onViewScan: (scan: ScanRecord) => void;
  onRescan: (scan: ScanRecord) => void;
  onAddTag: (scanId: number, tag: string) => void;
  onRemoveTag: (scanId: number, tag: string) => void;
  rescanningScanId: number | null;
}

export function HistoryScanList({
  scans,
  onViewScan,
  onRescan,
  onAddTag,
  onRemoveTag,
  rescanningScanId,
}: HistoryScanListProps) {
  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      {/* Table header - desktop only */}
      <div className="hidden sm:grid sm:grid-cols-[auto,1fr,auto,auto,auto,auto] gap-4 px-4 py-2.5 border-b border-border bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="w-9" aria-hidden></span>
        <span>Target</span>
        <span className="text-center w-20">Source</span>
        <span className="text-center w-40">Findings</span>
        <span className="text-right w-20">Scanned</span>
        <span className="w-12" aria-hidden></span>
      </div>

      {/* Table rows */}
      <div className="divide-y divide-border">
        {scans.map((scan) => (
          <HistoryScanRow
            key={scan.id}
            scan={scan}
            onView={onViewScan}
            onRescan={onRescan}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            rescanning={rescanningScanId === scan.id}
          />
        ))}
      </div>
    </div>
  );
}
