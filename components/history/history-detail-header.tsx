"use client";

import { ArrowLeft, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/components/scanner/export-button";
import { ShareButton } from "@/components/scanner/share-button";
import { DeleteScanButton } from "@/components/scanner/delete-scan-button";
import type { ScanResult } from "@/lib/scanner/types";

interface HistoryDetailHeaderProps {
  scanDetail: ScanResult;
  scanId: number;
  isOwner: boolean;
  onBack: () => void;
  onDeleted: () => void;
}

export function HistoryDetailHeader({
  scanDetail,
  scanId,
  isOwner,
  onBack,
  onDeleted,
}: HistoryDetailHeaderProps) {
  return (
    <div className="flex flex-col gap-4 p-4 rounded-xl border border-border/50 bg-card/50">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
          <Globe className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground mb-0.5">Scanned URL</p>
          <p className="text-sm font-medium text-foreground break-all font-mono">
            {scanDetail.url}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={onBack}
          size="sm"
          className="bg-transparent"
        >
          <ArrowLeft className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Back to History</span>
        </Button>
        <div className="flex-1" />
        <ExportButton result={scanDetail} />
        <ShareButton scanId={scanId} />
        <DeleteScanButton
          scanId={scanId}
          isOwner={isOwner}
          onDeleted={onDeleted}
        />
      </div>
    </div>
  );
}
