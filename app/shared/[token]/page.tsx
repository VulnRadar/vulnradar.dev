"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  ScanSearch,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Tag,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { ScanSummary } from "@/components/scanner/scan-summary";
import { ResultsList } from "@/components/scanner/results-list";
import { IssueDetail } from "@/components/scanner/issue-detail";
import { ExportButton } from "@/components/scanner/export-button";
import { ViewPageButton } from "@/components/scanner/view-page-button";
import { ResponseHeaders } from "@/components/scanner/response-headers";
import {
  SubdomainDiscovery,
  type DiscoveryResult,
} from "@/components/scanner/subdomain-discovery";
import {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
  API,
  APP_NAME,
  ROUTES,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/constants";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import { cn } from "@/lib/ui/utils";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

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

export default function SharedScanPage() {
  const params = useParams();
  const token = params.token as string;

  const [result, setResult] = useState<ScanResult | null>(null);
  const [scannedBy, setScannedBy] = useState("");
  const [scannedByAvatar, setScannedByAvatar] = useState<string | null>(null);
  const [scannedByRole, setScannedByRole] = useState<string>("user");
  const [scannedByBadges, setScannedByBadges] = useState<
    {
      id: number;
      name: string;
      display_name: string;
      icon: string | null;
      color: string | null;
      priority: number;
    }[]
  >([]);
  const [scanNotes, setScanNotes] = useState("");
  const [subdomainCache, setSubdomainCache] = useState<DiscoveryResult | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API.SHARED}/${token}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "This shared scan could not be found.");
          return;
        }
        const data = await res.json();
        setResult(data);
        setScannedBy(data.scannedBy || "");
        setScannedByAvatar(data.scannedByAvatar || null);
        setScannedByRole(data.scannedByRole || "user");
        setScannedByBadges(data.scannedByBadges || []);
        setScanNotes(data.notes || "");
        setSubdomainCache(data.subdomainCache ?? null);
      } catch {
        setError("Failed to load shared scan.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(result?.url || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }

  const verdict = result ? VERDICT[getSafetyRating(result.findings)] : null;
  const VerdictIcon = verdict?.icon;

  return (
    <PublicPageShell
      badge="Shared Report"
      maxWidth="max-w-5xl"
      padding="py-6 sm:py-8"
    >
      <div className="flex flex-col gap-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-24">
            <Loader2
              aria-hidden
              className="h-5 w-5 animate-spin text-primary"
            />
            <p className="text-sm text-muted-foreground">
              Loading the shared report
            </p>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center gap-5 py-20 text-center">
            <CircleAlert aria-hidden className="h-8 w-8 text-destructive" />
            <div className="flex max-w-sm flex-col gap-2">
              <h1 className="text-lg font-semibold text-foreground">
                This link doesn&rsquo;t work anymore
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {error} The person who shared it may have revoked access, or the
                link was typed wrong.
              </p>
            </div>
            <Button asChild className="gap-2">
              <Link href={ROUTES.SIGNUP}>
                Scan your own site with {APP_NAME}
                <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}

        {!loading && result && (
          <div className="flex flex-col gap-5">
            {selectedIssue ? (
              <IssueDetail
                issue={selectedIssue}
                onBack={() => setSelectedIssue(null)}
              />
            ) : (
              <>
                {/* First screen: what this is, who ran it, and the verdict, all above the fold. */}
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
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        A {APP_NAME} security report, shared as a read-only
                        link. No account needed to view it.
                      </p>
                      {scannedBy && (
                        <div className="flex items-center gap-1.5">
                          {scannedByAvatar ? (
                            <Image
                              src={scannedByAvatar}
                              alt=""
                              width={18}
                              height={18}
                              className="h-[18px] w-[18px] rounded-full object-cover"
                            />
                          ) : (
                            <User
                              aria-hidden
                              className="h-3.5 w-3.5 text-muted-foreground"
                            />
                          )}
                          <span className="text-xs text-muted-foreground">
                            Shared by{" "}
                            <span className="font-medium text-foreground">
                              {scannedBy}
                            </span>
                          </span>
                          {scannedByRole !== STAFF_ROLES.USER &&
                            ROLE_BADGE_STYLES[scannedByRole] && (
                              <span
                                className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ROLE_BADGE_STYLES[scannedByRole]}`}
                              >
                                {STAFF_ROLE_LABELS[scannedByRole] ||
                                  scannedByRole}
                              </span>
                            )}
                          {scannedByBadges.slice(0, 2).map((badge) => (
                            <span
                              key={badge.id}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: `${badge.color}15`,
                                borderWidth: 1,
                                borderColor: `${badge.color}40`,
                                color: badge.color || undefined,
                              }}
                            >
                              <Tag aria-hidden className="h-2.5 w-2.5" />
                              {badge.display_name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={copyUrl}
                          aria-label="Copy scanned URL"
                          className="group inline-flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                          <h1 className="truncate text-lg font-semibold text-foreground sm:text-xl">
                            {result.url}
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
                        {formatRelativeTime(new Date(result.scannedAt))}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Shield aria-hidden className="h-3.5 w-3.5" />
                        {result.checksRun || TOTAL_CHECKS_LABEL} checks run
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        <ViewPageButton url={result.url} />
                        <ExportButton result={result} />
                      </span>
                    </div>
                  </div>
                </header>

                <ScanSummary result={result} hideHeader />

                <div className="flex flex-col gap-3 border-t border-border/50 pt-5">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    More about this host
                  </h2>
                  {result.responseHeaders &&
                    Object.keys(result.responseHeaders).length > 0 && (
                      <ResponseHeaders headers={result.responseHeaders} />
                    )}
                  <SubdomainDiscovery
                    url={result.url}
                    readOnly
                    cachedResult={subdomainCache}
                  />
                </div>

                {/* Findings first, same order a logged-in user sees. */}
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

                {scanNotes && (
                  <div className="rounded-md border border-border bg-card p-4">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Note from the person who shared this
                    </h3>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                      {scanNotes}
                    </p>
                  </div>
                )}

                {/* Converts the anonymous visitor: this is the page that sells the product. */}
                <div className="flex flex-col items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <ScanSearch
                      aria-hidden
                      className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                    />
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Run this against your own site
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {TOTAL_CHECKS_LABEL} checks, no signup required to see
                        the first result.
                      </p>
                    </div>
                  </div>
                  <Button
                    asChild
                    size="lg"
                    className="h-11 w-full shrink-0 gap-2 px-6 sm:w-auto"
                  >
                    <Link href={ROUTES.SIGNUP}>
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
