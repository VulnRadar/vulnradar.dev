"use client";

import { useState } from "react";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { ScanActionsMenu } from "@/components/scanner/scan-actions-menu";
import { AuthenticatedBadge } from "@/components/scanner/authenticated-badge";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

interface HistoryDetailHeaderProps {
  scanDetail: ScanResult;
  scanId: number;
  isOwner: boolean;
  isPublic: boolean;
  onBack: () => void;
  onDeleted: () => void;
  onVerified: (findings: Vulnerability[]) => void;
  onPrivacyChanged: (isPublic: boolean) => void;
}

export function HistoryDetailHeader({
  scanDetail,
  scanId,
  isOwner,
  isPublic,
  onBack,
  onDeleted,
  onVerified,
  onPrivacyChanged,
}: HistoryDetailHeaderProps) {
  const [copied, setCopied] = useState(false);

  function copyUrl() {
    navigator.clipboard.writeText(scanDetail.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to history"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={copyUrl}
          aria-label="Copy scanned URL"
          className="group flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="truncate font-mono text-base font-semibold text-foreground transition-colors group-hover:text-primary">
            {scanDetail.url.replace(/^https?:\/\//, "")}
          </span>
          {copied ? (
            <Check
              aria-hidden
              className="h-4 w-4 shrink-0 text-[hsl(var(--success))]"
            />
          ) : (
            <Copy
              aria-hidden
              className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          )}
        </button>
        {scanDetail.authenticated && (
          <AuthenticatedBadge className="shrink-0" />
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <ScanActionsMenu
          result={scanDetail}
          scanId={scanId}
          isOwner={isOwner}
          onDeleted={onDeleted}
          onVerified={onVerified}
          isPublic={isPublic}
          onPrivacyChanged={onPrivacyChanged}
        />
      </div>
    </div>
  );
}
