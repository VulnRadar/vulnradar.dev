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
import { IssueDetail } from "@/components/scanner/issue-detail";
import { ScanResultDetail } from "@/components/scanner/scan-result-detail";
import { SubdomainDiscovery } from "@/components/scanner/subdomain-discovery";
import {
  PaginationControl,
  usePagination,
} from "@/components/ui/pagination-control";
import { API, BILLING_HISTORY_RETENTION } from "@/lib/config/constants";
import {
  getQueryParam,
  getQueryParamInt,
  QUERY_CHANGE_EVENT,
  removeQueryParam,
  setQueryParam,
} from "@/lib/ui/url-state";
import { useAuth } from "@/components/providers/auth-provider";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import type { FindingRemediation } from "@/lib/scanner/remediation";
import { mapHistoryDetailResponse } from "@/lib/scanner/history-detail";

import {
  type ScanRecord,
  type ScanTag,
  HistoryStats,
  HistoryFilters,
  HistoryScanList,
  HistoryEmptyState,
  HistoryDetailHeader,
  HistoryNotes,
  HistoryTagsCard,
  HistoryViewTabs,
} from "@/components/history";
import { HistorySkeleton } from "@/components/history/history-skeleton";
import { HistoryDetailSkeleton } from "@/components/history/history-detail-skeleton";

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
  const [rescanning, setRescanning] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  // Detail state. selectedScanId is the opaque public_id used for routing and
  // the history/scan routes; scanNumericId is the internal numeric id the
  // out-of-band feedback route still needs (see IssueDetail below).
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [scanNumericId, setScanNumericId] = useState<number | null>(null);
  const [scanDetail, setScanDetail] = useState<ScanResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(
    null,
  );
  const [scanOwnerId, setScanOwnerId] = useState<number | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [scanNotes, setScanNotes] = useState("");
  const [scanIsPublic, setScanIsPublic] = useState(true);
  const [scanDetailTags, setScanDetailTags] = useState<ScanTag[]>([]);
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
    (id: string | null, replace = false) => {
      setQueryParam("scan", id, { replace });
    },
    [],
  );

  // page=1 is the implicit default, so it's left out of the URL entirely
  // rather than ever showing up as ?page=1.
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    setQueryParam("page", page > 1 ? String(page) : null, { replace: true });
  }, []);

  const loadScanDetail = useCallback(async (scanId: string) => {
    setDetailLoading(true);
    setCrawlInfo(null);
    try {
      const res = await fetch(`${API.HISTORY}/${scanId}`);
      if (!res.ok) {
        setSelectedScanId(null);
        return;
      }
      const data = await res.json();
      setScanDetail(mapHistoryDetailResponse(data));
      // Internal numeric id for the feedback route (keyed on the numeric PK).
      setScanNumericId(typeof data.id === "number" ? data.id : null);
      if (data.crawl && data.crawl.pages?.length > 0) {
        setCrawlInfo(data.crawl);
      }
      setScanOwnerId(data.userId || null);
      setScanNotes(data.notes || "");
      setScanIsPublic(data.isPublic !== false);
      setScanDetailTags(Array.isArray(data.tags) ? data.tags : []);
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
  const prevScanIdRef = useRef<string | null | undefined>(undefined);

  const handleQueryChange = useCallback(() => {
    const id = getQueryParam("scan");
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the current URL query params (external to React) to seed selected-scan state, then subscribes below for future changes
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: fetchHistory's setState calls only fire after its async request resolves, not synchronously in this effect
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
    setClearing(true);
    setClearError(null);
    try {
      const res = await fetch(API.HISTORY, { method: "DELETE" });
      if (res.ok) {
        setScans([]);
        setShowClearConfirm(false);
      } else {
        setClearError("Couldn't clear history. Try again.");
      }
    } catch {
      setClearError("Couldn't clear history. Try again.");
    }
    setClearing(false);
  };

  // Shared by both the history list rows and the open scan's detail header:
  // updates whichever of the two is currently showing this scanId, since a
  // tag can be added/removed from either place.
  const applyUpdatedTags = (scanId: string | number, tags: ScanTag[]) => {
    setScans((prev) => prev.map((s) => (s.id === scanId ? { ...s, tags } : s)));
    if (scanId === selectedScanId) setScanDetailTags(tags);
  };

  const handleAddTag = async (scanId: string | number, tag: string) => {
    if (!tag.trim()) return;
    const res = await fetch(API.SCAN_TAGS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, tag: tag.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      applyUpdatedTags(scanId, data.tags);
      if (!allTags.includes(tag.trim().toLowerCase())) {
        setAllTags((prev) => [...prev, tag.trim().toLowerCase()].sort());
      }
    }
  };

  const handleRemoveTag = async (scanId: string | number, tag: string) => {
    const res = await fetch(API.SCAN_TAGS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, tag, action: "remove" }),
    });
    if (res.ok) {
      const data = await res.json();
      applyUpdatedTags(scanId, data.tags);
    }
  };

  const handleFindingsUpdated = useCallback((findings: Vulnerability[]) => {
    setScanDetail((prev) => (prev ? { ...prev, findings } : prev));
  }, []);

  // Marking a finding false_positive already recalculates and persists
  // summary/dangerScore server-side (lib/scanner/recompute-scan-score.ts),
  // excluding that finding -- this just picks the corrected numbers back
  // up for the view that's already open, silently (no detailLoading toggle,
  // so no skeleton flash mid-review).
  const handleVerdictChanged = useCallback(async () => {
    if (!selectedScanId) return;
    try {
      const res = await fetch(`${API.HISTORY}/${selectedScanId}`);
      if (!res.ok) return;
      const data = await res.json();
      const mapped = mapHistoryDetailResponse(data);
      setScanDetail((prev) =>
        prev
          ? {
              ...prev,
              dangerScore: mapped.dangerScore,
              summary: mapped.summary,
            }
          : prev,
      );
    } catch {
      // Best-effort: the score is correct server-side either way and will
      // show up next time this scan is reopened.
    }
  }, [selectedScanId]);

  const handleSummaryGenerated = useCallback((aiSummary: string) => {
    setScanDetail((prev) => (prev ? { ...prev, aiSummary } : prev));
  }, []);

  // Owner changed a finding's remediation status in the detail view: patch
  // that finding in place so the list badge reflects it without a refetch.
  // `null` clears the status back to open (drops the remediation field).
  const handleRemediationChanged = useCallback(
    (findingId: string, remediation: FindingRemediation | null) => {
      setScanDetail((prev) =>
        prev
          ? {
              ...prev,
              findings: prev.findings.map((f) =>
                f.id === findingId
                  ? { ...f, remediation: remediation ?? undefined }
                  : f,
              ),
            }
          : prev,
      );
    },
    [],
  );

  const handleSaveNotes = async (notes: string) => {
    if (!selectedScanId) return;
    const res = await fetch(`${API.HISTORY}/${selectedScanId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    if (res.ok) setScanNotes(notes);
  };

  const handlePrivacyChanged = useCallback((isPublic: boolean) => {
    setScanIsPublic(isPublic);
  }, []);

  // Filtering & pagination
  const filtered = scans.filter((s) => {
    const matchesUrl =
      !filter.trim() || s.url.toLowerCase().includes(filter.toLowerCase());
    const matchesTag =
      !tagFilter || (s.tags?.some((t) => t.tag === tagFilter) ?? false);
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
        <HistoryViewTabs />

        {selectedScanId !== null ? (
          /* Detail View */
          <>
            {detailLoading && <HistoryDetailSkeleton />}

            {!detailLoading && scanDetail && (
              <div className="flex flex-col gap-4">
                {selectedIssue ? (
                  <IssueDetail
                    issue={selectedIssue}
                    onBack={() => setSelectedIssue(null)}
                    findingUrl={
                      scanOwnerId === currentUserId ? scanDetail.url : undefined
                    }
                    scanHistoryId={scanNumericId}
                    onVerdictChanged={handleVerdictChanged}
                    onRemediationChanged={handleRemediationChanged}
                  />
                ) : (
                  <>
                    <HistoryDetailHeader
                      scanDetail={scanDetail}
                      scanId={selectedScanId}
                      isOwner={scanOwnerId === currentUserId}
                      isPublic={scanIsPublic}
                      onBack={handleBackToList}
                      onDeleted={() => {
                        setSelectedScanId(null);
                        setScanDetail(null);
                        fetchHistory();
                      }}
                      onVerified={handleFindingsUpdated}
                      onSummaryGenerated={handleSummaryGenerated}
                      onPrivacyChanged={handlePrivacyChanged}
                    />

                    <ScanResultDetail
                      result={scanDetail}
                      onSelectIssue={setSelectedIssue}
                      crawlInfo={crawlInfo}
                      screenshotSrc={
                        scanDetail.screenshot && scanNumericId
                          ? API.SCAN_SCREENSHOT(selectedScanId)
                          : undefined
                      }
                      screenshotRefreshScanId={
                        scanOwnerId === currentUserId
                          ? selectedScanId
                          : undefined
                      }
                      onScreenshotRefreshed={(screenshot) =>
                        setScanDetail((prev) =>
                          prev ? { ...prev, screenshot } : prev,
                        )
                      }
                      refreshScanId={
                        scanOwnerId === currentUserId
                          ? selectedScanId
                          : undefined
                      }
                      onDnsRefreshed={(dnsRecords) =>
                        setScanDetail((prev) =>
                          prev ? { ...prev, dnsRecords } : prev,
                        )
                      }
                      onPortRefreshed={(portScan) =>
                        setScanDetail((prev) =>
                          prev ? { ...prev, portScan } : prev,
                        )
                      }
                      subdomain={
                        <SubdomainDiscovery
                          url={scanDetail.url}
                          initialResult={scanDetail.subdomains ?? null}
                        />
                      }
                      panelFooter={
                        <>
                          <HistoryTagsCard
                            scanId={selectedScanId}
                            tags={scanDetailTags}
                            onAdd={handleAddTag}
                            onRemove={handleRemoveTag}
                            readOnly={scanOwnerId !== currentUserId}
                          />
                          <HistoryNotes
                            notes={scanNotes}
                            isOwner={scanOwnerId === currentUserId}
                            onSave={handleSaveNotes}
                          />
                        </>
                      }
                    />
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
              hasResults={filtered.length > 0}
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
          if (!open && !clearing) {
            setShowClearConfirm(false);
            setClearError(null);
          }
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
          {clearError && (
            <p className="text-sm text-destructive">{clearError}</p>
          )}
          <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowClearConfirm(false);
                setClearError(null);
              }}
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
