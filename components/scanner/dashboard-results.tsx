import { Globe, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
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
  if (selectedIssue) {
    return (
      <IssueDetail issue={selectedIssue} onBack={() => onSelectIssue(null)} />
    );
  }

  return (
    <div className="flex flex-col gap-6 pt-6">
      {/* Header card */}
      <div className="flex flex-col gap-4 p-4 rounded-xl border border-border/50 bg-card/50">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0">
            <Globe className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground mb-0.5">Scanned URL</p>
            <p className="text-sm font-medium text-foreground break-all font-mono">
              {result.url}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={onReset}
            size="sm"
            className="bg-transparent"
          >
            <RotateCcw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">New Scan</span>
          </Button>
          <div className="flex-1" />
          <ExportButton result={result} />
          {scanHistoryId && <ShareButton scanId={scanHistoryId} />}
        </div>
      </div>

      {/* Scan summary */}
      <ScanSummary result={result} />

      {/* Deep crawl: other pages scanned */}
      {crawlInfo && crawlInfo.pages.length > 1 && (
        <CrawlPagesInfo crawlInfo={crawlInfo} onSelectIssue={onSelectIssue} />
      )}

      {/* Response headers */}
      {result.responseHeaders &&
        Object.keys(result.responseHeaders).length > 0 && (
          <ResponseHeaders headers={result.responseHeaders} />
        )}

      {/* Subdomain discovery */}
      <SubdomainDiscovery url={result.url} onScanSubdomain={onScanSubdomain} />

      {/* Notes */}
      {scanHistoryId && (
        <HistoryNotes notes={scanNotes} isOwner={true} onSave={onSaveNotes} />
      )}

      {/* Results list or empty state */}
      {result.findings.length > 0 ? (
        <ResultsList findings={result.findings} onSelectIssue={onSelectIssue} />
      ) : (
        <div className="flex flex-col items-center gap-3 py-8 text-center rounded-xl border border-dashed border-border">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-emerald-500" />
          </div>
          <p className="text-sm font-medium text-foreground">No issues found</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            This scan came back clean with no detected vulnerabilities.
          </p>
        </div>
      )}
    </div>
  );
}
