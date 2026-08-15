"use client";

import { useState, useCallback, useEffect, Suspense, useRef } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ROUTES } from "@/lib/config/client-constants";
import { setQueryParam, removeQueryParam } from "@/lib/ui/url-state";
import { Header } from "@/components/scanner/header";
import { ScanHero } from "@/components/scanner/scan-hero";
import {
  ScanForm,
  type ScanMode,
  type ScanFormPayload,
  type InlineAuthValue,
} from "@/components/scanner/scan-form";
import { ScanningIndicator } from "@/components/scanner/scanning-indicator";
import { Dashboard } from "@/components/scanner/dashboard";
import { Footer } from "@/components/scanner/footer";
import {
  DashboardErrorState,
  type ErrorKind,
} from "@/components/scanner/dashboard-error-state";
import { DashboardBulkResult } from "@/components/scanner/dashboard-bulk-result";
import { DashboardResults } from "@/components/scanner/dashboard-results";
import type { ScanAuthReport } from "@/lib/scanner/auth/types";
import {
  AiChoiceModal,
  type AiSummary,
} from "@/components/scanner/ai-choice-modal";
import { CrawlUrlSelector } from "@/components/scanner/crawl-url-selector";
import type { ScanTag } from "@/components/history";

const OnboardingTour = dynamic(
  () =>
    import("@/components/shared/onboarding-tour").then((m) => ({
      default: m.OnboardingTour,
    })),
  { ssr: false },
);
import type {
  Category,
  ScanResult,
  ScanStatus,
  Vulnerability,
} from "@/lib/scanner/types";
import { DEFAULT_SCAN_NOTE, SCANNING } from "@/lib/config/constants";
import { API } from "@/lib/config/client-constants";
import { useClientConfig } from "@/lib/hooks/use-client-config";
import { DashboardRouteSkeleton } from "@/components/dashboard/dashboard-skeleton";
import {
  PremiumUpgradeModal,
  PREMIUM_FEATURES,
} from "@/components/modals/premium-upgrade-modal";
import { useAuth } from "@/components/providers/auth-provider";

const CONTAINER = "w-full max-w-6xl mx-auto px-4 sm:px-6";

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

/**
 * Scans now run as background jobs (see app/api/v3/scan/route.ts and
 * app/api/v3/scan/crawl/route.ts): the POST that kicks one off only
 * returns { scanId, status: "running" }, never the final result. The
 * real result has to be polled for from /api/v3/scan/status/[id] until
 * it reaches a terminal state. Shares its interval with the server's
 * admin-configurable CONFIG_SCAN_STATUS_POLL_INTERVAL_MS
 * (lib/config/config-values.ts) instead of a separate literal.
 */
const SCAN_POLL_INTERVAL_MS = SCANNING.STATUS_POLL_INTERVAL_MS;
/** A little above the server's own watchdogs (300s / 900s) so the client never gives up first. */
const SCAN_MAX_WAIT_MS = 6 * 60 * 1000;
const CRAWL_MAX_WAIT_MS = 16 * 60 * 1000;

interface ScanStatusResult {
  url: string;
  findings?: Vulnerability[];
  crawl?: CrawlInfo;
  authReport?: ScanAuthReport;
  scanHistoryId?: number;
  tags?: ScanTag[];
  [key: string]: unknown;
}

interface ScanStatusResponse {
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
  result?: ScanStatusResult;
  currentCategory?: string | null;
  categoriesCompleted?: number;
  categoriesTotal?: number;
}

/** The real, server-measured progress of a running scan (see scan-jobs.ts). */
interface ScanProgressState {
  currentCategory: string | null;
  categoriesCompleted: number;
  categoriesTotal: number;
}

/**
 * A single failed status check (a dropped request, a brief 5xx, a proxy
 * hiccup) does not mean the scan itself failed -- it's an independent
 * background job that keeps running server-side regardless of whether this
 * particular poll landed. Only give up after several consecutive misses,
 * so a one-off network blip doesn't show "scan failed" for a scan that
 * finishes moments later in the background.
 */
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

