"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useIsomorphicLayoutEffect } from "@/lib/ui/use-isomorphic-layout-effect";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { useToast } from "@/components/ui/use-toast";
import { IssueDetail } from "@/components/scanner/issue-detail";
import { ScanResultDetail } from "@/components/scanner/scan-result-detail";
import { SubdomainDiscovery } from "@/components/scanner/subdomain-discovery";
import {
  PaginationControl,
  usePagination,
} from "@/components/ui/pagination-control";
import { API, BILLING_HISTORY_RETENTION } from "@/lib/config/client-constants";
import { pluralize } from "@/lib/ui/plural";
import {
  getQueryParam,
  getQueryParamInt,
  QUERY_CHANGE_EVENT,
  LOCATION_CHANGE_EVENT,
  removeQueryParam,
  setQueryParam,
  useQuerySeededState,
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
  HistoryDataSkeleton,
  getDomain,
} from "@/components/history";
import {
  DEFAULT_HISTORY_QUERY,
  activeFilterCount,
  filterHistory,
  type HistoryQuery,
} from "@/components/history/history-filter-utils";
import { HistoryDetailSkeleton } from "@/components/history/history-detail-skeleton";
import {
  createScanParamTracker,
  type ScanParamTracker,
} from "@/components/history/scan-param-sync";

/** Same key results-list.tsx / issue-detail.tsx read and write. */
const FINDING_QUERY_PARAM = "finding";

import type { CrawlInfo } from "@/components/scanner/crawl-pages-info";
import { InlineAlert } from "@/components/shared/inline-alert";

