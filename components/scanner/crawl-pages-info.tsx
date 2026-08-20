"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { severityTone } from "@/components/scanner/severity-badge";
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

function getPath(u: string) {
  try {
    const parsed = new URL(u);
    return parsed.pathname + parsed.search || "/";
  } catch {
    return u;
  }
}

export function CrawlPagesInfo({
  crawlInfo,
  onSelectIssue,
}: CrawlPagesInfoProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [expandedPage, setExpandedPage] = useState<string | null>(null);

  const otherPages = crawlInfo.pages.slice(1);
  const totalOtherIssues = otherPages.reduce(
    (sum, p) => sum + p.findings_count,
    0,
  );

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex-1 text-sm font-medium text-foreground">
          Other pages in this crawl
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {otherPages.length} {otherPages.length === 1 ? "page" : "pages"},{" "}
          {totalOtherIssues} {totalOtherIssues === 1 ? "finding" : "findings"}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div id={panelId} className="border-t border-border">
          <ul className="divide-y divide-border">
            {otherPages.map((page) => {
              const isOpen = expandedPage === page.url;
              return (
                <li key={page.url}>
                  <button
                    type="button"
                    onClick={() => setExpandedPage(isOpen ? null : page.url)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        isOpen && "rotate-90",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                      {getPath(page.url)}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-xs tabular-nums",
                        page.findings_count === 0
                          ? "text-[hsl(var(--success))]"
                          : "text-muted-foreground",
                      )}
                    >
                      {page.findings_count === 0
                        ? "clean"
                        : page.findings_count}
                    </span>
                  </button>

                  {isOpen && page.findings.length > 0 && (
                    <ul className="bg-muted/20 pb-2">
                      {page.findings.map((finding) => {
                        const tone = severityTone(finding.severity);
                        return (
                          <li key={finding.id}>
                            <button
                              type="button"
                              onClick={() => onSelectIssue(finding)}
                              className="group relative flex w-full items-center gap-2 py-1.5 pl-8 pr-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            >
                              <span
                                aria-hidden
                                className={cn(
                                  "h-1.5 w-1.5 shrink-0 rounded-full",
                                  tone.solid,
                                )}
                              />
                              <span className="min-w-0 flex-1 truncate text-xs text-foreground group-hover:text-primary">
                                {finding.title}
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 text-[10px] font-semibold uppercase tracking-wide",
                                  tone.text,
                                )}
                              >
                                {tone.label}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
