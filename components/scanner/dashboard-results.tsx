"use client";

import { useState } from "react";
import { Globe, ShieldCheck, RotateCcw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import { HistoryNotes } from "@/components/history";
import { ScanSummary } from "./scan-summary";
import { ResultsList } from "./results-list";
import { CrawlPagesInfo } from "./crawl-pages-info";
import { SubdomainDiscovery } from "./subdomain-discovery";

const ExportButton = dynamic(() =>
  import("./export-button").then((m) => ({ default: m.ExportButton })),
);
const ShareButton = dynamic(() =>
  import("./share-button").then((m) => ({ default: m.ShareButton })),
);
const ViewPageButton = dynamic(
  () =>
    import("./view-page-button").then((m) => ({
      default: m.ViewPageButton,
    })),
  { ssr: false },
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
  crawlInfo: CrawlInfo | null;
  onReset: () => void;
  onScanSubdomain: (url: string) => void;
  onSaveNotes: (notes: string) => Promise<void>;
}

export function DashboardResults({
  result,
  selectedIssue,
  onSelectIssue,
  scanHistoryId,
  scanNotes,
  crawlInfo,
  onReset,
  onScanSubdomain,
  onSaveNotes,
}: DashboardResultsProps) {
  const [copied, setCopied] = useState(false);

  if (selectedIssue) {
    return (
      <IssueDetail issue={selectedIssue} onBack={() => onSelectIssue(null)} />
    );
  }

  function copyUrl() {
    navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const displayUrl = result.url.replace(/^https?:\/\//, "");

  return (
    <div className="flex flex-col gap-4 pt-6">
      {/* URL bar + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={copyUrl}
          className="group flex items-center gap-2 min-w-0 text-left"
          title="Copy URL"
        >
          <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 shrink-0">
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Globe className="h-3.5 w-3.5 text-primary" />
            )}
          </div>
          <span className="text-sm font-semibold font-mono text-foreground truncate max-w-[200px] sm:max-w-xs group-hover:text-primary transition-colors">
            {displayUrl}
          </span>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={onReset}
            size="sm"
            className="bg-transparent h-8 gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New scan</span>
          </Button>
          <ExportButton result={result} />
          {scanHistoryId && <ShareButton scanId={scanHistoryId} />}
          <ViewPageButton url={result.url} />
        </div>
      </div>

      {/* Summary: verdict + severity — full width */}
      <ScanSummary result={result} hideHeader />

      {/* Crawl multi-page info */}
      {crawlInfo && crawlInfo.pages.length > 1 && (
        <CrawlPagesInfo crawlInfo={crawlInfo} onSelectIssue={onSelectIssue} />
      )}

      {/* Findings list or empty state */}
      {result.findings.length > 0 ? (
        <ResultsList
          findings={result.findings}
          onSelectIssue={onSelectIssue}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 py-12 text-center rounded-2xl border border-border/50 bg-card/50">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <ShieldCheck className="h-6 w-6 text-emerald-500" />
          </div>
          <p className="text-base font-semibold text-foreground">
            No issues found
          </p>
          <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
            This scan came back clean. Add a note to track when you ran it, or
            scan another URL.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="bg-transparent mt-1 gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Scan another URL
          </Button>
        </div>
      )}

      {/* Secondary: response headers, subdomain tool, notes */}
      {result.responseHeaders &&
        Object.keys(result.responseHeaders).length > 0 && (
          <ResponseHeaders headers={result.responseHeaders} />
        )}

      <SubdomainDiscovery url={result.url} onScanSubdomain={onScanSubdomain} />

      {scanHistoryId && (
        <HistoryNotes notes={scanNotes} isOwner={true} onSave={onSaveNotes} />
      )}
    </div>
  );
}
