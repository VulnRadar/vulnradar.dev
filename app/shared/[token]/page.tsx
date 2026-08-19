"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  ScanSearch,
  Tag,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { ScanSummary } from "@/components/scanner/scan-summary";
import { ResultsList } from "@/components/scanner/results-list";
import { IssueDetail } from "@/components/scanner/issue-detail";
import { ScanActionsMenu } from "@/components/scanner/scan-actions-menu";
import { AuthenticatedBadge } from "@/components/scanner/authenticated-badge";
import { CrawlPagesInfo } from "@/components/scanner/crawl-pages-info";
import { ResponseHeaders } from "@/components/scanner/response-headers";
import { DnsRecordsPanel } from "@/components/scanner/dns-records-panel";
import { ScreenshotPanel } from "@/components/scanner/screenshot-panel";
import { SharedScanSkeleton } from "@/components/scanner/shared-scan-skeleton";
import {
  SubdomainDiscovery,
  type DiscoveryResult,
} from "@/components/scanner/subdomain-discovery";
import { ScanTags } from "@/components/history/scan-tags";
import type { ScanTag } from "@/components/history/history-types";
import {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
  API,
  APP_NAME,
  ROUTES,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/constants";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import { copyToClipboard } from "@/lib/ui/clipboard";

/** Mirrors app/history/page.tsx's shape for the same crawl result_meta. */
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
  const [scanId, setScanId] = useState<number | null>(null);
  const [tags, setTags] = useState<ScanTag[]>([]);
  const [subdomainCache, setSubdomainCache] = useState<DiscoveryResult | null>(
    null,
  );
  const [crawlInfo, setCrawlInfo] = useState<CrawlInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  // Always offer a way back. Client-side (Link) navigation does not update
  // document.referrer, so an in-app arrival can look like a direct hit; the
  // history length is the reliable signal. When there is nowhere in-app to
  // return to (a link opened cold from Discord, email, or a typed URL), fall
  // back to the site home instead of hiding the control or a back() that
  // would leave the app.
  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

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
        setScanId(data.scanId ?? null);
        setTags(data.tags || []);
        setSubdomainCache(data.subdomainCache ?? null);
        if (data.crawl && data.crawl.pages?.length > 0) {
          setCrawlInfo(data.crawl);
        }
      } catch {
        setError("Failed to load shared scan.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  async function copyUrl() {
    if (await copyToClipboard(result?.url || "")) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <PublicPageShell
      badge="Shared Report"
      maxWidth="max-w-5xl"
      padding="py-6 sm:py-8"
    >
      <div className="flex flex-col gap-6">
        {loading && <SharedScanSkeleton />}

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
                <button
                  type="button"
                  onClick={handleBack}
                  className="group inline-flex w-fit items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowLeft
                    aria-hidden
                    className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
                  />
                  Back
                </button>

                {/* First screen: what this is and who shared it. The verdict
                    itself (safe/caution/unsafe, severity breakdown) lives in
                    ScanSummary directly below -- showing it here too was
                    just the same story told twice. */}
                <header className="overflow-hidden rounded-md border border-border bg-card">
                  <div className="flex flex-col gap-4 p-5 sm:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        A {APP_NAME} security report, shared as a read-only
                        link. No account needed to view it.
                      </p>
                      {scannedBy && (
                        <div className="flex flex-wrap items-center gap-1.5">
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
                        <div className="flex min-w-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={copyUrl}
                            aria-label="Copy scanned URL"
                            className="group inline-flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                          {result.authenticated && (
                            <AuthenticatedBadge className="shrink-0" />
                          )}
                        </div>
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

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
                      <ScanTags
                        scanId={scanId ?? 0}
                        tags={tags}
                        onAdd={() => {}}
                        onRemove={() => {}}
                        readOnly
                        revealOnHover={false}
                      />
                      <ScanActionsMenu result={result} isOwner={false} />
                    </div>
                  </div>
                </header>

                <ScanSummary result={result} hideHeader />

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
                  {result.screenshot && (
                    <ScreenshotPanel
                      src={`${API.SHARED}/${token}/screenshot`}
                      url={result.url}
                      width={result.screenshot.width}
                      height={result.screenshot.height}
                      capturedAt={result.screenshot.capturedAt}
                    />
                  )}
                  {result.responseHeaders &&
                    Object.keys(result.responseHeaders).length > 0 && (
                      <ResponseHeaders headers={result.responseHeaders} />
                    )}
                  <DnsRecordsPanel records={result.dnsRecords} />
                  <SubdomainDiscovery
                    url={result.url}
                    readOnly
                    cachedResult={result.subdomains ?? subdomainCache}
                  />
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
