"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { ScanSummary } from "@/components/scanner/scan-summary";
import { ResultsList } from "@/components/scanner/results-list";
import { IssueDetail } from "@/components/scanner/issue-detail";
import { ResponseHeaders } from "@/components/scanner/response-headers";
import { SubdomainDiscovery } from "@/components/scanner/subdomain-discovery";
import { CrawlPagesInfo } from "@/components/scanner/crawl-pages-info";
import {
  PaginationControl,
  usePagination,
} from "@/components/ui/pagination-control";
import { API, BILLING_HISTORY_RETENTION } from "@/lib/config/constants";
import {
  getQueryParamInt,
  QUERY_CHANGE_EVENT,
  removeQueryParam,
  setQueryParam,
} from "@/lib/ui/url-state";
import { useAuth } from "@/components/providers/auth-provider";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

import {
  type ScanRecord,
  HistoryStats,
  HistoryFilters,
  HistoryScanList,
  HistoryEmptyState,
  HistoryDetailHeader,
  HistoryNotes,
} from "@/components/history";
import { HistorySkeleton } from "@/components/history/history-skeleton";

/** Same key results-list.tsx / issue-detail.tsx read and write. */
const FINDING_QUERY_PARAM = "finding";

/** Mirrors app/dashboard/page.tsx's shape for the same crawl result_meta. */
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

