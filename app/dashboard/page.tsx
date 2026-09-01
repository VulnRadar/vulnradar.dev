"use client";

import { useState, useCallback, useEffect, Suspense, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ROUTES } from "@/lib/config/client-constants";
import {
  setQueryParams,
  removeQueryParam,
  LOCATION_CHANGE_EVENT,
} from "@/lib/ui/url-state";
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
import type { CrawlInfo } from "@/components/scanner/crawl-pages-info";
import type { ScanTag } from "@/components/history";
// The status poll loop and its types live in their own module so they can be
// exercised by a test without mounting this whole page (AUDIT-014#scanui-09).
import {
  pollScanStatus,
  PollAbortedError,
  type ScanStatusResponse,
  type ScanProgressState,
} from "./poll-scan-status";
import { buildScanRequest } from "./scan-request";

const OnboardingTour = dynamic(
  () =>
    import("@/components/shared/onboarding-tour").then((m) => ({
      default: m.OnboardingTour,
    })),
  { ssr: false },
);
import type {
  ScanResult,
  ScanStatus,
  Vulnerability,
} from "@/lib/scanner/types";
import { DEFAULT_SCAN_NOTE } from "@/lib/config/client-constants";
import { API } from "@/lib/config/client-constants";
import { mapHistoryDetailResponse } from "@/lib/scanner/history-detail";
import { useClientConfig } from "@/lib/hooks/use-client-config";
import { DashboardRouteSkeleton } from "@/components/dashboard/dashboard-skeleton";
import {
  PremiumUpgradeModal,
  PREMIUM_FEATURES,
} from "@/components/modals/premium-upgrade-modal";
import { useAuth } from "@/components/providers/auth-provider";

const CONTAINER = "w-full max-w-6xl mx-auto px-4 sm:px-6";

/** Gap between retries of a bulk URL that was refused for concurrency, and the
 *  ceiling on how long one URL is allowed to wait for a slot before it is
 *  reported as refused. See handleBulkScan. */
const BULK_CONCURRENCY_RETRY_MS = 3000;
const BULK_CONCURRENCY_MAX_WAIT_MS = 120000;

/**
 * ?scan= is overloaded on this page. A URL/host-looking value is a target to
 * kick off a scan for; anything else -- an opaque history public_id (hex) or a
 * legacy numeric id -- is a saved scan to open in History. Hosts and URLs
 * always carry a dot, slash, or scheme colon, and neither an opaque public_id
 * nor a numeric id ever does, so that cleanly separates the two meanings.
 */
function scanParamIsTarget(value: string): boolean {
  return /[./:]/.test(value);
}

