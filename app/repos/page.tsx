"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Check,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { API, ROUTES } from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";
import { useQueryParam } from "@/lib/ui/url-state";
import { GithubRepoPickerModal } from "@/components/repos/github-repo-picker-modal";
import { GithubScanResultModal } from "@/components/repos/github-scan-result-modal";
import { RepoDetail } from "@/components/repos/repo-detail";
import { ReposSkeleton } from "@/components/repos/repos-skeleton";
import {
  SEVERITY_ORDER,
  SEVERITY_TONE,
} from "@/components/scanner/severity-badge";
import type {
  GithubRepo,
  GithubScanOutcome,
  RepoScanSummary,
} from "@/components/repos/types";
import type { ScanResult, Severity } from "@/lib/scanner/types";

/**
 * Compact per-severity counts for a repo's last scan, shown directly in the
 * list row so the gist of a repo's history doesn't require clicking in --
 * only "not this" (findings count alone) or "click through" (full timeline)
 * existed before. Skips "info" here: it's rarely the reason to look twice at
 * a row, and this needs to stay a single line at list density.
 */
function RowSeverityChips({
  summary,
}: {
  summary: RepoScanSummary["lastScan"]["summary"];
}) {
  const present = SEVERITY_ORDER.filter(
    (s): s is Exclude<Severity, "info"> =>
      s !== "info" && (summary[s] ?? 0) > 0,
  );
  if (present.length === 0) {
    return (
      <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-[hsl(var(--success))]">
        <ShieldAlert className="h-3 w-3" aria-hidden="true" />
        Clean
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
      {present.map((s) => (
        <span
          key={s}
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
            SEVERITY_TONE[s].text,
          )}
        >
          <span
            aria-hidden
            className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_TONE[s].solid)}
          />
          {summary[s]} {SEVERITY_TONE[s].label.toLowerCase()}
        </span>
      ))}
    </span>
  );
}

// lucide-react dropped brand/logo icons; every brand mark elsewhere in this
// app (Discord, GithubRepoPickerModal, the Social tab's FaGithub) duplicates
// its own inline SVG for the same reason.
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.69.08-.69 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 2.87-.39c.97.01 1.95.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.8 1.18 1.83 1.18 3.09 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .3.2.66.79.55A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

