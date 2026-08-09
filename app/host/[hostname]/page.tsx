"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  Check,
  Clock,
  Copy,
  ExternalLink,
  ScanSearch,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { ScanSummary } from "@/components/scanner/scan-summary";
import { ResultsList } from "@/components/scanner/results-list";
import { IssueDetail } from "@/components/scanner/issue-detail";
import { ScanActionsMenu } from "@/components/scanner/scan-actions-menu";
import { AuthenticatedBadge } from "@/components/scanner/authenticated-badge";
import { ResponseHeaders } from "@/components/scanner/response-headers";
import { SharedScanSkeleton } from "@/components/scanner/shared-scan-skeleton";
import {
  API,
  APP_NAME,
  ROUTES,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/constants";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import { cn } from "@/lib/ui/utils";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import type { HostReportData } from "@/app/api/v3/host/[hostname]/route";

const VERDICT = {
  safe: {
    label: "No exploitable issues found",
    icon: ShieldCheck,
    rail: "bg-[hsl(var(--success))]",
    text: "text-[hsl(var(--success))]",
  },
  caution: {
    label: "Review before trusting this host",
    icon: ShieldAlert,
    rail: "bg-[hsl(var(--severity-medium))]",
    text: "text-[hsl(var(--severity-medium))]",
  },
  unsafe: {
    label: "Actively exploitable issues found",
    icon: ShieldX,
    rail: "bg-[hsl(var(--severity-critical))]",
    text: "text-[hsl(var(--severity-critical))]",
  },
} as const;

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function HostReportPage() {
  const params = useParams();
  const hostname = params.hostname as string;

  const [data, setData] = useState<HostReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(API.HOST(hostname));
        if (!res.ok) {
          if (!cancelled) setError("Could not load this host's report.");
          return;
        }
        const body: HostReportData = await res.json();
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled) setError("Could not load this host's report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [hostname]);

  async function copyHost() {
    try {
      await navigator.clipboard.writeText(data?.host || hostname);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
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
        }
      : null;

  const verdict = result ? VERDICT[getSafetyRating(result.findings)] : null;
  const VerdictIcon = verdict?.icon;

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
              <h1 className="text-lg font-semibold text-foreground">
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
              <h1 className="text-lg font-semibold text-foreground">
                {data.host} hasn&rsquo;t been scanned yet
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                No public {APP_NAME} scan has run against this host. Run one
                and, unless you mark it private, this page fills in with the
                result.
              </p>
            </div>
            <Button asChild size="lg" className="h-11 gap-2 px-6">
              <Link href={ROUTES.DEMO}>
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
                <header className="relative overflow-hidden rounded-md border border-border bg-card">
                  {verdict && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-x-0 top-0 h-1",
                        verdict.rail,
                      )}
                    />
                  )}
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
                            className="group inline-flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          >
                            <h1 className="truncate text-lg font-semibold text-foreground sm:text-xl">
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
                        {verdict && VerdictIcon && (
                          <p
                            className={cn(
                              "mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium",
                              verdict.text,
                            )}
                          >
                            <VerdictIcon aria-hidden className="h-4 w-4" />
                            {verdict.label}
                          </p>
                        )}
                      </div>
                      <a
                        href={result.url}
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

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock aria-hidden className="h-3.5 w-3.5" />
                        Scanned {formatRelativeTime(new Date(result.scannedAt))}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Shield aria-hidden className="h-3.5 w-3.5" />
                        {result.checksRun || TOTAL_CHECKS_LABEL} checks run
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Shield aria-hidden className="h-3.5 w-3.5" />
                        {result.summary.total}{" "}
                        {result.summary.total === 1 ? "finding" : "findings"}
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        <ScanActionsMenu result={result} isOwner={false} />
                      </span>
                    </div>
                  </div>
                </header>

                <ScanSummary result={result} hideHeader hideDuration />

                {result.responseHeaders &&
                  Object.keys(result.responseHeaders).length > 0 && (
                    <div className="flex flex-col gap-3 border-t border-border/50 pt-5">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        More about this host
                      </h2>
                      <ResponseHeaders headers={result.responseHeaders} />
                    </div>
                  )}

                {result.findings.length > 0 ? (
                  <ResultsList
                    findings={result.findings}
                    onSelectIssue={setSelectedIssue}
                  />
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-card/50 px-4 py-10 text-center">
                    <p className="text-sm font-semibold text-[hsl(var(--success))]">
                      Nothing found on this scan
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Every enabled check ran against this host and none of them
                      fired.
                    </p>
                  </div>
                )}

                <div className="flex flex-col items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
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
