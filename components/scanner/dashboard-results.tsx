"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import type { ScanAuthReport } from "@/lib/scanner/auth/types";
import {
  HistoryNotes,
  HistoryTagsCard,
  type ScanTag,
} from "@/components/history";
import { AuthenticatedBadge } from "./authenticated-badge";
import { ScanSummary } from "./scan-summary";
import { ResultsList } from "./results-list";
import { CrawlPagesInfo } from "./crawl-pages-info";
import { SubdomainDiscovery } from "./subdomain-discovery";
import { cn } from "@/lib/ui/utils";

const ScanActionsMenu = dynamic(() =>
  import("./scan-actions-menu").then((m) => ({ default: m.ScanActionsMenu })),
);
const ResponseHeaders = dynamic(() =>
  import("./response-headers").then((m) => ({ default: m.ResponseHeaders })),
);
const IssueDetail = dynamic(() =>
  import("./issue-detail").then((m) => ({ default: m.IssueDetail })),
);

interface CrawlPageData {
  url: string;
  findings: Vulnerability[];
  findings_count: number;
  summary: Record<string, number>;
  duration: number;
}

interface CrawlInfo {
  pagesDiscovered: number;
  pagesScanned: number;
  pages: CrawlPageData[];
}

interface DashboardResultsProps {
  result: ScanResult;
  selectedIssue: Vulnerability | null;
  onSelectIssue: (issue: Vulnerability | null) => void;
  scanHistoryId: number | null;
  scanNotes: string;
  scanTags: ScanTag[];
  onAddTag: (scanId: number, tag: string) => void;
  onRemoveTag: (scanId: number, tag: string) => void;
  crawlInfo: CrawlInfo | null;
  authReport?: ScanAuthReport | null;
  onReset: () => void;
  onScanSubdomain: (url: string) => void;
  onSaveNotes: (notes: string) => Promise<void>;
  onFindingsUpdated?: (findings: Vulnerability[]) => void;
}

export function DashboardResults({
  result,
  selectedIssue,
  onSelectIssue,
  scanHistoryId,
  scanNotes,
  scanTags,
  onAddTag,
  onRemoveTag,
  crawlInfo,
  authReport,
  onReset,
  onScanSubdomain,
  onSaveNotes,
  onFindingsUpdated,
}: DashboardResultsProps) {
  const [copied, setCopied] = useState(false);
  // scan_history.is_public defaults to true, and this view has no "start
  // private" control yet, so a freshly completed scan is always public
  // until toggled here -- local state is enough since nothing else on this
  // page reads it.
  const [isPublic, setIsPublic] = useState(true);
  // Overrides result.aiSummary once a "Generate AI summary" action finishes,
  // so the summary shows up in ScanSummary immediately instead of only
  // after the next fetch of this scan. Undefined until then, so
  // displayResult below falls back to whatever result.aiSummary already had
  // (e.g. re-opening a scan that was summarized in an earlier session).
  const [aiSummary, setAiSummary] = useState<string | undefined>(undefined);

  if (selectedIssue) {
    return (
      <div className="pt-6">
        <IssueDetail
          issue={selectedIssue}
          onBack={() => onSelectIssue(null)}
          findingUrl={result.url}
          scanHistoryId={scanHistoryId}
        />
      </div>
    );
  }

  function copyUrl() {
    navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const displayUrl = result.url.replace(/^https?:\/\//, "");
  const displayResult = aiSummary ? { ...result, aiSummary } : result;

  return (
    <div className="flex flex-col gap-4 pt-6">
      {/* Target + actions */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={copyUrl}
            aria-label="Copy scanned URL"
            className="group flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate font-mono text-base font-semibold text-foreground transition-colors group-hover:text-primary">
              {displayUrl}
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
          {authReport?.status === "authenticated" && (
            <AuthenticatedBadge className="shrink-0" />
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={onReset}
            size="sm"
            className="h-8 gap-1.5 bg-transparent"
          >
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            New scan
          </Button>
          <ScanActionsMenu
            result={displayResult}
            scanId={scanHistoryId}
            isOwner={Boolean(scanHistoryId)}
            onDeleted={onReset}
            onVerified={onFindingsUpdated}
            onSummaryGenerated={setAiSummary}
            isPublic={isPublic}
            onPrivacyChanged={setIsPublic}
          />
        </div>
      </div>

      {authReport?.status === "lost" && (
        <div className="flex items-start gap-3 rounded-md border border-[hsl(var(--severity-high))]/30 bg-[hsl(var(--severity-high))]/10 px-4 py-3">
          <AlertTriangle
            aria-hidden
            className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--severity-high))]"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[hsl(var(--severity-high))]">
              Session dropped mid-scan
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-foreground/90">
              The scanner signed in but lost the session before the run finished
              {authReport.reason ? `: ${authReport.reason}` : "."} Findings from
              after that point reflect the logged-out surface, not the
              authenticated one. Treat this report as partial.
            </p>
          </div>
        </div>
      )}

      <ScanSummary result={displayResult} hideHeader />

      {crawlInfo && crawlInfo.pages.length > 1 && (
        <CrawlPagesInfo crawlInfo={crawlInfo} onSelectIssue={onSelectIssue} />
      )}

      <div className="flex flex-col gap-3 border-t border-border/50 pt-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          More about this host
        </h2>

        {result.responseHeaders &&
          Object.keys(result.responseHeaders).length > 0 && (
            <ResponseHeaders headers={result.responseHeaders} />
          )}

        <SubdomainDiscovery
          url={result.url}
          onScanSubdomain={onScanSubdomain}
        />

        {scanHistoryId && (
          <>
            <HistoryTagsCard
              scanId={scanHistoryId}
              tags={scanTags}
              onAdd={onAddTag}
              onRemove={onRemoveTag}
            />
            <HistoryNotes
              notes={scanNotes}
              isOwner={true}
              onSave={onSaveNotes}
            />
          </>
        )}
      </div>

      {result.findings.length > 0 ? (
        <ResultsList findings={result.findings} onSelectIssue={onSelectIssue} />
      ) : (
        <div
          className={cn(
            "flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card/50 px-4 py-12 text-center",
          )}
        >
          <p className="text-base font-semibold text-foreground">
            Zero findings on this host
          </p>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Every enabled check ran and none of them fired. Add a note so you
            know what state the host was in, or scan another target.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="mt-1 h-8 gap-1.5 bg-transparent"
          >
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            New scan
          </Button>
        </div>
      )}
    </div>
  );
}
