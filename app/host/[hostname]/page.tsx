"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { safeHref } from "@/lib/ui/utils";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  ScanSearch,
  ShieldQuestion,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { IssueDetail } from "@/components/scanner/issue-detail";
import { ScanActionsMenu } from "@/components/scanner/scan-actions-menu";
import { AuthenticatedBadge } from "@/components/scanner/authenticated-badge";
import { ScanResultDetail } from "@/components/scanner/scan-result-detail";
import { SubdomainDiscovery } from "@/components/scanner/subdomain-discovery";
import { SharedScanSkeleton } from "@/components/scanner/shared-scan-skeleton";
import { ScanTags } from "@/components/history/scan-tags";
// Statically imported, this one component pulled recharts (about 378 KB raw,
// 112 KB gzipped, a quarter of this route's JavaScript) into the initial
// bundle of a public page, for a chart that only renders when the host has
// two or more public scans on record. Loaded on demand instead: the
// component's own loading state reserves the space, so nothing jumps.
const DangerScoreTrend = dynamic(
  () =>
    import("@/components/host/danger-score-trend").then((m) => ({
      default: m.DangerScoreTrend,
    })),
  { ssr: false },
);
import { API, APP_NAME, ROUTES } from "@/lib/config/client-constants";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import type { HostReportData } from "@/app/api/v3/host/[hostname]/route";
import type { HostScoreTrendPoint } from "@/app/api/v3/host/[hostname]/trend/route";
import { copyToClipboard } from "@/lib/ui/clipboard";

