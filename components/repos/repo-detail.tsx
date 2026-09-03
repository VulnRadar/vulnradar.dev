"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { API } from "@/lib/config/client-constants";
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

/**
 * A load failure with the way out attached. Both failures in here used to be
 * bare centered sentences, while the parent page pairs its own load error
 * with a Try again button: a dead end on one surface and a retry on the next
 * is the same failure told two different ways.
 */
function LoadFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{message}</span>
      <Button
        size="sm"
        variant="outline"
        onClick={onRetry}
        className="shrink-0 border-destructive/30 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        Try again
      </Button>
    </div>
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
        setLoadError(
          data.error || "This repo's scan history could not be loaded.",
        );
        return;
      }
      setScans(data.scans);
    } catch {
      setLoadError(
        "Could not reach the server to load this repo's scan history.",
      );
    } finally {
      // Was a bare call after the try block, which the `return` in the
      // non-ok branch above skipped entirely: an API error left the skeleton
      // spinning forever and the error state this component already renders
      // was unreachable. `finally` runs on every exit path.
      setLoadingScans(false);
    }
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
    } finally {
      // Same defect as loadScans above: the non-ok branch returned past this,
      // leaving the detail pane loading indefinitely.
      setDetailLoading(false);
    }
  };

  const handleScanClick = async () => {
    const outcome = await onScan(repo.fullName);
    if (!outcome) return;
    // Only add a timeline row when the scan was actually persisted. A null
    // scanHistoryId used to become id:-1, which collides as a React key on a
    // second unsaved scan and makes an un-openable row (selectedScanId null
    // also skipped the jump). The detail still shows below regardless.
    const scanHistoryId = outcome.scanHistoryId;
    if (scanHistoryId != null) {
      setScans((prev) => [
        {
          id: scanHistoryId,
          summary: outcome.result.summary,
          findingsCount: outcome.result.summary.total,
          duration: outcome.result.duration,
          scannedAt: outcome.result.scannedAt,
        },
        ...(prev ?? []),
      ]);
      // Jump straight to the fresh result instead of making the user find it
      // in the timeline they just watched grow.
      setSelectedScanId(scanHistoryId);
    } else {
      // Unsaved scan: clear any prior selection so an old timeline row isn't
      // left highlighted while this fresh (un-openable) result renders.
      setSelectedScanId(null);
    }
    setScanDetail(outcome.result);
    setSelectedIssue(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* flex-wrap: the back button, the visibility glyph, the repo name and
          the Run scan button together needed more than a 320px screen has, so
          the H1 was down to about 180px and a normal org/repo pair clipped in
          the page's own title. The scan button drops to its own line first. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="icon"
          variant="ghost"
          className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"
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
        {/* Tier B, the same size the repo list's own H1 uses. At text-lg the
            title shrank the moment you drilled into a repo. */}
        {/* No text-balance: it is a no-op next to truncate's nowrap. */}
        <h1
          title={repo.fullName}
          className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground truncate flex-1 min-w-0"
        >
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
          {/* This sits outside the loadingScans branch below, so `scans` is
              still null while the timeline skeleton is up. The old
              `scans && scans.length > 0 ? "Rescan" : "Scan"` collapsed that
              null into "Scan", labelling a repo with a year of history as
              never scanned until the fetch landed. "Run scan" is the label
              for a history we have not read yet, and claims neither. */}
          {scans === null ? "Run scan" : scans.length > 0 ? "Rescan" : "Scan"}
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
                  <EmptyState
                    tone="success"
                    size="sm"
                    title="Nothing found on this scan"
                  />
                )}
              </>
            ))}
          {!detailLoading && !scanDetail && (
            <LoadFailure
              message="That scan's findings could not be loaded."
              onRetry={() => {
                if (selectedScanId !== null) loadScanDetail(selectedScanId);
              }}
            />
          )}
        </div>
      ) : loadingScans ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      ) : loadError ? (
        <LoadFailure message={loadError} onRetry={loadScans} />
      ) : !scans || scans.length === 0 ? (
        <EmptyState
          size="sm"
          title="No scans yet"
          description="A scan reads this repo's source and reports code-level issues: hardcoded secrets, injection bugs, unsafe deserialization."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={handleScanClick}
              disabled={scanning}
              className="gap-1.5 bg-transparent"
            >
              {scanning ? (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Scan this repo
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border/60 overflow-hidden">
          {scans.map((scan) => (
            <button
              key={scan.id}
              type="button"
              onClick={() => loadScanDetail(scan.id)}
              className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