function formatRelativeScan(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

interface GithubStatus {
  connected: boolean;
  githubUsername?: string;
  selectedRepos?: string[];
}

export default function ReposPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [status, setStatus] = useState<GithubStatus>({ connected: false });
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoFilter, setRepoFilter] = useState("");
  const [scanningRepo, setScanningRepo] = useState<string | null>(null);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanModalOutcome, setScanModalOutcome] =
    useState<GithubScanOutcome | null>(null);
  const [scanModalError, setScanModalError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, RepoScanSummary>>(
    {},
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  const [activeRepoName, setActiveRepoName] = useQueryParam<string>("repo", "");

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(t);
    }
  }, [success]);
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const loadSummaries = useCallback(async () => {
    try {
      const res = await fetch(API.SCAN_GITHUB_HISTORY);
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, RepoScanSummary> = {};
      for (const s of data.summaries as RepoScanSummary[]) map[s.repo] = s;
      setSummaries(map);
    } catch {
      /* the list still works without "last scanned" info */
    }
  }, []);

  const loadWorkingSet = useCallback(async (names: string[]) => {
    if (names.length === 0) {
      setRepos([]);
      return;
    }
    setReposLoading(true);
    try {
      const res = await fetch(API.ACCOUNT_GITHUB_REPOS);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load repositories.");
        setRepos([]);
        return;
      }
      const nameSet = new Set(names);
      setRepos(
        (data.repos as GithubRepo[]).filter((r) => nameSet.has(r.fullName)),
      );
    } catch {
      setError("Failed to load repositories.");
      setRepos([]);
    }
    setReposLoading(false);
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const res = await fetch(API.ACCOUNT_GITHUB);
        const data: GithubStatus = await res.json();
        setStatus(data);
        if (data.connected && data.selectedRepos?.length) {
          await Promise.all([
            loadWorkingSet(data.selectedRepos),
            loadSummaries(),
          ]);
        }
      } catch {
        setError("Failed to load your GitHub connection status.");
      }
      setLoading(false);
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirmSelection = async (
    selected: string[],
    fetchedRepos: GithubRepo[],
  ) => {
    const res = await fetch(API.ACCOUNT_GITHUB_REPOS, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected }),
    });
    const data = await res.json().catch(() => ({}) as { error?: string });
    if (!res.ok) {
      throw new Error(data.error || "Failed to save your selection.");
    }
    setStatus((prev) => ({ ...prev, selectedRepos: selected }));
    setRepos(fetchedRepos.filter((r) => selected.includes(r.fullName)));
    setSuccess(
      selected.length > 0
        ? `${selected.length} repo${selected.length === 1 ? "" : "s"} loaded.`
        : "Selection cleared.",
    );
    loadSummaries();
  };

  const handleScan = useCallback(
    async (repoFullName: string): Promise<GithubScanOutcome | null> => {
      setScanningRepo(repoFullName);
      setScanModalOutcome(null);
      setScanModalError(null);
      setScanModalOpen(true);
      try {
        const res = await fetch(API.SCAN_GITHUB, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoFullName }),
        });
        const data = await res.json();
        if (!res.ok) {
          const message = data.error || "Failed to scan this repository.";
          setScanModalError(message);
          return null;
        }
        const {
          scanHistoryId,
          ref,
          filesScanned,
          filesSkippedByCaps,
          aiTokensUsed,
          aiReviewSkipped,
          ...result
        } = data;
        const scanResult = result as ScanResult;
        setSummaries((prev) => ({
          ...prev,
          [repoFullName]: {
            repo: repoFullName,
            lastScan: {
              id: scanHistoryId ?? -1,
              summary: scanResult.summary,
              findingsCount: scanResult.summary.total,
              duration: scanResult.duration,
              scannedAt: scanResult.scannedAt,
            },
            scanCount: (prev[repoFullName]?.scanCount ?? 0) + 1,
          },
        }));
        const outcome: GithubScanOutcome = {
          result: scanResult,
          scanHistoryId: scanHistoryId ?? null,
          ref: ref ?? "",
          filesScanned: filesScanned ?? 0,
          filesSkippedByCaps: filesSkippedByCaps ?? 0,
          aiTokensUsed: aiTokensUsed ?? 0,
          aiReviewSkipped: Boolean(aiReviewSkipped),
        };
        setScanModalOutcome(outcome);
        return outcome;
      } catch {
        setScanModalError("Failed to scan this repository.");
        return null;
      } finally {
        setScanningRepo(null);
      }
    },
    [],
  );

  if (loading) {
    return <ReposSkeleton />;
  }

  const activeRepo = activeRepoName
    ? (repos ?? []).find((r) => r.fullName === activeRepoName)
    : undefined;

  const filteredRepos = (repos ?? []).filter((repo) => {
    const q = repoFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      repo.fullName.toLowerCase().includes(q) ||
      (repo.description ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-5">
        {(error || success) && (
          <div
            role={error ? "alert" : "status"}
            aria-live={error ? "assertive" : "polite"}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl text-sm border",
              error
                ? "bg-destructive/10 text-destructive border-destructive/20"
                : "bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.2)]",
            )}
          >
            {error ? (
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span className="flex-1">{error || success}</span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setSuccess(null);
              }}
              className="text-xs font-medium hover:underline opacity-70 hover:opacity-100 transition-opacity rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Dismiss
            </button>
          </div>
        )}

        {!status.connected ? (
          <div className="flex flex-col gap-1 pt-6">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Repos
            </h1>
            <p className="text-sm text-muted-foreground max-w-prose">
              Run a security review on your repo source: any kind of repo, not
              just web apps. Bots, games, CLIs, libraries, whatever -- the AI
              review looks for hardcoded secrets, SQL/command injection, and
              other code-level issues, not URL/HTTP problems.
            </p>
            <div className="mt-4 rounded-lg border border-dashed border-border px-5 py-8 text-center max-w-lg">
              <p className="text-sm text-foreground font-medium">
                Repo access hasn&apos;t been granted yet
              </p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Grant access from your GitHub connection in Social settings,
                then come back here to pick repos.
              </p>
              <Button asChild className="gap-2">
                <Link href={`${ROUTES.PROFILE}?tab=social`}>
                  <GithubIcon className="h-4 w-4" />
                  Go to Social settings
                </Link>
              </Button>
            </div>
          </div>
        ) : activeRepo ? (
          <RepoDetail
            repo={activeRepo}
            onBack={() => setActiveRepoName(null)}
            onScan={handleScan}
            scanning={scanningRepo === activeRepo.fullName}
          />
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 flex-wrap pt-2">
              <div>
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                  Repos
                </h1>
                <p className="text-sm text-muted-foreground mt-1 max-w-prose">
                  Source review for {status.githubUsername}&apos;s repos:
                  hardcoded secrets, injection bugs, and other code-level
                  issues. Any kind of repo works, this isn&apos;t web-app-only.
                </p>
              </div>
              {repos && repos.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shrink-0"
                  onClick={() => setPickerOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit selection
                </Button>
              )}
            </div>

            {reposLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              </div>
            ) : !repos || repos.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center max-w-lg">
                <p className="text-sm text-foreground font-medium">
                  No repos selected yet
                </p>
                <p className="text-sm text-muted-foreground mt-1 mb-4">
                  Pick which of your repos should show up here.
                </p>
                <Button className="gap-2" onClick={() => setPickerOpen(true)}>
                  <GithubIcon className="h-4 w-4" />
                  Select repositories
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    placeholder="Search your repos..."
                    value={repoFilter}
                    onChange={(e) => setRepoFilter(e.target.value)}
                    aria-label="Search your GitHub repositories"
                    className="pl-9 bg-background"
                  />
                </div>

                {filteredRepos.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No repos match &quot;{repoFilter}&quot;.
                  </p>
                ) : (
                  <div className="rounded-lg border border-border divide-y divide-border/60 overflow-hidden">
                    {filteredRepos.map((repo) => {
                      const summary = summaries[repo.fullName];
                      return (
                        <div
                          key={repo.fullName}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                        >
                          {repo.private ? (
                            <Lock
                              className="h-4 w-4 text-muted-foreground shrink-0"
                              aria-hidden="true"
                            />
                          ) : (
                            <GithubIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <button
                            type="button"
                            onClick={() => setActiveRepoName(repo.fullName)}
                            className="flex-1 min-w-0 text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <p className="text-sm font-medium text-foreground truncate hover:underline">
                              {repo.fullName}
                            </p>
                            {summary ? (
                              <span className="flex flex-col gap-0.5">
                                <RowSeverityChips
                                  summary={summary.lastScan.summary}
                                />
                                <span className="text-[11px] text-muted-foreground">
                                  {summary.scanCount} scan
                                  {summary.scanCount === 1 ? "" : "s"}
                                </span>
                              </span>
                            ) : repo.description ? (
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {repo.description}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground/70 mt-0.5">
                                Not scanned yet
                              </p>
                            )}
                          </button>
                          <span className="hidden sm:inline text-[11px] text-muted-foreground shrink-0 tabular-nums">
                            updated {formatRelativeScan(repo.updatedAt)}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={scanningRepo === repo.fullName}
                            onClick={() => handleScan(repo.fullName)}
                            className="shrink-0 gap-1.5"
                          >
                            {scanningRepo === repo.fullName ? (
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <RefreshCw
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            )}
                            {summary ? "Rescan" : "Scan"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <GithubRepoPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialSelected={status.selectedRepos ?? []}
        onConfirm={handleConfirmSelection}
      />

      <GithubScanResultModal
        open={scanModalOpen}
        onOpenChange={setScanModalOpen}
        loading={scanningRepo !== null}
        repoFullName={scanningRepo}
        error={scanModalError}
        outcome={scanModalOutcome}
      />

      <Footer />
    </div>
  );
}
