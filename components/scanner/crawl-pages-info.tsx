"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { severityTone } from "@/components/scanner/severity-badge";
import type { Vulnerability } from "@/lib/scanner/types";
import { plural } from "@/lib/ui/plural";
import {
  hasUnreadPages,
  readOtherPages,
  unreachablePages,
  unreadPageCounts,
  unreadSummary,
  type UnreadablePage,
} from "./crawl-pages-utils";

/** Canonical crawl result_meta shapes, imported everywhere a crawl result is
 *  rendered so a new per-page field only has to be added here once. */
export interface CrawlPageData {
  url: string;
  findings: Vulnerability[];
  findings_count: number;
  summary: Record<string, number>;
  duration: number;
}

export interface CrawlInfo {
  pagesDiscovered: number;
  pagesScanned: number;
  /** Discovered pages the crawl never got to (a page, time or quota limit).
   *  Absent on a crawl stored before the count was reported. */
  pagesSkipped?: number;
  /** Pages the crawl tried to read and could not: the fetch failed, or the
   *  site answered with a bot challenge. They have no findings because they
   *  were never read, so they are listed apart from `pages`. */
  pagesUnreachable?: UnreadablePage[];
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

  const otherPages = readOtherPages(crawlInfo.pages, crawlInfo);
  const totalOtherIssues = otherPages.reduce(
    (sum, p) => sum + p.findings_count,
    0,
  );
  const unreachable = unreachablePages(crawlInfo);
  const { skipped } = unreadPageCounts(crawlInfo);
  const unreadLine = unreadSummary(crawlInfo);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
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
        {/* Two lines when part of the crawl was not read: the second one is
            the reason the first line's "0 findings" cannot be taken as a
            clean bill, and it has to be visible without opening the panel. */}
        <span className="flex shrink-0 flex-col items-end text-xs tabular-nums">
          <span className="text-muted-foreground">
            {otherPages.length} {plural(otherPages.length, "page")},{" "}
            {totalOtherIssues} {plural(totalOtherIssues, "finding")}
          </span>
          {unreadLine && (
            <span className="font-medium text-[hsl(var(--warning))]">
              {unreadLine}
            </span>
          )}
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
                              {/* The title is a check name from our own
                                  catalogue, not a value from the scanned site.
                                  The row is indented pl-8 and carries a
                                  severity word on the right, so on a phone it
                                  had under 150px and clipped titles to three
                                  or four words. It wraps instead. */}
                              <span className="min-w-0 flex-1 text-xs leading-snug text-foreground group-hover:text-primary">
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

          {/* Pages the crawl never read. Below the results, because they are
              the caveat on them, and in the warning hue rather than the
              success one: "no findings" here means "not looked at". */}
          {hasUnreadPages(crawlInfo) && (
            <div className="border-t border-border bg-muted/20 px-4 py-3">
              {unreachable.length > 0 && (
                <>
                  <p className="text-xs font-medium text-foreground">
                    {unreachable.length} {plural(unreachable.length, "page")}{" "}
                    could not be read
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Nothing is reported for{" "}
                    {unreachable.length === 1 ? "this page" : "these pages"}{" "}
                    because the crawler never saw{" "}
                    {unreachable.length === 1 ? "it" : "them"}. Treat{" "}
                    {unreachable.length === 1 ? "it" : "them"} as unchecked, not
                    clean.
                  </p>
                  <ul className="mt-2 divide-y divide-border/50">
                    {unreachable.map((page) => (
                      <li key={page.url} className="py-1.5">
                        <div className="flex items-baseline gap-3">
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                            {getPath(page.url)}
                          </span>
                          <span className="shrink-0 text-xs font-medium text-[hsl(var(--warning))]">
                            not read
                          </span>
                        </div>
                        {page.reason && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {page.reason}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {skipped > 0 && (
                <p
                  className={cn(
                    "text-xs leading-relaxed text-muted-foreground",
                    unreachable.length > 0 && "mt-3",
                  )}
                >
                  {skipped} more {plural(skipped, "page was", "pages were")}{" "}
                  found but not scanned, because the crawl reached its page,
                  time or quota limit.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
