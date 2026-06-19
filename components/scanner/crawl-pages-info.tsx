import { useState } from "react";
import { Globe, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { Vulnerability } from "@/lib/scanner/types";

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

interface CrawlPagesInfoProps {
  crawlInfo: CrawlInfo;
  onSelectIssue: (issue: Vulnerability) => void;
}

export function CrawlPagesInfo({
  crawlInfo,
  onSelectIssue,
}: CrawlPagesInfoProps) {
  const [open, setOpen] = useState(false);
  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const otherPages = crawlInfo.pages.slice(1);
  const totalOtherIssues = otherPages.reduce(
    (sum, p) => sum + p.findings_count,
    0,
  );

  function getPath(u: string) {
    try {
      return new URL(u).pathname + new URL(u).search || "/";
    } catch {
      return u;
    }
  }

  const SEV_DOT: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-blue-500",
    info: "bg-muted-foreground/50",
  };
  const SEV_TEXT: Record<string, string> = {
    critical: "text-red-500 bg-red-500/10 border-red-500/20",
    high: "text-orange-500 bg-orange-500/10 border-orange-500/20",
    medium: "text-amber-500 bg-amber-500/10 border-amber-500/20",
    low: "text-blue-500 bg-blue-500/10 border-blue-500/20",
    info: "text-muted-foreground bg-muted border-border",
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <Globe className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground flex-1">
          Also Crawled
        </span>
        <span className="text-xs text-muted-foreground">
          {otherPages.length} {otherPages.length === 1 ? "page" : "pages"} /{" "}
          {totalOtherIssues} issues
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-border/50">
          {/* Stats bar */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 bg-muted/30 border-b border-border/50">
            <span className="text-xs text-muted-foreground">
              Pages:{" "}
              <span className="font-medium text-foreground">
                {otherPages.length}
              </span>
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {totalOtherIssues} total issues
            </span>
          </div>

          {/* Pages list */}
          <div className="divide-y divide-border/50">
            {otherPages.map((page) => (
              <div key={page.url}>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedPage(expandedPage === page.url ? null : page.url)
                  }
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground truncate">
                      {getPath(page.url)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {page.url}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-2 shrink-0">
                    <span className="text-xs font-medium text-foreground">
                      {page.findings_count}
                    </span>
                    {expandedPage === page.url ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {/* Expanded findings */}
                {expandedPage === page.url && page.findings.length > 0 && (
                  <div className="bg-muted/20 px-4 py-2 space-y-1">
                    {page.findings.map((finding) => (
                      <button
                        key={finding.id}
                        type="button"
                        onClick={() => onSelectIssue(finding)}
                        className={`flex items-start gap-2 p-2 rounded text-left hover:bg-muted/40 transition-colors w-full text-xs border ${SEV_TEXT[finding.severity]}`}
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${SEV_DOT[finding.severity]}`}
                        />
                        <span className="font-medium truncate flex-1">
                          {finding.title}
                        </span>
                        <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
