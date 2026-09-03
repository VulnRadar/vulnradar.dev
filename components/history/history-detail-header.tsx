"use client";

import { useState } from "react";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { ScanActionsMenu } from "@/components/scanner/scan-actions-menu";
import { AuthenticatedBadge } from "@/components/scanner/authenticated-badge";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import { copyToClipboard } from "@/lib/ui/clipboard";

interface HistoryDetailHeaderProps {
  scanDetail: ScanResult;
  scanId: string;
  isOwner: boolean;
  isPublic: boolean;
  onBack: () => void;
  onDeleted: () => void;
  onVerified: (findings: Vulnerability[]) => void;
  onSummaryGenerated?: (summary: string) => void;
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
  onSummaryGenerated,
  onPrivacyChanged,
}: HistoryDetailHeaderProps) {
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    if (await copyToClipboard(scanDetail.url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to history"
            // 44px below sm: this is the only way back out of a scan detail
            // on a phone and at 28px it was under the touch minimum, sitting
            // right beside the URL button it is easy to hit by mistake.
            className="inline-flex h-11 w-11 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft aria-hidden className="h-4 w-4" />
          </button>
          {/* The scanned URL is what this view is about, so it is the page
              heading. Opening a scan from /history swaps out the list branch
              and the list's "History" h1 goes with it, so the detail view had
              no h1 at all: the document lost its title landmark and a reader
              moving by heading found nothing to land on.

              The h1 wraps the button rather than sitting inside it. A button's
              content model is phrasing content and a heading is not, so the
              other way round would be invalid markup. */}
          <h1 className="flex min-w-0 items-center">
            <button
              type="button"
              onClick={copyUrl}
              aria-label="Copy scanned URL"
              className="group flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                title={scanDetail.url}
                className="truncate font-mono text-base font-semibold text-foreground transition-colors group-hover:text-primary"
              >
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
          </h1>
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
            onSummaryGenerated={onSummaryGenerated}
            isPublic={isPublic}
            onPrivacyChanged={onPrivacyChanged}
          />
        </div>
      </div>
    </div>
  );
}