export default function HistoryPage() {
  const router = useRouter();
  const { me } = useAuth();

  // List state
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [filter, setFilter] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(
    () => getQueryParamInt("page") ?? 1,
  );
  const [pageSize, setPageSize] = useState(10);
  const [rescanning, setRescanning] = useState<number | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Detail state
  const [selectedScanId, setSelectedScanId] = useState<number | null>(null);
  const [scanDetail, setScanDetail] = useState<ScanResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(
    null,
  );
  const [scanOwnerId, setScanOwnerId] = useState<number | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [scanNotes, setScanNotes] = useState("");
  const [crawlInfo, setCrawlInfo] = useState<CrawlInfo | null>(null);

  // Retention info
  const isStaff =
    me?.role && ["admin", "moderator", "support"].includes(me.role);
  const userPlan = (me?.plan ||
    "free") as keyof typeof BILLING_HISTORY_RETENTION;
  const retentionDays = isStaff
    ? -1
    : (BILLING_HISTORY_RETENTION[userPlan] ?? BILLING_HISTORY_RETENTION.free);

  // URL query param sync
  const updateUrlWithScan = useCallback(
    (id: number | null, replace = false) => {
      setQueryParam("scan", id === null ? null : String(id), { replace });
    },
    [],
  );

  // page=1 is the implicit default, so it's left out of the URL entirely
  // rather than ever showing up as ?page=1.
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    setQueryParam("page", page > 1 ? String(page) : null, { replace: true });
  }, []);

  const loadScanDetail = useCallback(async (scanId: number) => {
    setDetailLoading(true);
    setCrawlInfo(null);
    try {
      const res = await fetch(`${API.HISTORY}/${scanId}`);
      if (!res.ok) {
        setSelectedScanId(null);
        return;
      }
      const data = await res.json();
      setScanDetail({
        url: data.url,
        scannedAt: data.scannedAt,
        duration: data.duration,
        summary: data.summary,
        findings: data.findings,
        responseHeaders: data.responseHeaders,
        // From scan_history.result_meta, same source
        // app/api/v3/scan/status/[id]/route.ts spreads for the
        // just-completed results view, so both pages show the same stats.
        checksRun: data.checksRun,
        dangerScore: data.dangerScore,
        engineConfidence: data.engineConfidence,
        incomplete: data.incomplete,
        authenticated: data.authenticated,
      });
      if (data.crawl && data.crawl.pages?.length > 0) {
        setCrawlInfo(data.crawl);
      }
      setScanOwnerId(data.userId || null);
      setScanNotes(data.notes || "");
    } catch {
      setSelectedScanId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // undefined until the first run, so the initial mount (which may be
  // loading a deep link like ?scan=5&finding=xyz) is never mistaken for a
  // "switched scans" transition and doesn't wipe the finding param it was
  // asked to restore.
  const prevScanIdRef = useRef<number | null | undefined>(undefined);

  const handleQueryChange = useCallback(() => {
    const id = getQueryParamInt("scan");
    const scanChanged =
      prevScanIdRef.current !== undefined && prevScanIdRef.current !== id;
    prevScanIdRef.current = id;

    if (scanChanged) {
      // A different scan (or back to the list) invalidates whatever
      // finding was selected under the previous scan: its findings array
      // is unrelated, and check ids repeat across scans, so leaving the
      // param around risks re-selecting an unrelated finding that just
      // happens to share an id.
      setSelectedIssue(null);
      removeQueryParam(FINDING_QUERY_PARAM, { replace: true });
    }

    if (id !== null) {
      setSelectedScanId(id);
      loadScanDetail(id);
    } else {
      setSelectedScanId(null);
      setScanDetail(null);
    }
  }, [loadScanDetail]);

  useEffect(() => {
    handleQueryChange();
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (detail.key === "scan") handleQueryChange();
    };
    window.addEventListener(QUERY_CHANGE_EVENT, onChange);
    window.addEventListener("popstate", handleQueryChange);
    return () => {
      window.removeEventListener(QUERY_CHANGE_EVENT, onChange);
      window.removeEventListener("popstate", handleQueryChange);
    };
  }, [handleQueryChange]);

  // Keeps currentPage in sync with browser back/forward on ?page=.
  useEffect(() => {
    const syncPageFromUrl = () => setCurrentPage(getQueryParamInt("page") ?? 1);
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (detail.key === "page") syncPageFromUrl();
    };
    window.addEventListener(QUERY_CHANGE_EVENT, onChange);
    window.addEventListener("popstate", syncPageFromUrl);
    return () => {
      window.removeEventListener(QUERY_CHANGE_EVENT, onChange);
      window.removeEventListener("popstate", syncPageFromUrl);
    };
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(API.HISTORY);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) router.push("/login");
        return;
      }
      const data = await res.json();
      setScans(Array.isArray(data.scans) ? data.scans : []);
    } catch {
      setScans([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchHistory();
    fetch(API.SCAN_TAGS)
      .then((r) => r.json())
      .then((d) => setAllTags(d.tags || []))
      .catch(() => {});
    fetch(API.AUTH.ME)
      .then((r) => r.json())
      .then((d) => setCurrentUserId(d.userId || null))
      .catch(() => {});
  }, [fetchHistory]);

  // Handlers
  const handleViewScan = (scan: ScanRecord) => {
    setSelectedScanId(scan.id);
    setSelectedIssue(null);
    loadScanDetail(scan.id);
    updateUrlWithScan(scan.id);
  };

  const handleBackToList = () => {
    setSelectedScanId(null);
    setScanDetail(null);
    setSelectedIssue(null);
    setCrawlInfo(null);
    updateUrlWithScan(null);
  };

  const handleRescan = async (scan: ScanRecord) => {
    setRescanning(scan.id);
    try {
      const res = await fetch(API.SCAN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scan.url }),
      });
      if (res.ok) await fetchHistory();
    } catch {}
    setRescanning(null);
  };

  const handleClearHistory = async () => {
    setShowClearConfirm(false);
    setClearing(true);
    try {
      await fetch(API.HISTORY, { method: "DELETE" });
      setScans([]);
    } catch {}
    setClearing(false);
  };

  const handleAddTag = async (scanId: number, tag: string) => {
    if (!tag.trim()) return;
    const res = await fetch(API.SCAN_TAGS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, tag: tag.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      setScans((prev) =>
        prev.map((s) => (s.id === scanId ? { ...s, tags: data.tags } : s)),
      );
      if (!allTags.includes(tag.trim().toLowerCase())) {
        setAllTags((prev) => [...prev, tag.trim().toLowerCase()].sort());
      }
    }
  };

  const handleRemoveTag = async (scanId: number, tag: string) => {
    const res = await fetch(API.SCAN_TAGS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, tag, action: "remove" }),
    });
    if (res.ok) {
      const data = await res.json();
      setScans((prev) =>
        prev.map((s) => (s.id === scanId ? { ...s, tags: data.tags } : s)),
      );
    }
  };

  const handleFindingsUpdated = useCallback((findings: Vulnerability[]) => {
    setScanDetail((prev) => (prev ? { ...prev, findings } : prev));
  }, []);

  const handleSaveNotes = async (notes: string) => {
    if (!selectedScanId) return;
    const res = await fetch(`${API.HISTORY}/${selectedScanId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    if (res.ok) setScanNotes(notes);
  };

  // Filtering & pagination
  const filtered = scans.filter((s) => {
    const matchesUrl =
      !filter.trim() || s.url.toLowerCase().includes(filter.toLowerCase());
    const matchesTag = !tagFilter || (s.tags && s.tags.includes(tagFilter));
    return matchesUrl && matchesTag;
  });

  // Skip the very first run: it fires on mount too, and resetting there
  // would immediately wipe out a deep-linked ?page=N before it ever renders.
  const isFirstFilterRun = useRef(true);
  useEffect(() => {
    if (isFirstFilterRun.current) {
      isFirstFilterRun.current = false;
      return;
    }
    handlePageChange(1);
  }, [filter, tagFilter, handlePageChange]);

  const { totalPages, getPage } = usePagination(filtered, pageSize);
  const paginatedScans = getPage(currentPage);

  if (loading) {
    return <HistorySkeleton />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-5">
        {selectedScanId !== null ? (
          /* Detail View */
          <>
            {detailLoading && (
              <div className="flex flex-col items-center gap-3 py-16">
                <Loader2
                  aria-hidden
                  className="h-5 w-5 animate-spin text-primary"
                />
                <p className="text-sm text-muted-foreground">Loading scan</p>
              </div>
            )}

            {!detailLoading && scanDetail && (
              <div className="flex flex-col gap-4">
                {selectedIssue ? (
                  <IssueDetail
                    issue={selectedIssue}
                    onBack={() => setSelectedIssue(null)}
                  />
                ) : (
                  <>
                    <HistoryDetailHeader
                      scanDetail={scanDetail}
                      scanId={selectedScanId}
                      isOwner={scanOwnerId === currentUserId}
                      onBack={handleBackToList}
                      onDeleted={() => {
                        setSelectedScanId(null);
                        setScanDetail(null);
                        fetchHistory();
                      }}
                      onVerified={handleFindingsUpdated}
                    />

                    <ScanSummary result={scanDetail} hideHeader />

                    {crawlInfo && crawlInfo.pages.length > 1 && (
                      <CrawlPagesInfo
                        crawlInfo={crawlInfo}
                        onSelectIssue={setSelectedIssue}
                      />
                    )}

                    <div className="flex flex-col gap-3 border-t border-border/50 pt-5">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        More about this host
                      </h2>
                      {scanDetail.responseHeaders &&
                        Object.keys(scanDetail.responseHeaders).length > 0 && (
                          <ResponseHeaders
                            headers={scanDetail.responseHeaders}
                          />
                        )}
                      <SubdomainDiscovery url={scanDetail.url} />
                      <HistoryNotes
                        notes={scanNotes}
                        isOwner={scanOwnerId === currentUserId}
                        onSave={handleSaveNotes}
                      />
                    </div>

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
                        <p className="mt-1 text-xs text-muted-foreground">
                          Every enabled check ran and none of them fired.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {!detailLoading && !scanDetail && (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <p className="text-sm text-muted-foreground">
                  This scan could not be loaded. It may have been deleted or
                  fallen outside your retention window.
                </p>
                <Button
                  variant="outline"
                  onClick={handleBackToList}
                  className="bg-transparent"
                >
                  Back to history
                </Button>
              </div>
            )}
          </>
        ) : (
          /* List View */
          <>
            <div aria-label="Scan history" className="mb-1 pb-2 pt-6 sm:pt-8">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                History
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {scans.length} {scans.length === 1 ? "scan" : "scans"} on
                record, kept for{" "}
                {retentionDays === -1
                  ? "as long as your account exists"
                  : `${retentionDays} days`}
              </p>
            </div>

            <HistoryStats scans={scans} />

            {scans.length > 0 && (
              <HistoryFilters
                filter={filter}
                onFilterChange={setFilter}
                tagFilter={tagFilter}
                onTagFilterChange={setTagFilter}
                allTags={allTags}
                onClearHistory={() => setShowClearConfirm(true)}
                clearing={clearing}
              />
            )}

            <HistoryEmptyState
              hasScans={scans.length > 0}
              hasFilters={Boolean(filter || tagFilter)}
              onClearFilters={() => {
                setFilter("");
                setTagFilter(null);
              }}
            />

            {paginatedScans.length > 0 && (
              <HistoryScanList
                scans={paginatedScans}
                onViewScan={handleViewScan}
                onRescan={handleRescan}
                onAddTag={handleAddTag}
                onRemoveTag={handleRemoveTag}
                rescanningScanId={rescanning}
              />
            )}

            {filtered.length > 0 && (
              <PaginationControl
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                pageSize={pageSize}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  handlePageChange(1);
                }}
                totalItems={filtered.length}
              />
            )}
          </>
        )}
      </main>

      <AlertDialog
        open={showClearConfirm}
        onOpenChange={(open) => {
          if (!open && !clearing) setShowClearConfirm(false);
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle
                className="h-5 w-5 text-destructive shrink-0"
                aria-hidden="true"
              />
              Clear all scan history?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              This deletes all{" "}
              <span className="font-medium text-foreground">
                {scans.length}
              </span>{" "}
              {scans.length === 1 ? "scan" : "scans"} on this account, findings
              and notes included. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setShowClearConfirm(false)}
              disabled={clearing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearHistory}
              disabled={clearing}
              className="gap-2"
            >
              {clearing && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Clear history
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Footer />
    </div>
  );
}
