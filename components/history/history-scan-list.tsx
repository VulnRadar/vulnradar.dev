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
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      {/* Table header - desktop only */}
      <div className="hidden sm:grid sm:grid-cols-[1fr,auto,auto,auto,auto] gap-4 px-4 py-3 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <span>URL</span>
        <span className="text-center w-20">Source</span>
        <span className="text-center w-32">Issues</span>
        <span className="text-right w-24">Scanned</span>
        <span className="w-10"></span>
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
