"use client";

import { useState, useCallback, useEffect, Suspense, useRef } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Header } from "@/components/scanner/header";
import { ScanForm, type ScanMode } from "@/components/scanner/scan-form";
import { ScanningIndicator } from "@/components/scanner/scanning-indicator";
import { Dashboard } from "@/components/scanner/dashboard";
import { Footer } from "@/components/scanner/footer";
import { DashboardErrorState } from "@/components/scanner/dashboard-error-state";
import { DashboardBulkResult } from "@/components/scanner/dashboard-bulk-result";
import { DashboardResults } from "@/components/scanner/dashboard-results";
import { CrawlUrlSelector } from "@/components/scanner/crawl-url-selector";

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
import { DEFAULT_SCAN_NOTE } from "@/lib/config/constants";
import { API } from "@/lib/config/client-constants";
import { Loader2 as Loader2Icon } from "lucide-react";
import {
  PremiumUpgradeModal,
  PREMIUM_FEATURES,
} from "@/components/modals/premium-upgrade-modal";
import { useAuth } from "@/components/providers/auth-provider";

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

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardLoading() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2Icon className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const { me } = useAuth();
  const runScanRef = useRef<
    | ((
        url: string,
        crawlUrls?: string[],
        scanners?: string[],
        mode?: ScanMode,
      ) => Promise<void>)
    | null
  >(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanHistoryId, setScanHistoryId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorUrl, setErrorUrl] = useState<string | null>(null);
  const [scanningUrl, setScanningUrl] = useState<string | null>(null);
  const [scanningMode, setScanningMode] = useState<ScanMode>("quick");
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(
    null,
  );
  const [scanNotes, setScanNotes] = useState("");
  const [crawlInfo, setCrawlInfo] = useState<CrawlInfo | null>(null);
  const [crawlDiscoveryUrls, setCrawlDiscoveryUrls] = useState<string[]>([]);
  const [crawlDiscovering, setCrawlDiscovering] = useState(false);
  const [showCrawlSelector, setShowCrawlSelector] = useState(false);
  const [pendingCrawlUrl, setPendingCrawlUrl] = useState("");
  const [pendingScanners, setPendingScanners] = useState<string[] | undefined>(
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

  const updateUrlWithScan = useCallback((id: number | null) => {
    if (typeof window === "undefined") return;
    if (id) {
      window.history.pushState(null, "", `/dashboard#scan-${id}`);
    } else {
      window.history.replaceState(null, "", "/dashboard");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let prevHash = window.location.hash;

    const checkHash = () => {
      const hash = window.location.hash;
      if (prevHash.startsWith("#scan-") && !hash && status === "done") {
        prevHash = hash;
        setStatus("idle");
        setResult(null);
        setScanHistoryId(null);
        setError(null);
        setErrorDetails(null);
        setSelectedIssue(null);
        setScanNotes("");
        setCrawlInfo(null);
        return;
      }
      if (hash.startsWith("#scan-") && status === "idle") {
        const id = hash.replace("#scan-", "");
        if (id && !isNaN(parseInt(id, 10))) {
          window.location.href = `/history#${id}`;
        }
      }
      prevHash = hash;
    };

    checkHash();
    window.addEventListener("hashchange", checkHash);
    return () => window.removeEventListener("hashchange", checkHash);
  }, [status]);

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

  const handleScan = useCallback(
    async (
      url: string,
      mode: ScanMode = "quick",
      scanners?: string[],
      protocol?: string,
    ) => {
      setPendingScanners(scanners);
      setScanningMode(mode);
      if (mode === "deep" && (!protocol || protocol.startsWith("http"))) {
        setPendingCrawlUrl(url);
        setShowCrawlSelector(true);
        setCrawlDiscovering(true);
        setCrawlDiscoveryUrls([url]);

        try {
          const res = await fetch(API.SCAN_CRAWL_DISCOVER, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
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

      runScanRef.current?.(url, undefined, scanners, mode);
    },
    [],
  );

  const runScan = useCallback(
    async (
      url: string,
      crawlUrls?: string[],
      scanners?: string[],
      mode: ScanMode = "quick",
    ) => {
      setStatus("scanning");
      setResult(null);
      setScanHistoryId(null);
      setError(null);
      setErrorDetails(null);
      setErrorStatus(null);
      setErrorUrl(null);
      setScanningUrl(url);
      setScanningMode(mode);
      setSelectedIssue(null);
      setScanNotes("");
      setCrawlInfo(null);

      const isCrawl = !!crawlUrls;
      const endpoint = isCrawl ? API.SCAN_CRAWL : API.SCAN;
      const payload = isCrawl
        ? { url, urls: crawlUrls, ...(scanners ? { scanners } : {}) }
        : { url, ...(scanners ? { scanners } : {}) };

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
          setError(data.error || "An unexpected error occurred.");
          setErrorDetails(data.details || null);
          setErrorStatus(response.status);
          setErrorUrl(url);
          setStatus("failed");
          return;
        }

        if (data.crawl && data.crawl.pages?.length > 0) {
          const mainPage = data.crawl.pages[0];
          setResult({
            ...data,
            findings: mainPage.findings,
            summary: mainPage.summary,
            duration: mainPage.duration,
          });
          setCrawlInfo(data.crawl);
        } else {
          setResult(data);
        }
        const historyId = data.scanHistoryId || null;
        setScanHistoryId(historyId);
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
      } catch {
        setError(
          "Failed to connect to the scanner. Please check your connection and try again.",
        );
        setErrorStatus(null);
        setErrorUrl(url);
        setStatus("failed");
      }
    },
    [updateUrlWithScan],
  );

  // Keep ref in sync with latest runScan so handleScan (defined earlier)
  // can call it without re-running on every callback recreation.
  useEffect(() => {
    runScanRef.current = runScan;
  }, [runScan]);

  function handleCrawlConfirm(selectedUrls: string[]) {
    setShowCrawlSelector(false);
    setCrawlDiscoveryUrls([]);
    runScan(pendingCrawlUrl, selectedUrls, pendingScanners, "deep");
  }

  function handleCrawlCancel() {
    setShowCrawlSelector(false);
    setCrawlDiscoveryUrls([]);
    setPendingCrawlUrl("");
    setCrawlDiscovering(false);
  }

  const handleBulkScan = useCallback(async (urls: string[]) => {
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
          body: JSON.stringify({ url: urls[i], source: "bulk" }),
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
  }, []);

  useEffect(() => {
    const scanUrl = searchParams.get("scan");
    if (scanUrl && status === "idle") {
      handleScan(scanUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function handleReset() {
    setStatus("idle");
    setResult(null);
    setScanHistoryId(null);
    setError(null);
    setErrorDetails(null);
    setSelectedIssue(null);
    setScanNotes("");
    setCrawlInfo(null);
    setShowCrawlSelector(false);
    setCrawlDiscoveryUrls([]);
    setPendingCrawlUrl("");
    setCrawlDiscovering(false);
    updateUrlWithScan(null);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <OnboardingTour />
      <Header />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 pb-12">
        {/* Scan form */}
        {status !== "done" && (
          <ScanForm
            onScan={handleScan}
            status={status}
            onBulkScan={handleBulkScan}
            bulkStatus={bulkStatus}
            bulkProgress={bulkProgress}
          />
        )}

        {/* Bulk scan result banner */}
        {bulkStatus === "done" && bulkResult && status === "idle" && (
          <DashboardBulkResult
            result={bulkResult}
            onDismiss={() => {
              setBulkResult(null);
              setBulkStatus("idle");
            }}
          />
        )}

        {/* Dashboard when idle */}
        {status === "idle" && <Dashboard />}

        {/* Scanning state */}
        {status === "scanning" && (
          <ScanningIndicator
            url={scanningUrl ?? undefined}
            mode={scanningMode}
          />
        )}

        {/* Error state */}
        {status === "failed" && error && (
          <DashboardErrorState
            error={error}
            details={errorDetails || undefined}
            url={errorUrl ?? undefined}
            status={errorStatus ?? undefined}
            onRetry={handleReset}
          />
        )}

        {/* Results */}
        {status === "done" && result && (
          <DashboardResults
            result={result}
            selectedIssue={selectedIssue}
            onSelectIssue={setSelectedIssue}
            scanHistoryId={scanHistoryId}
            scanNotes={scanNotes}
            crawlInfo={crawlInfo}
            onReset={handleReset}
            onScanSubdomain={(subUrl) => handleScan(subUrl)}
            onSaveNotes={handleSaveNotes}
          />
        )}
      </main>

      <Footer />

      {/* Crawl URL selector modal */}
      {showCrawlSelector && (
        <CrawlUrlSelector
          urls={crawlDiscoveryUrls}
          isLoading={crawlDiscovering}
          onConfirm={handleCrawlConfirm}
          onCancel={handleCrawlCancel}
        />
      )}

      {/* Scan limit upgrade modal */}
      <PremiumUpgradeModal
        open={showLimitModal}
        onOpenChange={setShowLimitModal}
        feature={PREMIUM_FEATURES.scan_limit}
        currentPlan={me?.plan || "free"}
      />
    </div>
  );
}
