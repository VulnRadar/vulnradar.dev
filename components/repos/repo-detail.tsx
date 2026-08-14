"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { API } from "@/lib/config/constants";
import { ScanSummary } from "@/components/scanner/scan-summary";
import { ResultsList } from "@/components/scanner/results-list";
import { IssueDetail } from "@/components/scanner/issue-detail";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import { mapHistoryDetailResponse } from "@/lib/scanner/history-detail";
import type { GithubRepo, GithubScanOutcome } from "./types";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.69.08-.69 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 2.87-.39c.97.01 1.95.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.8 1.18 1.83 1.18 3.09 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .3.2.66.79.55A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

interface RepoScanRow {
  id: number;
  summary: ScanResult["summary"];
  findingsCount: number;
  duration: number;
  scannedAt: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface RepoDetailProps {
  repo: GithubRepo;
  onBack: () => void;
  onScan: (repoFullName: string) => Promise<GithubScanOutcome | null>;
  scanning: boolean;
}

/**
 * Per-repo scan history: a timeline of past scans of this one repo,
 * separate from the main URL-scan History page (GET /api/v3/scan/github/
 * history?repo=... only ever returns scan_type = 'github' rows, see that
 * route's comment). Replaces the old Developer-tab behavior of an
 * expandable row showing only the LAST scan's result -- this shows every
 * past scan, oldest results included.
 */
export function RepoDetail({
  repo,
  onBack,
  onScan,
  scanning,
}: RepoDetailProps) {
  const [scans, setScans] = useState<RepoScanRow[] | null>(null);
  const [loadingScans, setLoadingScans] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedScanId, setSelectedScanId] = useState<number | null>(null);
  const [scanDetail, setScanDetail] = useState<ScanResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(
    null,
  );

  const loadScans = async () => {
    setLoadingScans(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `${API.SCAN_GITHUB_HISTORY}?repo=${encodeURIComponent(repo.fullName)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error || "Failed to load scan history.");
        return;
      }
      setScans(data.scans);
    } catch {
      setLoadError("Failed to load scan history.");
    }
    setLoadingScans(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-repo-change plus resetting selection state, gated by repo.fullName changing; loadScans' own setState only fires after its request resolves
    loadScans();
    setSelectedScanId(null);
    setScanDetail(null);
    setSelectedIssue(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.fullName]);

  const loadScanDetail = async (id: number) => {
    setSelectedScanId(id);
    setSelectedIssue(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`${API.HISTORY}/${id}`);
      if (!res.ok) {
        setScanDetail(null);
        return;
      }
      const data = await res.json();
      setScanDetail(mapHistoryDetailResponse(data));
    } catch {
      setScanDetail(null);
    }
    setDetailLoading(false);
  };

  const handleScanClick = async () => {
    const outcome = await onScan(repo.fullName);
    if (!outcome) return;
    setScans((prev) => [
      {
        id: outcome.scanHistoryId ?? -1,
        summary: outcome.result.summary,
        findingsCount: outcome.result.summary.total,
        duration: outcome.result.duration,
        scannedAt: outcome.result.scannedAt,
      },
      ...(prev ?? []),
    ]);
    // Jump straight to the fresh result instead of making the user find it
    // in the timeline they just watched grow.
    setSelectedScanId(outcome.scanHistoryId);
    setScanDetail(outcome.result);
    setSelectedIssue(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button
          size="icon"
          variant="ghost"
          onClick={
            selectedScanId !== null ? () => setSelectedScanId(null) : onBack
          }
          aria-label={
            selectedScanId !== null ? "Back to timeline" : "Back to repos"
          }
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        {repo.private ? (
          <Lock
            className="h-4 w-4 text-muted-foreground shrink-0"
            aria-hidden="true"
          />
        ) : (
          <GithubIcon className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <h1 className="text-lg font-semibold text-foreground truncate flex-1 min-w-0">
          {repo.fullName}
        </h1>
        <Button
          size="sm"
          variant="outline"
          onClick={handleScanClick}
          disabled={scanning}
          className="gap-1.5 shrink-0"
        >
          {scanning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {scans && scans.length > 0 ? "Rescan" : "Scan"}
        </Button>
      </div>

      {selectedScanId !== null ? (
        <div className="flex flex-col gap-3">
          {detailLoading && (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-40 w-full rounded-lg" />
            </div>
          )}
          {!detailLoading &&
            scanDetail &&
            (selectedIssue ? (
              <IssueDetail
                issue={selectedIssue}
                onBack={() => setSelectedIssue(null)}
              />
            ) : (
              <>
                <ScanSummary result={scanDetail} hideHeader />
                {scanDetail.findings.length > 0 ? (
                  <ResultsList
                    findings={scanDetail.findings}
                    onSelectIssue={setSelectedIssue}
                  />
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-card/50 px-4 py-10 text-center">
                    <p className="text-sm font-semibold text-[hsl(var(--success))]">
                      Nothing found on this scan
                    </p>
                  </div>
                )}
              </>
            ))}
          {!detailLoading && !scanDetail && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              This scan could not be loaded.
            </p>
          )}
        </div>
      ) : loadingScans ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      ) : loadError ? (
        <p className="text-sm text-destructive py-6 text-center">{loadError}</p>
      ) : !scans || scans.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No scans yet. Run one to see findings here.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border/60 overflow-hidden">
          {scans.map((scan) => (
            <button
              key={scan.id}
              type="button"
              onClick={() => loadScanDetail(scan.id)}
              className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <ShieldAlert
                className="h-4 w-4 text-muted-foreground shrink-0"
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {scan.findingsCount} finding
                  {scan.findingsCount === 1 ? "" : "s"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(scan.scannedAt)}
                </p>
              </div>
              <span className="hidden sm:inline text-[11px] text-muted-foreground shrink-0 tabular-nums">
                {(scan.duration / 1000).toFixed(1)}s
              </span>
              <ChevronRight
                className="h-4 w-4 text-muted-foreground shrink-0"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