async function pollScanStatus(
  scanId: number,
  maxWaitMs: number,
  onProgress?: (progress: ScanProgressState) => void,
  // Caller (a component) resolves the live, admin-configurable value via
  // useClientConfig() and passes it in -- this module-level function can't
  // call a hook itself. Defaults to the compiled constant so any other
  // caller keeps today's behavior.
  pollIntervalMs: number = SCAN_POLL_INTERVAL_MS,
): Promise<ScanStatusResponse> {
  const startedAt = Date.now();
  let consecutiveFailures = 0;
  while (Date.now() - startedAt < maxWaitMs) {
    try {
      const res = await fetch(API.SCAN_STATUS(scanId));
      if (!res.ok) throw new Error(`Status check failed (${res.status})`);
      const data: ScanStatusResponse = await res.json();
      consecutiveFailures = 0;
      onProgress?.({
        currentCategory: data.currentCategory ?? null,
        categoriesCompleted: data.categoriesCompleted ?? 0,
        categoriesTotal: data.categoriesTotal ?? 0,
      });
      if (data.status === "completed" || data.status === "failed") {
        return data;
      }
    } catch {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        throw new Error("Lost track of the scan while it was running.");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(
    "This scan is taking longer than expected. Check your history in a few minutes, it may still finish.",
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardLoading() {
  return <DashboardRouteSkeleton />;
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const { me } = useAuth();
  const { scanStatusPollIntervalMs } = useClientConfig();
  const runScanRef = useRef<
    | ((
        url: string,
        crawlUrls?: string[],
        probes?: { id: string; port: number }[],
        mode?: ScanMode,
        categoryFilter?: Category[],
        auth?: InlineAuthValue,
        isPublic?: boolean,
      ) => Promise<void>)
    | null
  >(null);
  // Set by handleCancelScan, read once by runScan right after
  // pollScanStatus settles. Without this, a user-initiated cancel resets
  // the UI to idle immediately, but the poll loop's in-flight request is
  // still running underneath -- it resolves moments later with the
  // server's own "status: failed, error: Cancelled" (from the DELETE
  // handler) and would otherwise clobber the idle reset with a jarring
  // "scan failed" screen right after the user clicked away.
  const cancelledRef = useRef(false);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanHistoryId, setScanHistoryId] = useState<number | null>(null);
  // The in-flight job's id, tracked separately from scanHistoryId (which
  // only gets set once a scan actually finishes) -- this is what "Cancel
  // scan" targets while status === "scanning". Cleared whenever the poll
  // loop exits for any reason, so a stale id can never be cancelled after
  // its own run already ended.
  const [runningScanId, setRunningScanId] = useState<number | null>(null);
  const [scanTags, setScanTags] = useState<ScanTag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorUrl, setErrorUrl] = useState<string | null>(null);
  const [errorForcedKind, setErrorForcedKind] = useState<ErrorKind | undefined>(
    undefined,
  );
  const [authReport, setAuthReport] = useState<ScanAuthReport | null>(null);
  const [scanningUrl, setScanningUrl] = useState<string | null>(null);
  const [scanningMode, setScanningMode] = useState<ScanMode>("quick");
  const [scanningCategories, setScanningCategories] = useState<
    Category[] | undefined
  >(undefined);
  const [scanProgress, setScanProgress] = useState<ScanProgressState | null>(
    null,
  );
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(
    null,
  );
  const [scanNotes, setScanNotes] = useState("");
  const [crawlInfo, setCrawlInfo] = useState<CrawlInfo | null>(null);
  const [crawlDiscoveryUrls, setCrawlDiscoveryUrls] = useState<string[]>([]);
  const [crawlDiscovering, setCrawlDiscovering] = useState(false);
  const [showCrawlSelector, setShowCrawlSelector] = useState(false);
  const [pendingCrawlUrl, setPendingCrawlUrl] = useState("");
  const [pendingScanners, setPendingScanners] = useState<
    { id: string; port: number }[] | undefined
  >(undefined);
  const [pendingIsPublic, setPendingIsPublic] = useState<boolean | undefined>(
    undefined,
  );
  const [bulkStatus, setBulkStatus] = useState<"idle" | "scanning" | "done">(
    "idle",
  );
  const [bulkProgress, setBulkProgress] = useState<
    { current: number; total: number } | undefined
  >(undefined);
  const [bulkResult, setBulkResult] = useState<{
    total: number;
    successful: number;
    failed: number;
    skipped: number;
  } | null>(null);
  const aiAvailableRef = useRef(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiDeepLoading, setAiDeepLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<AiSummary | undefined>(undefined);

  useEffect(() => {
    if (!me?.userId) return;
    fetch("/api/v3/ai/info")
      .then((r) => r.json())
      .then((d) => {
        aiAvailableRef.current = (d.configured || false) && !d.aiDisabled;
      })
      .catch(() => {});
  }, [me?.userId]);

  const updateUrlWithScan = useCallback((id: number | null) => {
    if (typeof window === "undefined") return;
    if (id) {
      setQueryParam("scan", String(id));
    } else {
      removeQueryParam("scan", { replace: true });
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const scan = params.get("scan");
      if (!scan) {
        if (status === "done") {
          setStatus("idle");
          setResult(null);
          setScanHistoryId(null);
          setError(null);
          setErrorDetails(null);
          setSelectedIssue(null);
          setScanNotes("");
          setCrawlInfo(null);
        }
        return;
      }
      const parsed = parseInt(scan, 10);
      if (!Number.isFinite(parsed)) return;
      if (status === "idle") {
        window.location.href = `${ROUTES.HISTORY}?scan=${parsed}`;
      }
    };

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [status]);

  const handleFindingsUpdated = useCallback((findings: Vulnerability[]) => {
    setResult((prev) => (prev ? { ...prev, findings } : prev));
  }, []);

  async function handleSaveNotes(notes: string) {
    if (!scanHistoryId) return;
    try {
      const res = await fetch(`${API.HISTORY}/${scanHistoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (res.ok) setScanNotes(notes);
    } catch {
      /* ignore */
    }
  }

  const handleAddTag = async (scanId: number, tag: string) => {
    if (!tag.trim()) return;
    const res = await fetch(API.SCAN_TAGS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, tag: tag.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      setScanTags(data.tags);
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
      setScanTags(data.tags);
    }
  };

  const handleScan = useCallback(async (payload: ScanFormPayload) => {
    const { url, mode, scanners, probes, auth, isPublic } = payload;
    const probeEntries = probes.length > 0 ? probes : undefined;
    setPendingScanners(probeEntries);
    setPendingIsPublic(isPublic);
    setScanningMode(mode);
    // Ephemeral authenticated scanning (POST /api/v3/scan/authenticated) is
    // single-page only: it never crawls. A login was supplied, so this run
    // skips crawl discovery even when "deep" was picked and goes straight
    // at the one URL, authenticated, exactly like "quick" would.
    if (mode === "deep" && !auth) {
      setPendingCrawlUrl(url);
      setShowCrawlSelector(true);
      setCrawlDiscovering(true);
      setCrawlDiscoveryUrls([url]);

      try {
        const res = await fetch(API.SCAN_CRAWL_DISCOVER, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: `https://${url}` }),
        });
        const data = await res.json();
        if (res.ok && data.urls) {
          setCrawlDiscoveryUrls(data.urls);
        }
      } catch {
        /* keep the entry URL at minimum */
      }
      setCrawlDiscovering(false);
      return;
    }

    runScanRef.current?.(
      url,
      undefined,
      probeEntries,
      mode,
      scanners,
      auth,
      isPublic,
    );
  }, []);

  const runScan = useCallback(
    async (
      url: string,
      crawlUrls?: string[],
      probes?: { id: string; port: number }[],
      mode: ScanMode = "quick",
      categoryFilter?: Category[],
      auth?: InlineAuthValue,
      isPublic?: boolean,
    ) => {
      setStatus("scanning");
      setResult(null);
      setScanHistoryId(null);
      setError(null);
      setErrorDetails(null);
      setErrorStatus(null);
      setErrorUrl(null);
      setErrorForcedKind(undefined);
      setAuthReport(null);
      setScanningUrl(url);
      setScanningMode(mode);
      setScanningCategories(
        categoryFilter && categoryFilter.length > 0
          ? categoryFilter
          : undefined,
      );
      setScanProgress(null);
      setSelectedIssue(null);
      setScanNotes("");
      setCrawlInfo(null);
      setShowAiModal(false);
      setAiSummary(undefined);

      const probePayload = probes?.length
        ? probes.map((p) => `${p.id}:${p.port}`)
        : undefined;
      const scannerPayload =
        categoryFilter && categoryFilter.length > 0
          ? categoryFilter
          : undefined;
      const isCrawl = !!crawlUrls;
      // Authenticated scanning lives entirely behind its own request shape
      // (POST /api/v3/scan/authenticated, ephemeral login material in the
      // body, never crawls). Everything else keeps using the plain
      // scan/crawl endpoints. Probes and crawl URLs have no meaning to the
      // authenticated endpoint's schema, so they are left out entirely
      // rather than sent and silently dropped.
      const endpoint = auth
        ? API.SCAN_AUTHENTICATED
        : isCrawl
          ? API.SCAN_CRAWL
          : API.SCAN;
      // isPublic is only included when the caller actually made a choice
      // (a real submit through the scan form always does). Omitted
      // entirely otherwise, so the API falls back to the account's own
      // "scans are private by default" setting instead of defaulting to
      // public -- see lib/scanner/scan-privacy.ts.
      const payload = auth
        ? {
            url,
            ...(scannerPayload ? { scanners: scannerPayload } : {}),
            auth,
            ...(typeof isPublic === "boolean" ? { isPublic } : {}),
          }
        : {
            ...(isCrawl ? { url, urls: crawlUrls } : { url }),
            ...(scannerPayload ? { scanners: scannerPayload } : {}),
            ...(probePayload ? { probes: probePayload } : {}),
            ...(typeof isPublic === "boolean" ? { isPublic } : {}),
          };

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
          if (
            response.status === 429 &&
            (data.remaining === 0 ||
              data.error?.toLowerCase().includes("daily scan limit") ||
              data.error?.toLowerCase().includes("scan limit"))
          ) {
            setStatus("idle");
            setShowLimitModal(true);
            return;
          }
          // Authenticated scan: 422 means login itself failed before any
          // check ran. Nothing partial to show, so this gets its own
          // blocking state instead of the generic scan-failed one.
          if (response.status === 422 && data.authReport) {
            setError(
              data.authReport.reason ||
                data.error ||
                "The login could not sign in.",
            );
            setErrorForcedKind("auth_failed");
            setErrorUrl(url);
            setStatus("failed");
            return;
          }
          setError(data.error || "An unexpected error occurred.");
          setErrorDetails(data.details || null);
          setErrorStatus(response.status);
          setErrorUrl(url);
          setStatus("failed");
          return;
        }

        // POST /api/v3/scan and /api/v3/scan/crawl now run as background
        // jobs (see those route files): this response is only
        // { scanId, status: "running" }, not the final result, so it has
        // to be polled from /api/v3/scan/status/[id]. The ephemeral
        // authenticated endpoint (auth branch above) is unaffected and
        // still replies synchronously with the finished scan.
        let finalData = data;
        if (!auth) {
          const scanId = data.scanId;
          if (!scanId) {
            setError("The scanner did not return a job to track.");
            setErrorStatus(response.status);
            setErrorUrl(url);
            setStatus("failed");
            return;
          }
          setRunningScanId(scanId);
          let statusData: ScanStatusResponse;
          try {
            statusData = await pollScanStatus(
              scanId,
              isCrawl ? CRAWL_MAX_WAIT_MS : SCAN_MAX_WAIT_MS,
              setScanProgress,
              scanStatusPollIntervalMs,
            );
          } catch (pollError) {
            // A user-initiated cancel already reset the UI to idle
            // (handleCancelScan) -- don't clobber that with a "scan
            // failed" screen just because this in-flight poll's own
            // request lost the race and errored out afterward.
            if (cancelledRef.current) {
              cancelledRef.current = false;
              return;
            }
            setError(
              pollError instanceof Error
                ? pollError.message
                : "Lost track of the scan while it was running.",
            );
            setErrorUrl(url);
            setStatus("failed");
            return;
          } finally {
            setRunningScanId(null);
          }
          if (cancelledRef.current) {
            // Same reasoning as above: the cancel already reset the UI,
            // this resolved poll is just the DELETE's own "status: failed,
            // error: Cancelled" response arriving after the fact.
            cancelledRef.current = false;
            return;
          }
          if (statusData.status === "failed" || !statusData.result) {
            setError(statusData.error || "The scan failed.");
            setErrorUrl(url);
            setStatus("failed");
            return;
          }
          finalData = statusData.result;
        }

        let effectiveFindings: Vulnerability[] = [];
        if (finalData.crawl && finalData.crawl.pages?.length > 0) {
          const mainPage = finalData.crawl.pages[0];
          effectiveFindings = mainPage.findings || [];
          setResult({
            ...finalData,
            findings: effectiveFindings,
            summary: mainPage.summary,
            duration: mainPage.duration,
          });
          setCrawlInfo(finalData.crawl);
        } else {
          effectiveFindings = finalData.findings || [];
          setResult({ ...finalData, findings: effectiveFindings });
        }
        setAuthReport(finalData.authReport ?? null);
        const historyId = finalData.scanHistoryId || null;
        setScanHistoryId(historyId);
        // Populated for a regular scan/crawl (its result comes from
        // GET /api/v3/scan/status/[id], which includes tags once auto-
        // tagging has run). The ephemeral authenticated-scan path
        // (finalData = data above) has no tags here yet -- that route
        // saves them fire-and-forget after already responding, so they
        // only show up once the user revisits this scan from History.
        setScanTags(Array.isArray(finalData.tags) ? finalData.tags : []);
        setScanNotes(DEFAULT_SCAN_NOTE);
        setStatus("done");

        if (historyId) {
          updateUrlWithScan(historyId);
        }

        if (historyId) {
          fetch(`${API.HISTORY}/${historyId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: DEFAULT_SCAN_NOTE }),
          }).catch(() => {});
        }

        if (aiAvailableRef.current && historyId) {
          setShowAiModal(true);
        }
      } catch {
        setError(
          "Failed to connect to the scanner. Please check your connection and try again.",
        );
        setErrorStatus(null);
        setErrorUrl(url);
        setStatus("failed");
      }
    },
    [updateUrlWithScan, scanStatusPollIntervalMs],
  );

  // Keep ref in sync with latest runScan so handleScan (defined earlier)
  // can call it without re-running on every callback recreation.
  useEffect(() => {
    runScanRef.current = runScan;
  }, [runScan]);

  function handleCrawlConfirm(selectedUrls: string[]) {
    setShowCrawlSelector(false);
    setCrawlDiscoveryUrls([]);
    runScan(
      pendingCrawlUrl,
      selectedUrls,
      pendingScanners,
      "deep",
      undefined,
      undefined,
      pendingIsPublic,
    );
  }

  function handleCrawlCancel() {
    setShowCrawlSelector(false);
    setCrawlDiscoveryUrls([]);
    setPendingCrawlUrl("");
    setCrawlDiscovering(false);
  }

  const handleBulkScan = useCallback(
    async (urls: string[], isPublic?: boolean) => {
      setBulkStatus("scanning");
      setBulkResult(null);
      setBulkProgress({ current: 0, total: urls.length });

      let successful = 0;
      let failed = 0;
      let skipped = 0;

      for (let i = 0; i < urls.length; i++) {
        setBulkProgress({ current: i + 1, total: urls.length });

        try {
          const res = await fetch(API.SCAN, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: urls[i],
              source: "bulk",
              ...(typeof isPublic === "boolean" ? { isPublic } : {}),
            }),
          });
          const data = await res.json();

          if (res.ok && !data.error) {
            successful++;
          } else if (
            res.status === 429 ||
            data.error?.toLowerCase().includes("daily scan limit") ||
            data.error?.toLowerCase().includes("scan limit")
          ) {
            skipped++;
            if (skipped === 1) {
              setShowLimitModal(true);
            }
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      setBulkResult({ total: urls.length, successful, failed, skipped });
      setBulkProgress(undefined);
      setBulkStatus("done");
    },
    [],
  );

  useEffect(() => {
    const scanUrl = searchParams.get("scan");
    if (scanUrl && status === "idle") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- triggers an async scan; setState only fires after its own awaited network calls resolve, not synchronously here
      handleScan({ url: scanUrl, mode: "quick", probes: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Best-effort: fires the server-side cancel (DELETE, see
  // app/api/v3/scan/status/[id]/route.ts) and returns to idle immediately
  // rather than waiting for the in-flight pollScanStatus loop to notice.
  // A failure here is fine to ignore -- the scan keeps running server-side
  // either way, and the user is already back at the form to start a new
  // one; nothing about cancelling a job the UI no longer displays needs a
  // blocking error state.
  function handleCancelScan() {
    if (!runningScanId) return;
    cancelledRef.current = true;
    fetch(API.SCAN_STATUS(runningScanId), { method: "DELETE" }).catch(() => {});
    setRunningScanId(null);
    setStatus("idle");
  }

  async function handleDeepScan() {
    if (!scanHistoryId) return;
    setAiDeepLoading(true);
    try {
      const res = await fetch(API.SCAN_VERIFY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanHistoryId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.findings)) {
          const enriched = data.findings as Vulnerability[];
          setResult((prev) => (prev ? { ...prev, findings: enriched } : prev));
          setAiSummary({
            confirmed: enriched.filter((f) => f.aiVerdict === "confirmed")
              .length,
            possibleFp: enriched.filter((f) => f.aiVerdict === "possible_fp")
              .length,
            uncertain: enriched.filter((f) => f.aiVerdict === "uncertain")
              .length,
            skipped: enriched.filter((f) => !f.aiVerdict).length,
          });
        } else {
          setShowAiModal(false);
        }
      } else {
        setShowAiModal(false);
      }
    } catch {
      setShowAiModal(false);
    } finally {
      setAiDeepLoading(false);
    }
  }

  function handleViewNow() {
    setShowAiModal(false);
    setAiSummary(undefined);
  }

  function handleReset() {
    setStatus("idle");
    setResult(null);
    setScanHistoryId(null);
    setScanTags([]);
    setError(null);
    setErrorDetails(null);
    setErrorForcedKind(undefined);
    setAuthReport(null);
    setScanProgress(null);
    setSelectedIssue(null);
    setScanNotes("");
    setCrawlInfo(null);
    setShowCrawlSelector(false);
    setCrawlDiscoveryUrls([]);
    setPendingCrawlUrl("");
    setCrawlDiscovering(false);
    setShowAiModal(false);
    setAiSummary(undefined);
    updateUrlWithScan(null);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <OnboardingTour />
      <Header />

      <main className={`flex-1 pb-16 ${CONTAINER}`}>
        {/* Idle: the scan console, then whatever this account has already found */}
        {status === "idle" && (
          <>
            <ScanHero />
            <ScanForm
              onScan={handleScan}
              status={status}
              onBulkScan={handleBulkScan}
              bulkStatus={bulkStatus}
              bulkProgress={bulkProgress}
              defaultPrivate={me?.scansPrivateByDefault}
            />
            {bulkStatus === "done" && bulkResult && (
              <DashboardBulkResult
                result={bulkResult}
                onDismiss={() => {
                  setBulkResult(null);
                  setBulkStatus("idle");
                }}
              />
            )}
            <Dashboard />
          </>
        )}

        {/* In progress */}
        {status === "scanning" && (
          <div className="flex justify-center pt-10 sm:pt-16">
            <ScanningIndicator
              url={scanningUrl ?? undefined}
              mode={scanningMode}
              categories={scanningCategories}
              currentCategory={scanProgress?.currentCategory ?? null}
              categoriesCompleted={scanProgress?.categoriesCompleted ?? 0}
              categoriesTotal={scanProgress?.categoriesTotal ?? 0}
              onCancel={runningScanId ? handleCancelScan : undefined}
            />
          </div>
        )}

        {/* Failed */}
        {status === "failed" && error && (
          <DashboardErrorState
            error={error}
            details={errorDetails || undefined}
            url={errorUrl ?? undefined}
            status={errorStatus ?? undefined}
            forcedKind={errorForcedKind}
            onRetry={handleReset}
          />
        )}

        {/* Complete */}
        {status === "done" && result && (
          <DashboardResults
            result={result}
            selectedIssue={selectedIssue}
            onSelectIssue={setSelectedIssue}
            scanHistoryId={scanHistoryId}
            scanNotes={scanNotes}
            scanTags={scanTags}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            crawlInfo={crawlInfo}
            authReport={authReport}
            onReset={handleReset}
            onScanSubdomain={(subUrl) =>
              handleScan({ url: subUrl, mode: "quick", probes: [] })
            }
            onSaveNotes={handleSaveNotes}
            onFindingsUpdated={handleFindingsUpdated}
          />
        )}
      </main>

      <Footer />

      {showCrawlSelector && (
        <CrawlUrlSelector
          urls={crawlDiscoveryUrls}
          isLoading={crawlDiscovering}
          onConfirm={handleCrawlConfirm}
          onCancel={handleCrawlCancel}
        />
      )}

      <PremiumUpgradeModal
        open={showLimitModal}
        onOpenChange={setShowLimitModal}
        feature={PREMIUM_FEATURES.scan_limit}
        currentPlan={me?.plan || "free"}
      />

      {showAiModal && result && (
        <AiChoiceModal
          findings={result.findings}
          loading={aiDeepLoading}
          aiSummary={aiSummary}
          onDeepScan={handleDeepScan}
          onViewNow={handleViewNow}
        />
      )}
    </div>
  );
}