export default function HostReportPage() {
  const params = useParams();
  const hostname = params.hostname as string;

  const [data, setData] = useState<HostReportData | null>(null);
  // undefined until the pair below resolves, then an array on success or null
  // on failure -- exactly the contract DangerScoreTrend's `points` prop takes.
  const [trendPoints, setTrendPoints] = useState<
    HostScoreTrendPoint[] | null | undefined
  >(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  // Only show a back button when we arrived via in-app navigation (e.g.
  // clicked from Assets or the Public Scans directory) -- document.referrer
  // is same-origin in that case. A link opened directly (typed URL, shared
  // externally, a new tab) has no page to go back to, so router.back()
  // would either do nothing or leave the app; hiding the button in that
  // case is more honest than showing one that doesn't work. Same pattern
  // as app/shared/[token]/page.tsx.
  const [canGoBack, setCanGoBack] = useState(false);
  const router = useRouter();

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads document.referrer (unavailable during SSR) to seed initial value
      setCanGoBack(
        !!document.referrer &&
          new URL(document.referrer).origin === window.location.origin,
      );
    } catch {
      setCanGoBack(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // The trend endpoint keys only off the hostname in the URL, so it
      // shares nothing with the host report but the hostname. It used to be
      // issued by DangerScoreTrend, which is mounted inside the `result &&`
      // gate below, so it could not start until this request had already
      // resolved: two serialized round trips on an indexable public page.
      // Both start together now and the chart is handed what it needs.
      const [report, trend] = await Promise.all([
        fetch(API.HOST(hostname))
          .then(async (res) =>
            res.ok ? ((await res.json()) as HostReportData) : null,
          )
          .catch(() => null),
        // null means "the request failed", which is what DangerScoreTrend
        // renders its own "could not be loaded" copy for. An empty array is
        // a successful answer of "no scans on record".
        fetch(API.HOST_TREND(hostname))
          .then(async (res) =>
            res.ok
              ? (((await res.json()) as { points?: HostScoreTrendPoint[] })
                  .points ?? [])
              : null,
          )
          .catch(() => null),
      ]);
      if (cancelled) return;
      if (report) setData(report);
      else setError("Could not load this host's report.");
      setTrendPoints(trend);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [hostname]);

  async function copyHost() {
    if (await copyToClipboard(data?.host || hostname)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const result: ScanResult | null =
    data && data.known
      ? {
          url: `https://${data.host}`,
          scannedAt: data.lastScannedAt || new Date().toISOString(),
          duration: 0,
          findings: data.findings,
          summary: {
            critical: data.severityCounts?.critical ?? 0,
            high: data.severityCounts?.high ?? 0,
            medium: data.severityCounts?.medium ?? 0,
            low: data.severityCounts?.low ?? 0,
            info: data.severityCounts?.info ?? 0,
            total: data.findings.length,
          },
          responseHeaders: data.responseHeaders ?? undefined,
          dangerScore: data.dangerScore ?? undefined,
          checksRun: data.checksRun,
          engineConfidence: data.engineConfidence,
          incomplete: data.incomplete,
          authenticated: data.authenticated,
          aiSummary: data.aiSummary,
          // The rest of the public result_meta, so the shared renderer shows the
          // same detail here as on /shared instead of this surface silently
          // dropping it (how the SSL grade went missing on this page).
          sslGrade: data.sslGrade,
          threatIntel: data.threatIntel,
          softwareInventory: data.softwareInventory,
          dnsRecords: data.dnsRecords,
          portScan: data.portScan,
          subdomains: data.subdomains,
        }
      : null;

  return (
    <PublicPageShell
      badge="Host Report"
      maxWidth="max-w-5xl"
      padding="py-6 sm:py-8"
    >
      <div className="flex flex-col gap-6">
        {loading && <SharedScanSkeleton />}

        {!loading && error && (
          <div className="flex flex-col items-center gap-5 py-20 text-center">
            <ShieldQuestion
              aria-hidden
              className="h-8 w-8 text-muted-foreground"
            />
            <div className="flex max-w-sm flex-col gap-2">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
                Something went wrong
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {error}
              </p>
            </div>
          </div>
        )}

        {!loading && !error && data && !data.known && (
          <div className="flex flex-col items-center gap-5 py-20 text-center">
            <ShieldQuestion
              aria-hidden
              className="h-9 w-9 text-muted-foreground"
            />
            <div className="flex max-w-md flex-col gap-2">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
                {data.host} hasn&rsquo;t been scanned yet
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                No public {APP_NAME} scan has run against this host. Run one
                and, unless you mark it private, this page fills in with the
                result.
              </p>
            </div>
            <Button asChild size="lg" className="h-11 gap-2 px-6">
              {/* /demo used to ignore the host entirely: its only action
                  hardcoded window.location.origin, so a button reading
                  "Scan example.com now" scanned this deployment. ?url= hands
                  it the real target. */}
              <Link
                href={`${ROUTES.DEMO}?url=${encodeURIComponent(data.host)}`}
              >
                Scan {data.host} now
                <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}

        {!loading && !error && result && (
          <div className="flex flex-col gap-5">
            {selectedIssue ? (
              <IssueDetail
                issue={selectedIssue}
                onBack={() => setSelectedIssue(null)}
              />
            ) : (
              <>
                {canGoBack && (
                  <button
                    type="button"
                    onClick={() => router.back()}
                    className="group inline-flex w-fit items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ArrowLeft
                      aria-hidden
                      className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
                    />
                    Back
                  </button>
                )}

                <header className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex flex-col gap-4 p-5 sm:p-6">
                    <p className="text-xs text-muted-foreground">
                      The latest public {APP_NAME} scan of this host. Anyone
                      with this link can see it; no account needed.
                    </p>

                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={copyHost}
                            aria-label="Copy hostname"
                            className="group inline-flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {/* title, because the button's aria-label names
                                the action and not the value, so a clipped
                                host had no full form anywhere on the page. */}
                            <h1
                              title={data?.host}
                              className="truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
                            >
                              {data?.host}
                            </h1>
                            {copied ? (
                              <Check
                                aria-hidden
                                className="h-4 w-4 shrink-0 text-[hsl(var(--success))]"
                              />
                            ) : (
                              <Copy
                                aria-hidden
                                className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                              />
                            )}
                          </button>
                          {result.authenticated && (
                            <AuthenticatedBadge className="shrink-0" />
                          )}
                        </div>
                      </div>
                      <a
                        href={safeHref(result.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0"
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 bg-transparent"
                        >
                          <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                          Visit site
                        </Button>
                      </a>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
                      <ScanTags
                        scanId={0}
                        tags={(data?.autoTags ?? []).map((tag) => ({
                          tag,
                          source: "auto" as const,
                        }))}
                        onAdd={() => {}}
                        onRemove={() => {}}
                        readOnly
                        revealOnHover={false}
                      />
                      <ScanActionsMenu result={result} isOwner={false} />
                    </div>
                  </div>
                </header>

                <ScanResultDetail
                  result={result}
                  onSelectIssue={setSelectedIssue}
                  hideDuration
                  afterSummary={
                    <DangerScoreTrend
                      hostname={data?.host || hostname}
                      points={trendPoints}
                    />
                  }
                  subdomain={
                    result.subdomains ? (
                      <SubdomainDiscovery
                        url={result.url}
                        readOnly
                        cachedResult={result.subdomains}
                      />
                    ) : undefined
                  }
                />

                <div className="flex flex-col items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <ScanSearch
                      aria-hidden
                      className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                    />
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Scan your own site
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        Same {result.summary.total > 0 ? "checks" : "engine"},
                        no signup required to see the first result.
                      </p>
                    </div>
                  </div>
                  <Button
                    asChild
                    size="lg"
                    className="h-11 w-full shrink-0 gap-2 px-6 sm:w-auto"
                  >
                    <Link href={ROUTES.DEMO}>
                      Scan a URL
                      <ArrowRight aria-hidden className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </PublicPageShell>
  );
}
