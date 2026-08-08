"use client";

import { ArrowLeft } from "lucide-react";
import { ScanActionsMenu } from "@/components/scanner/scan-actions-menu";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

interface HistoryDetailHeaderProps {
  scanDetail: ScanResult;
  scanId: number;
  isOwner: boolean;
  onBack: () => void;
  onDeleted: () => void;
  onVerified: (findings: Vulnerability[]) => void;
}

export function HistoryDetailHeader({
  scanDetail,
  scanId,
  isOwner,
  onBack,
  onDeleted,
  onVerified,
}: HistoryDetailHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to history"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
        </button>
        <span className="truncate font-mono text-base font-semibold text-foreground">
          {scanDetail.url.replace(/^https?:\/\//, "")}
        </span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <ScanActionsMenu
          result={scanDetail}
          scanId={scanId}
          isOwner={isOwner}
          onDeleted={onDeleted}
          onVerified={onVerified}
        />
      </div>
    </div>
  );
}