/** A little above the server's own watchdogs (300s / 900s) so the client never gives up first. */
const SCAN_MAX_WAIT_MS = 6 * 60 * 1000;
const CRAWL_MAX_WAIT_MS = 16 * 60 * 1000;

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { me } = useAuth();
  const { scanStatusPollIntervalMs } = useClientConfig();
  const runScanRef = useRef<
    | ((
        url: string,
        crawlUrls?: string[],
        mode?: ScanMode,
        categoryFilter?: string[],
        auth?: InlineAuthValue,
        isPublic?: boolean,
        captureScreenshot?: boolean,
        portScan?: boolean,
      ) => Promise<void>)
    | null
  >(null);
  /** The last scan the user asked for, so a failure can be retried as-is. */
  const lastScanPayloadRef = useRef<ScanFormPayload | null>(null);
  // Set by handleCancelScan, read once by runScan right after
  // pollScanStatus settles. Without this, a user-initiated cancel resets
  // the UI to idle immediately, but the poll loop's in-flight request is
  // still running underneath -- it resolves moments later with the
  // server's own "status: failed, error: Cancelled" (from the DELETE
  // handler) and would otherwise clobber the idle reset with a jarring
  // "scan failed" screen right after the user clicked away.
  const cancelledRef = useRef(false);
  // Aborts the in-flight status-poll loop. Replaced per run, aborted on
  // cancel and on unmount (the App Router keeps this module's JS context
  // alive across a client navigation, so without the unmount abort the loop
  // outlives the page).
  const pollAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => pollAbortRef.current?.abort(), []);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanHistoryId, setScanHistoryId] = useState<number | null>(null);
  // Opaque public id for the completed scan, mirrored alongside scanHistoryId.
  // Used for the screenshot URL and its refresh route so neither exposes the
  // internal numeric id. Falls back to the numeric id only for a record that
  // predates it (e.g. the ephemeral authenticated path, which has no public id
  // here yet).
  const [scanPublicId, setScanPublicId] = useState<string | null>(null);
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
    string[] | undefined
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
  const [pendingIsPublic, setPendingIsPublic] = useState<boolean | undefined>(
    undefined,
  );
  // Carried across the crawl-URL-selector step so a "deep" scan that opted
  // into a screenshot still requests one once the user confirms which pages
  // to scan (handleCrawlConfirm runs runScan after the selector closes).
  const [pendingScreenshot, setPendingScreenshot] = useState(false);
  const [pendingPortScan, setPendingPortScan] = useState(false);
  // Same carry-across, for the check families and active probes the user
  // picked. This was missing entirely, so handleCrawlConfirm passed undefined
  // as the categoryFilter and every deep scan silently ran the full set:
  // unticking a family or ticking an active probe had no effect at all, with
  // nothing to say the configuration had been dropped. POST
  // /api/v3/scan/crawl accepts `scanners` and the extension already sends it.
  const [pendingScanners, setPendingScanners] = useState<string[] | undefined>(
    undefined,
  );
  // Same carry-across, for the login supplied with a "deep" scan. Without it
  // handleCrawlConfirm passed undefined as the auth argument and the confirmed
  // crawl ran signed out, which is the second half of the bug fixed in
  // handleScan below (AUDIT-011#drift-21). Login material lives in this state
  // only for the seconds between submitting the form and confirming the page
  // picker, and is cleared the moment either path finishes or is cancelled.
  const [pendingAuth, setPendingAuth] = useState<InlineAuthValue | undefined>(
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
  // Separate from showAiModal on purpose. Completion used to open the modal
  // itself, a fixed inset-0 backdrop-blur overlay over results that had just
  // finished rendering, so the payoff of the scan was a blur the user had to
  // dismiss before they could read anything. Completion now only offers the
  // run, inline and above the results, and the modal opens when they ask.
  const [aiDeepLoading, setAiDeepLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<AiSummary | undefined>(undefined);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.userId) return;
    fetch("/api/v3/ai/info")
      .then((r) => r.json())
      .then((d) => {
        aiAvailableRef.current = (d.configured || false) && !d.aiDisabled;
      })
      .catch(() => {});
  }, [me?.userId]);

  const updateUrlWithScan = useCallback((id: string | number | null) => {
    if (typeof window === "undefined") return;
    if (id) {
      // Land on a clean, shareable ?scan=<id> result URL. The scan-option
      // params the form wrote while configuring the scan (mode, screenshot,
      // port_scan, active_probes) are cleared in the same history entry, so a
      // finished result reads as its own result link instead of the long
      // ?mode=...&screenshot=1&port_scan=1&active_probes=... URL it was
      // launched from -- which never looked like it had navigated to a result.
      //
      // replace, not push: finishing a scan is not a navigation the user
      // made, and pushing here put a second entry on the stack for one
      // action. Back then landed on the pre-completion URL, whose missing
      // ?scan= told the sync effect below to throw the results away, and
      // Forward returned to an id the effect bounced to History with a full
      // document load. Replacing keeps the shareable result URL without
      // making the back button destroy the result it is pointing at.
      setQueryParams(
        {
          scan: String(id),
          mode: null,
          screenshot: null,
          port_scan: null,
          active_probes: null,
        },
        { replace: true },
      );
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
          setScanPublicId(null);
          setError(null);
          setErrorDetails(null);
          setSelectedIssue(null);
          setScanNotes("");
          setCrawlInfo(null);
        }
        return;
      }
      // A URL/host-looking value is a scan target, handled by the effect
      // below; leave it alone here. Anything else is a saved scan's id
      // (opaque public_id or legacy numeric), so bounce to the History tab,
      // which resolves either shape.
      if (scanParamIsTarget(scan)) return;
      if (status === "idle") {
        // router.replace, not window.location.href: a full document reload
        // for what is a move between two routes of the same app, and it
        // pushed the dashboard URL it was leaving onto the stack, so Back
        // bounced straight here again.
        router.replace(`${ROUTES.HISTORY}?scan=${encodeURIComponent(scan)}`);
      }
    };

    syncFromUrl();
    // Clicking the Scanner nav link while viewing a finished scan clears ?scan=
    // via a soft navigation that fires neither popstate nor a remount, so the
    // results would otherwise stay on screen. Re-read on any location change.
    window.addEventListener(LOCATION_CHANGE_EVENT, syncFromUrl);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener(LOCATION_CHANGE_EVENT, syncFromUrl);
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, [status, router]);

  const handleFindingsUpdated = useCallback((findings: Vulnerability[]) => {
    setResult((prev) => (prev ? { ...prev, findings } : prev));
  }, []);

  // Mirrors app/history/page.tsx's handleVerdictChanged: the server already
  // recalculates dangerScore/summary excluding false_positive-marked
  // findings (lib/scanner/recompute-scan-score.ts), this just refetches so
  // the currently-open live scan view picks it up instead of showing a
  // stale score until the scan is reopened from history.
  const handleVerdictChanged = useCallback(async () => {
    if (!scanHistoryId) return;
    try {
      const res = await fetch(`${API.HISTORY}/${scanHistoryId}`);
      if (!res.ok) return;
      const data = await res.json();
      const mapped = mapHistoryDetailResponse(data);
      setResult((prev) =>
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
  }, [scanHistoryId]);

  // Returns null on success, the message to show on failure. The catch used
  // to swallow the failure outright, so the notes editor closed and the text
  // was gone with nothing said about it.
  async function handleSaveNotes(notes: string): Promise<string | null> {
    if (!scanHistoryId) return "This scan is not saved yet.";
    try {
      const res = await fetch(`${API.HISTORY}/${scanHistoryId}`, {
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
  }

  // Return null on success, the message to show on failure. Same silent-write
  // problem the history page had: no !res.ok branch and no catch at all.
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
      setScanTags(data.tags);
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
      setScanTags(data.tags);
      return null;
    } catch {
      return "Couldn't reach the server to remove that tag.";
    }
  };

  const handleScan = useCallback(async (payload: ScanFormPayload) => {
    // Kept so the failure screen's "Try again" can re-run the same scan
    // rather than dumping the user back on an empty form to retype the URL
    // and re-pick every option (see handleRetryScan below).
    lastScanPayloadRef.current = payload;
    const { url, mode, scanners, auth, isPublic, captureScreenshot, portScan } =
      payload;
    setPendingIsPublic(isPublic);
    setPendingScreenshot(!!captureScreenshot);
    setPendingPortScan(!!portScan);
    setScanningMode(mode);
    // "Deep" always crawls, with or without a login. This used to read
    // `mode === "deep" && !auth`, which sent every auth-carrying request to
    // the single-page endpoint: asking for a crawl AND supplying credentials
    // silently produced a one-page scan, with nothing on screen to say the
    // crawl had been dropped. POST /api/v3/scan/crawl takes the same `auth`
    // block as the single-page route (it establishes the session once and
    // threads it through every page fetch), so the login is carried through
    // discovery and into the crawl instead. AUDIT-011#drift-21.
    if (mode === "deep") {
      setPendingCrawlUrl(url);
      setPendingScanners(scanners);
      setPendingAuth(auth);
      setShowCrawlSelector(true);
      setCrawlDiscovering(true);
      setCrawlDiscoveryUrls([url]);

      try {
        const res = await fetch(API.SCAN_CRAWL_DISCOVER, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Discovery signs in too when a login was supplied, otherwise the
          // picker would only ever list the pages a signed-out visitor can
          // reach and an "authenticated crawl" would cover the marketing site.
          body: JSON.stringify({
            url: `https://${url}`,
            ...(auth ? { auth } : {}),
          }),
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
      mode,
      scanners,
      auth,
      isPublic,
      captureScreenshot,
      portScan,
    );
  }, []);

  const runScan = useCallback(
    async (
      url: string,
      crawlUrls?: string[],
      mode: ScanMode = "quick",
      categoryFilter?: string[],
      auth?: InlineAuthValue,
      isPublic?: boolean,
      captureScreenshot?: boolean,
      portScan?: boolean,
    ) => {
      setStatus("scanning");
      setResult(null);
      setScanHistoryId(null);
      setScanPublicId(null);
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

      const isCrawl = !!crawlUrls;
      // Endpoint + body live in ./scan-request so the routing decision can be
      // tested without mounting this page. A crawl always goes to the crawl
      // endpoint, with or without a login: this used to send ANY auth-carrying
      // request to the single-page route, which silently dropped the crawl
      // URLs and scanned one page. AUDIT-011#drift-21.
      const { endpoint, payload, isInlineAuthScan } = buildScanRequest({
        url,
        crawlUrls,
        scanners: categoryFilter,
        auth,
        isPublic,
        captureScreenshot,
        portScan,
      });

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
        // to be polled from /api/v3/scan/status/[id]. That includes an
        // AUTHENTICATED crawl. Only the single-page ephemeral endpoint
        // (isInlineAuthScan) replies synchronously with the finished scan.
        let finalData = data;
        if (!isInlineAuthScan) {
          const scanId = data.scanId;
          if (!scanId) {
            setError("The scanner did not return a job to track.");
            setErrorStatus(response.status);
            setErrorUrl(url);
            setStatus("failed");
            return;
          }
          setRunningScanId(scanId);
          pollAbortRef.current?.abort();
          const pollAbort = new AbortController();
          pollAbortRef.current = pollAbort;
          let statusData: ScanStatusResponse;
          try {
            statusData = await pollScanStatus(
              scanId,
              isCrawl ? CRAWL_MAX_WAIT_MS : SCAN_MAX_WAIT_MS,
              setScanProgress,
              scanStatusPollIntervalMs,
              pollAbort.signal,
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
            // Aborted for any other reason (unmount, a newer run taking
            // over): nothing left on screen to report to.
            if (pollError instanceof PollAbortedError) return;
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
        setScanPublicId(
          typeof finalData.scanPublicId === "string"
            ? finalData.scanPublicId
            : null,
        );
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
          // Prefer the opaque public id for the URL; fall back to the numeric
          // id only if the response predates it (e.g. the ephemeral auth path).
          updateUrlWithScan(
            typeof finalData.scanPublicId === "string"
              ? finalData.scanPublicId
              : historyId,
          );
        }

        if (historyId) {
          fetch(`${API.HISTORY}/${historyId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: DEFAULT_SCAN_NOTE }),
          }).catch(() => {});
        }

        if (aiAvailableRef.current && historyId) {
          // Opens on completion rather than offering an inline banner: the
          // owner wants this as a modal. AUDIT-014#scan-08 argued the other
          // way, that a modal at the end of a scan interrupts the read, and
          // was overruled.
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
      "deep",
      pendingScanners,
      // Was hardcoded undefined, so a crawl confirmed from the picker always
      // ran signed out even once handleScan started carrying the login here.
      pendingAuth,
      pendingIsPublic,
      pendingScreenshot,
      pendingPortScan,
    );
    // runScan already has the value by argument, so the state copy is dropped
    // immediately: login material never outlives the request it was typed for.
    setPendingAuth(undefined);
  }

  function handleCrawlCancel() {
    setShowCrawlSelector(false);
    setCrawlDiscoveryUrls([]);
    setPendingCrawlUrl("");
    setPendingScanners(undefined);
    setPendingAuth(undefined);
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

        // POST /api/v3/scan reserves a concurrency slot and returns while the
        // scan is still running (route.ts's `void executeScan`), so this loop
        // fires the whole list in well under a second -- far faster than the
        // scans themselves finish. Every plan caps concurrent scans (free
        // is 1), so from the second URL onwards the response was a 429
        // carrying statusCode CONCURRENT_SCAN_LIMIT, which the old code
        // bucketed with the daily-quota 429 and reported as "skipped, you hit
        // the scan limit" while opening the daily-limit upgrade modal. A
        // 10-URL run on a free account queued one scan and told the user the
        // other nine were over quota, when the daily quota was never involved.
        // A concurrency 429 means "not yet", so wait for the running scan to
        // release its slot and retry the same URL.
        const deadline = Date.now() + BULK_CONCURRENCY_MAX_WAIT_MS;
        let outcome: "queued" | "over-quota" | "refused" = "refused";

        while (true) {
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
            const data = await res.json().catch(() => ({}));

            if (res.ok && !data.error) {
              outcome = "queued";
              break;
            }
            if (
              res.status === 429 &&
              data.statusCode === "CONCURRENT_SCAN_LIMIT" &&
              Date.now() < deadline
            ) {
              await new Promise((resolve) =>
                setTimeout(resolve, BULK_CONCURRENCY_RETRY_MS),
              );
              continue;
            }
            // Everything else is a real refusal. Only the daily cap has an
            // upgrade path, and it is the only 429 left once concurrency has
            // been handled above.
            outcome = res.status === 429 ? "over-quota" : "refused";
            break;
          } catch {
            outcome = "refused";
            break;
          }
        }

        if (outcome === "queued") {
          successful++;
        } else if (outcome === "over-quota") {
          skipped++;
          if (skipped === 1) {
            setShowLimitModal(true);
          }
        } else {
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
    // Only a URL/host-looking ?scan= is a target to scan; an id-looking value
    // is a saved scan the effect above redirects to History instead.
    if (scanUrl && scanParamIsTarget(scanUrl) && status === "idle") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- triggers an async scan; setState only fires after its own awaited network calls resolve, not synchronously here
      handleScan({ url: scanUrl, mode: "quick" });
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
    pollAbortRef.current?.abort();
    fetch(API.SCAN_STATUS(runningScanId), { method: "DELETE" }).catch(() => {});
    setRunningScanId(null);
    setStatus("idle");
  }

  // Every non-success path here used to collapse to setShowAiModal(false),
  // which is pixel-identical to clicking "Skip, show the raw findings". So
  // "ran and found nothing", "you are out of AI credits" and "the provider is
  // down" were indistinguishable, and the quota message (the product's own
  // upgrade path) was thrown away. The modal now stays open and says which
  // one happened.
  async function handleDeepScan() {
    if (!scanHistoryId) return;
    setAiDeepLoading(true);
    setAiError(null);
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
          setAiError(
            "The AI service returned nothing to apply. Your findings are unchanged.",
          );
        }
      } else {
        const data = await res.json().catch(() => ({}));
        const message =
          data.error || "The AI service refused the request. Try again later.";
        // A credits/quota 429 is the one case with a real remedy, so route it
        // into the upgrade modal this page already mounts instead of leaving
        // the user to work out what to do about it.
        if (
          res.status === 429 &&
          /credit|quota|limit/i.test(String(data.error || ""))
        ) {
          setShowAiModal(false);
          setShowLimitModal(true);
          return;
        }
        setAiError(message);
      }
    } catch {
      setAiError(
        "Couldn't reach the AI service. Check your connection and try again.",
      );
    } finally {
      setAiDeepLoading(false);
    }
  }

  function handleViewNow() {
    setShowAiModal(false);
    setAiSummary(undefined);
    setAiError(null);
  }

  function handleReset() {
    setStatus("idle");
    setResult(null);
    setScanHistoryId(null);
    setScanPublicId(null);
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
    setPendingScanners(undefined);
    setCrawlDiscovering(false);
    setShowAiModal(false);
    setAiSummary(undefined);
    setAiError(null);
    updateUrlWithScan(null);
  }

  /**
   * The failure screen's primary action. It used to be handleReset, so a
   * button labelled "Try again" cleared the form and tried nothing: the user
   * had to retype the URL and re-pick the mode, the check families, the
   * screenshot and port-scan options to retry a scan that had failed on a
   * timeout. Runs the same payload again, and only falls back to the reset
   * when there is genuinely nothing to repeat (a scan started from a ?scan=
   * URL on first load, before any form submission).
   */
  function handleRetryScan() {
    const payload = lastScanPayloadRef.current;
    if (!payload) {
      handleReset();
      return;
    }
    handleReset();
    handleScan(payload);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <OnboardingTour />
      <Header />

      <main
        id="main-content"
        tabIndex={-1}
        className={`flex-1 pb-16 ${CONTAINER}`}
      >
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
            onRetry={handleRetryScan}
            onBack={handleReset}
          />
        )}

        {/* Complete */}
        {status === "done" && result && (
          <DashboardResults
            result={result}
            selectedIssue={selectedIssue}
            onSelectIssue={setSelectedIssue}
            scanHistoryId={scanHistoryId}
            scanPublicId={scanPublicId}
            scanNotes={scanNotes}
            scanTags={scanTags}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            crawlInfo={crawlInfo}
            authReport={authReport}
            onReset={handleReset}
            onScanSubdomain={(subUrl) =>
              handleScan({ url: subUrl, mode: "quick" })
            }
            onSaveNotes={handleSaveNotes}
            onFindingsUpdated={handleFindingsUpdated}
            onVerdictChanged={handleVerdictChanged}
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
          error={aiError}
          onDeepScan={handleDeepScan}
          onViewNow={handleViewNow}
        />
      )}
    </div>
  );
}