export default function HistoryPage() {
  const router = useRouter();
  const { me, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  // List state
  const [scans, setScans] = useState<ScanRecord[]>([]);
  // The list endpoint caps rows at HISTORY_LIST_MAX_ROWS, so scans.length is a
  // page size. totalScans is the real account total and is what every
  // user-facing count must use, above all the delete-everything confirmation.
  const [totalScans, setTotalScans] = useState(0);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [query, setQuery] = useState<HistoryQuery>(DEFAULT_HISTORY_QUERY);
  const updateQuery = useCallback(
    (patch: Partial<HistoryQuery>) =>
      setQuery((prev) => ({ ...prev, ...patch })),
    [],
  );
  const [allTags, setAllTags] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useQuerySeededState(
    () => getQueryParamInt("page") ?? 1,
    1,
  );
  const [pageSize, setPageSize] = useState(10);
  const [rescanning, setRescanning] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  // Clearing history is the one action in the product that can cost a user
  // everything they have, and there is no soft-delete behind it yet, so the
  // confirmation asks for the word rather than a second click. Same shape as
  // the account-deletion guard on the profile Privacy tab.
  const [clearConfirmText, setClearConfirmText] = useState("");
  // "The list failed to load" and "you have no scans" are completely
  // different facts and used to render as the same empty state, so a 500
  // told a user with 200 scans that they had none. That reads as data loss.
  const [listError, setListError] = useState<string | null>(null);

  // Detail state. selectedScanId is the opaque public_id used for routing and
  // the history/scan routes; scanNumericId is the internal numeric id the
  // out-of-band feedback route still needs (see IssueDetail below).
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [scanNumericId, setScanNumericId] = useState<number | null>(null);
  const [scanDetail, setScanDetail] = useState<ScanResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(
    null,
  );
  const [scanOwnerId, setScanOwnerId] = useState<number | null>(null);
  const [scanNotes, setScanNotes] = useState("");
  const [scanIsPublic, setScanIsPublic] = useState(true);
  const [scanDetailTags, setScanDetailTags] = useState<ScanTag[]>([]);
  const [crawlInfo, setCrawlInfo] = useState<CrawlInfo | null>(null);

  // Retention info. The plan is only known once /auth/me lands, and this page
  // is fetched independently of it, so `me?.plan || "free"` renders the FREE
  // retention window as fact for a paying account until the two races settle
  // (and forever if that fetch fails). On a line whose whole subject is how
  // long we keep the reader's data, the free number is the worst one to guess:
  // retentionKnown gates the claim rather than the fallback silently standing
  // in for it.
  const isStaff =
    me?.role && ["admin", "moderator", "support"].includes(me.role);
  const retentionKnown = !authLoading && (isStaff || me?.plan !== undefined);
  // Read off the shared /auth/me that AuthProvider already caches, rather than
  // this page issuing its own second copy of that exact request. Two things
  // were wrong with the copy: it was a duplicate round trip, and it settled
  // independently of the scan detail beside it, so on a /history?scan=X deep
  // link the report rendered first and the owner's controls (rename, delete,
  // re-scan, the remediation buttons) appeared afterwards, on their own.
  const currentUserId = me?.userId ?? null;
  // The detail region is fed by two requests: this scan, and who is asking.
  // isOwner decides which half of that panel exists at all, so revealing the
  // report before the identity is known means drawing it twice. Both are in
  // flight together; only the swap is held. authLoading is false the moment
  // /auth/me settles either way, failure included, so a dead auth endpoint
  // degrades to "not the owner" rather than to a permanent skeleton.
  const detailPending = detailLoading || authLoading;
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
  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page);
      setQueryParam("page", page > 1 ? String(page) : null, { replace: true });
    },
    [setCurrentPage],
  );

  // Guards against a last-response-wins race: rapid ?scan= switches (back/
  // forward, fast row clicks) fire overlapping loads, and an older response
  // landing last would render the wrong scan under the selected id. Each call
  // takes a ticket; only the latest applies its result.
  const scanDetailReqRef = useRef(0);
  // Which scan the URL is on and which one is loaded. handleQueryChange below
  // compares the two instead of reloading on every URL change, so a findings
  // filter or an opened finding cannot blank a loaded report behind the
  // skeleton. It also means a row click (which loads, then pushes ?scan=,
  // which fires two events) issues one request instead of three.
  const scanParamRef = useRef<ScanParamTracker | null>(null);
  scanParamRef.current ??= createScanParamTracker();
  const scanParam = scanParamRef.current;
  const loadScanDetail = useCallback(
    async (scanId: string) => {
      const reqId = ++scanDetailReqRef.current;
      const isStale = () => reqId !== scanDetailReqRef.current;
      scanParam.claim(scanId);
      setDetailLoading(true);
      setCrawlInfo(null);
      // Clear the previous scan's data up front, otherwise a failed switch from
      // scan A to scan B leaves A's findings in state under B's id.
      setScanDetail(null);
      setDetailError(null);
      try {
        const res = await fetch(`${API.HISTORY}/${scanId}`);
        if (isStale()) return;
        if (!res.ok) {
          // Keep selectedScanId set. Nulling it here bounced the user straight
          // back to the list with no message at all, leaving ?scan=<id> in the
          // address bar and making the designed error state below unreachable
          // on every failure path: a dead deep link, a deleted scan and a 500
          // all looked like the click had simply been ignored.
          setDetailError(
            res.status === 404
              ? "This scan could not be found. It may have been deleted, or fallen outside your retention window."
              : "This scan could not be loaded. The server returned an error.",
          );
          return;
        }
        const data = await res.json();
        if (isStale()) return;
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
        if (!isStale()) {
          setDetailError("Couldn't reach the server to load this scan.");
        }
      } finally {
        if (!isStale()) setDetailLoading(false);
      }
    },
    [scanParam],
  );

  // Runs on mount and then on every URL change, including LOCATION_CHANGE_EVENT,
  // which fires for ANY history write the app makes and not only for ?scan=.
  // What a given URL change means for the open scan is decided in
  // components/history/scan-param-sync.ts, where it is testable; see its
  // docblock for what reloading unconditionally here used to cost.
  const handleQueryChange = useCallback(() => {
    const id = getQueryParam("scan");
    const { load, clearFinding } = scanParam.next(id);

    // Ordered before the ?finding= write below on purpose: that write re-enters
    // this handler synchronously through the location bridge, and starting the
    // load first means the re-entrant pass sees the scan already claimed and
    // does not fire a duplicate request for it.
    if (id !== null) {
      setSelectedScanId(id);
      if (load) loadScanDetail(id);
    } else {
      setSelectedScanId(null);
      setScanDetail(null);
      scanParam.claim(null);
    }

    if (clearFinding) {
      setSelectedIssue(null);
      // Only write when there is actually a param to remove: an unconditional
      // removeQueryParam still calls replaceState, and so still re-enters this
      // handler, for a URL that would not change.
      if (getQueryParam(FINDING_QUERY_PARAM) !== null) {
        removeQueryParam(FINDING_QUERY_PARAM, { replace: true });
      }
    }
  }, [loadScanDetail, scanParam]);

  // Seeded before paint, subscribed after. `selectedScanId` starts null, so
  // the first render is always the list branch; landing on /history?scan=X
  // used to paint the list skeleton, then swap to the scan-detail skeleton
  // once a post-paint effect had read the param. Two different loading states
  // for one navigation. A layout effect corrects the branch after the DOM is
  // built and before the browser paints, so only the right one is ever shown,
  // and the first render still matches the server HTML so hydration is clean.
  useIsomorphicLayoutEffect(() => {
    handleQueryChange();
  }, [handleQueryChange]);

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (detail.key === "scan") handleQueryChange();
    };
    window.addEventListener(QUERY_CHANGE_EVENT, onChange);
    // A soft <Link> to /history while viewing /history?scan=X clears the param
    // without firing popstate or our event; re-read on any location change so
    // the detail view collapses back to the list.
    window.addEventListener(LOCATION_CHANGE_EVENT, handleQueryChange);
    window.addEventListener("popstate", handleQueryChange);
    return () => {
      window.removeEventListener(QUERY_CHANGE_EVENT, onChange);
      window.removeEventListener(LOCATION_CHANGE_EVENT, handleQueryChange);
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
    window.addEventListener(LOCATION_CHANGE_EVENT, syncPageFromUrl);
    window.addEventListener("popstate", syncPageFromUrl);
    return () => {
      window.removeEventListener(QUERY_CHANGE_EVENT, onChange);
      window.removeEventListener(LOCATION_CHANGE_EVENT, syncPageFromUrl);
      window.removeEventListener("popstate", syncPageFromUrl);
    };
  }, [setCurrentPage]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(API.HISTORY);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          router.push("/login");
          return;
        }
        setListError("Couldn't load your history.");
        return;
      }
      const data = await res.json();
      const rows = Array.isArray(data.scans) ? data.scans : [];
      setListError(null);
      setScans(rows);
      setTotalScans(typeof data.total === "number" ? data.total : rows.length);
    } catch {
      setListError("Couldn't reach the server to load your history.");
    }
  }, [router]);

  // A failure here is silent on purpose: the tag filter is one control in a
  // row of four and its absence says everything it needs to.
  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(API.SCAN_TAGS);
      if (!res.ok) return;
      const data = await res.json();
      setAllTags(Array.isArray(data.tags) ? data.tags : []);
    } catch {
      /* the tag dropdown simply does not appear */
    }
  }, []);

  /**
   * The list region has two feeders, and it used to reveal on the first of
   * them. The tag dropdown only exists once the account has tags
   * (HistoryFilters renders it behind `allTags.length > 0`), so the filter row
   * arrived with three controls and grew a fourth a moment later, moving the
   * whole table sideways and down. Both requests still go out together; only
   * the reveal waits for both.
   *
   * allSettled, not all: a dead /scan-tags must not leave this page in its
   * skeleton forever, and neither of these two rejects for an HTTP error
   * anyway, so `all` would only differ on a network fault, which is exactly
   * the case that must not hang.
   */
  const loadList = useCallback(async () => {
    await Promise.allSettled([fetchHistory(), fetchTags()]);
    setLoading(false);
  }, [fetchHistory, fetchTags]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: loadList's setState calls only fire after its async requests settle, not synchronously in this effect
    loadList();
  }, [loadList]);

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

  // POST /api/v3/scan queues a background job and returns immediately, so the
  // refetch that used to follow it fired milliseconds after the job started
  // and could never contain the finished scan: the list came back identical
  // and nothing said a scan had begun, been refused, or been rate-limited.
  // A rate limit and a success looked the same, and the rational response to
  // that is to click again and burn another scan off the daily cap. Say what
  // happened instead.
  const handleRescan = async (scan: ScanRecord) => {
    if (rescanning) return;
    setRescanning(scan.id);
    try {
      const res = await fetch(API.SCAN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scan.url }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: "Rescan started",
          description: `${getDomain(scan.url)} is scanning now. It will appear at the top of this list when it finishes, in a minute or so.`,
        });
        await fetchHistory();
      } else {
        toast({
          variant: "destructive",
          title: "Rescan not started",
          description:
            data.error ||
            (res.status === 429
              ? "You have hit your scan limit for today."
              : "The scanner refused the request."),
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Rescan not started",
        description: "Couldn't reach the scanner. Check your connection.",
      });
    } finally {
      setRescanning(null);
    }
  };

  const handleClearHistory = async () => {
    // Belt and braces: the confirm button is already disabled until the word
    // is typed, but the handler should not depend on that being true.
    if (clearConfirmText.trim().toUpperCase() !== "DELETE") return;
    setClearing(true);
    setClearError(null);
    try {
      const res = await fetch(API.HISTORY, { method: "DELETE" });
      if (res.ok) {
        setScans([]);
        // totalScans drove the "N scans on record" line and the confirmation
        // copy, and was left at its old value after a successful clear, so the
        // page still claimed 143 scans over an empty list.
        setTotalScans(0);
        setShowClearConfirm(false);
        setClearConfirmText("");
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

  // Both return null on success and the message to show on failure. Neither
  // had a !res.ok branch or a catch, so a rejected or dropped tag write was
  // completely invisible: the chip row just stayed as it was.
  const handleAddTag = async (
    scanId: string | number,
    tag: string,
  ): Promise<string | null> => {
    if (!tag.trim()) return null;
    try {
      const res = await fetch(API.SCAN_TAGS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId, tag: tag.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return data.error || "Couldn't add that tag.";
      }
      const data = await res.json();
      applyUpdatedTags(scanId, data.tags);
      if (!allTags.includes(tag.trim().toLowerCase())) {
        setAllTags((prev) => [...prev, tag.trim().toLowerCase()].sort());
      }
      return null;
    } catch {
      return "Couldn't reach the server to add that tag.";
    }
  };

  const handleRemoveTag = async (
    scanId: string | number,
    tag: string,
  ): Promise<string | null> => {
    try {
      const res = await fetch(API.SCAN_TAGS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId, tag, action: "remove" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return data.error || "Couldn't remove that tag.";
      }
      const data = await res.json();
      applyUpdatedTags(scanId, data.tags);
      return null;
    } catch {
      return "Couldn't reach the server to remove that tag.";
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

  // Returns null on success, the message to show on failure. There was no
  // !res.ok branch and no catch at all here, so a rejected PATCH was an
  // unhandled promise rejection and the editor closed as if it had worked.
  const handleSaveNotes = async (notes: string): Promise<string | null> => {
    if (!selectedScanId) return "This scan is no longer open.";
    try {
      const res = await fetch(`${API.HISTORY}/${selectedScanId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (res.ok) {
        setScanNotes(notes);
        return null;
      }
      const data = await res.json().catch(() => ({}));
      return data.error || "Couldn't save these notes.";
    } catch {
      return "Couldn't reach the server to save these notes.";
    }
  };

  const handlePrivacyChanged = useCallback((isPublic: boolean) => {
    setScanIsPublic(isPublic);
  }, []);

  // Filtering, ordering & pagination. The predicate and the comparator live
  // in history-filter-utils.ts as plain .ts so they are unit-testable.
  const filtered = filterHistory(scans, query);
  const hasFilters = activeFilterCount(query) > 0;

  // Skip the very first run: it fires on mount too, and resetting there
  // would immediately wipe out a deep-linked ?page=N before it ever renders.
  const isFirstFilterRun = useRef(true);
  useEffect(() => {
    if (isFirstFilterRun.current) {
      isFirstFilterRun.current = false;
      return;
    }
    handlePageChange(1);
  }, [query, handlePageChange]);

  const { totalPages, getPage } = usePagination(filtered, pageSize);
  // Clamp to the current page count. When the list shrinks below currentPage
  // (e.g. deleting the only item on the last page), getPage already clamps its
  // slice but the range label was computed from the raw currentPage, rendering
  // an impossible "21-20 of 20". Use one clamped value everywhere so slice,
  // label, and active-page button all agree.
  const effectivePage = Math.min(currentPage, Math.max(1, totalPages));
  const paginatedScans = getPage(effectivePage);

  return (
    <AppPageShell className="flex flex-col gap-5">
      {selectedScanId !== null ? (
        /* Detail View */
        <>
          {/* The detail view has no page h1 for the strip to sit under, so
              here it stays at the top where it was. */}
          <HistoryViewTabs />
          {detailPending && <HistoryDetailSkeleton />}

          {!detailPending && scanDetail && (
            <div className="flex flex-col gap-4">
              {/* Owner-only affordances. currentUserId must be a real
                    identity: null === null would otherwise mark a signed-out
                    viewer (or a transient /me fetch failure) as the "owner" of
                    an ownerless public scan and expose edit/refresh controls.
                    The API re-checks ownership regardless, so this only gates
                    the UI. */}
              {(() => {
                const isOwner =
                  currentUserId != null && scanOwnerId === currentUserId;
                return (
                  <>
                    {selectedIssue ? (
                      <IssueDetail
                        issue={selectedIssue}
                        onBack={() => setSelectedIssue(null)}
                        findingUrl={isOwner ? scanDetail.url : undefined}
                        scanHistoryId={scanNumericId}
                        onVerdictChanged={handleVerdictChanged}
                        onRemediationChanged={handleRemediationChanged}
                      />
                    ) : (
                      <>
                        <HistoryDetailHeader
                          scanDetail={scanDetail}
                          scanId={selectedScanId}
                          isOwner={isOwner}
                          isPublic={scanIsPublic}
                          onBack={handleBackToList}
                          onDeleted={() => {
                            setSelectedScanId(null);
                            setScanDetail(null);
                            // Clear ?scan= too (same as handleBackToList). Without
                            // this the deleted id lingers in the URL and browser
                            // Back re-loads it into a 404 skeleton bounce.
                            updateUrlWithScan(null);
                            fetchHistory();
                          }}
                          onVerified={handleFindingsUpdated}
                          onSummaryGenerated={handleSummaryGenerated}
                          onPrivacyChanged={handlePrivacyChanged}
                        />

                        <ScanResultDetail
                          result={scanDetail}
                          onSelectIssue={setSelectedIssue}
                          canRemediate={isOwner}
                          crawlInfo={crawlInfo}
                          screenshotSrc={
                            scanDetail.screenshot && scanNumericId
                              ? API.SCAN_SCREENSHOT(selectedScanId)
                              : undefined
                          }
                          screenshotRefreshScanId={
                            isOwner ? selectedScanId : undefined
                          }
                          onScreenshotRefreshed={(screenshot) =>
                            setScanDetail((prev) =>
                              prev ? { ...prev, screenshot } : prev,
                            )
                          }
                          refreshScanId={isOwner ? selectedScanId : undefined}
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
                                readOnly={!isOwner}
                              />
                              <HistoryNotes
                                notes={scanNotes}
                                isOwner={isOwner}
                                onSave={handleSaveNotes}
                              />
                            </>
                          }
                        />
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {!detailPending && !scanDetail && (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {detailError ??
                  "This scan could not be loaded. It may have been deleted or fallen outside your retention window."}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {/* A 404 will not resolve on a retry, so only the server
                      errors and the network case offer one. */}
                {detailError &&
                  !detailError.startsWith("This scan could not be found") && (
                    <Button
                      variant="outline"
                      onClick={() => loadScanDetail(selectedScanId)}
                      className="bg-transparent"
                    >
                      Retry
                    </Button>
                  )}
                <Button
                  variant="outline"
                  onClick={handleBackToList}
                  className="bg-transparent"
                >
                  Back to history
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* List View */
        <>
          {/* Clear All has moved twice. It began as an icon button in the
                filter row, beside the search input a user touches constantly,
                which put deleting every scan on the account two clicks from
                the middle of the workflow. It was then exiled to a labelled
                danger section below the list, which buried it: with 50 scans
                and pagination in between, the only control for "get rid of
                all this" was off the bottom of the page. It sits in the page
                header now, where a page-level action belongs, and the
                type-DELETE confirmation added with the danger section is what
                keeps it from being a one-click mistake. */}
          <div className="mb-1 flex flex-col gap-3 pb-2 pt-6 sm:flex-row sm:items-start sm:justify-between sm:pt-8">
            <div aria-label="Scan history">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                History
              </h1>
              {/* The subtitle is three counts about the account, and every
                    one of them is 0 until the fetch lands. Rendering it early
                    would open the page by telling someone with 200 scans that
                    they have none, which is the same lie the listError panel
                    below exists to avoid. */}
              {loading ? (
                <Skeleton className="mt-1 h-5 w-64 max-w-full" />
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  {totalScans} {totalScans === 1 ? "scan" : "scans"} on record
                  {scans.length < totalScans
                    ? `, showing the ${scans.length} most recent`
                    : ""}
                  {retentionKnown
                    ? retentionDays === -1
                      ? ", kept for as long as your account exists"
                      : `, kept for ${pluralize(retentionDays, "day")}`
                    : ""}
                </p>
              )}
            </div>

            {/* Reserved while loading rather than left out: below sm this
                  button is a second row, so its arrival would move the stats,
                  the filters and the list down with it. */}
            {loading ? (
              <Skeleton className="h-9 w-40 shrink-0 self-start" />
            ) : (
              scans.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setClearConfirmText("");
                    setClearError(null);
                    setShowClearConfirm(true);
                  }}
                  disabled={clearing}
                  className="shrink-0 self-start border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 aria-hidden className="mr-2 h-4 w-4" />
                  {clearing ? "Clearing..." : "Clear all history"}
                </Button>
              )
            )}
          </div>

          {/* Under the title, matching /assets, /attack-surface and
              /public-scans. The strip used to render above the h1 here, so
              the same four-tab control sat at two different heights
              depending on which tab you were on, and put nav chrome ahead of
              the thing that names the page. It needs no data, so it is on
              the first frame either way. */}
          <HistoryViewTabs />

          {/* A failed load is never the empty state. With no rows to show,
                this replaces the list outright and says the scans are still
                there; with rows already on screen (a refetch that failed) it
                sits above them as a staleness warning instead. */}
          {loading ? (
            <HistoryDataSkeleton />
          ) : listError && scans.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-destructive/30 bg-destructive/5 px-4 py-14 text-center">
              <AlertTriangle
                className="h-6 w-6 text-destructive/70"
                aria-hidden="true"
              />
              <p className="text-sm font-semibold text-foreground">
                {listError}
              </p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Your scans have not been deleted. This is a problem reading
                them, not a change to them.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="bg-transparent"
                onClick={() => {
                  setLoading(true);
                  loadList();
                }}
              >
                Retry
              </Button>
            </div>
          ) : (
            <>
              {listError && (
                <InlineAlert tone="error">
                  {listError} These rows are from the last successful load and
                  may be out of date.
                </InlineAlert>
              )}

              <HistoryStats scans={scans} capped={scans.length < totalScans} />

              {scans.length > 0 && (
                <HistoryFilters
                  query={query}
                  onChange={updateQuery}
                  allTags={allTags}
                />
              )}

              {/* Search and tag filtering run over the rows this page loaded,
                which the API caps at HISTORY_LIST_MAX_ROWS. Saying so is the
                difference between "no match" and "no match in the part we
                looked at": without it a scan that is still inside retention
                simply appears not to exist. Server-side search is the real
                fix and is tracked separately; until then this at least does
                not mislead. */}
              {hasFilters && scans.length < totalScans && (
                <p className="rounded-lg border border-[hsl(var(--warning))]/25 bg-[hsl(var(--warning))]/5 px-3.5 py-2.5 text-xs text-muted-foreground">
                  Searching the {scans.length} most recent scans, not all{" "}
                  {totalScans} on this account. An older scan may not appear
                  here yet.
                </p>
              )}

              <HistoryEmptyState
                hasScans={scans.length > 0}
                hasFilters={hasFilters}
                hasResults={filtered.length > 0}
                onClearFilters={() => setQuery(DEFAULT_HISTORY_QUERY)}
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
                  currentPage={effectivePage}
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
        </>
      )}

      <ConfirmDialog
        open={showClearConfirm}
        danger
        busy={clearing}
        error={clearError}
        title="Clear all scan history?"
        description={
          <>
            This deletes all{" "}
            <span className="font-medium text-foreground">{totalScans}</span>{" "}
            {totalScans === 1 ? "scan" : "scans"} on this account, findings and
            notes included, not just the {scans.length} shown here. This cannot
            be undone.
          </>
        }
        confirmLabel="Clear history"
        confirmDisabled={clearConfirmText.trim().toUpperCase() !== "DELETE"}
        onCancel={() => {
          setShowClearConfirm(false);
          setClearError(null);
          setClearConfirmText("");
        }}
        onConfirm={handleClearHistory}
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="clear-history-confirm"
            className="text-sm text-muted-foreground"
          >
            Type{" "}
            <span className="font-mono font-medium text-foreground">
              DELETE
            </span>{" "}
            to confirm.
          </label>
          <Input
            id="clear-history-confirm"
            value={clearConfirmText}
            onChange={(e) => setClearConfirmText(e.target.value)}
            autoComplete="off"
            disabled={clearing}
            className="font-mono"
          />
        </div>
      </ConfirmDialog>
    </AppPageShell>
  );
}
