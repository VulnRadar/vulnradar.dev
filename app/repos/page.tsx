"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { API, ROUTES } from "@/lib/config/client-constants";
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
  /** A failed *load*, as opposed to a failed action. Never auto-dismissed. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summariesFailed, setSummariesFailed] = useState(false);
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
  // Lets closing the scan modal mid-request actually abort the
  // POST /api/v3/scan/github fetch instead of just hiding the UI while it
  // keeps running in the background -- repo scans can take up to a minute.
  const scanAbortRef = useRef<AbortController | null>(null);
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
  // Only the action banner auto-dismisses. `error` is feedback on something
  // the user just did ("that scan could not be started"), so eight seconds is
  // long enough to read it and it should not linger. A failed *load* is a
  // different thing: the empty list it explains stays on screen forever, so
  // it lives in loadError below, which never times out and offers a retry.
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const loadSummaries = useCallback(async () => {
    try {
      const res = await fetch(API.SCAN_GITHUB_HISTORY);
      if (!res.ok) {
        setSummariesFailed(true);
        return;
      }
      const data = await res.json();
      const map: Record<string, RepoScanSummary> = {};
      for (const s of data.summaries as RepoScanSummary[]) map[s.repo] = s;
      setSummaries(map);
      setSummariesFailed(false);
    } catch {
      // The repo list still works without "last scanned" info, but a repo
      // whose last scan simply failed to load used to render exactly like
      // one that has never been scanned. On a security tool that is the
      // wrong way round to be wrong, so say which it is.
      setSummariesFailed(true);
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
        setLoadError(
          data.error ||
            "Your repositories could not be loaded. That is a problem on our side, not an empty working set.",
        );
        setRepos([]);
        return;
      }
      const nameSet = new Set(names);
      setLoadError(null);
      setRepos(
        (data.repos as GithubRepo[]).filter((r) => nameSet.has(r.fullName)),
      );
    } catch {
      setLoadError(
        "Could not reach the server, so your repositories were not loaded.",
      );
      setRepos([]);
    }
    setReposLoading(false);
  }, []);

  // No setLoading(true) at the top: `loading` starts true, and setting it
  // synchronously from the mount effect below is a cascading render. The
  // retry button flips it itself, from an event handler, where it belongs.
  const init = useCallback(async () => {
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
      setLoadError(
        "Your GitHub connection status could not be loaded, so this page cannot tell whether you have connected an account.",
      );
    }
    setLoading(false);
  }, [loadWorkingSet, loadSummaries]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- init() is a useCallback the rule cannot see into; its first statement is an awaited fetch, so nothing calls setState synchronously here. It is a useCallback rather than a function declared inside this effect so the load-failure banner's Try again button can re-run the identical load.
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
      const controller = new AbortController();
      scanAbortRef.current = controller;
      setScanningRepo(repoFullName);
      setScanModalOutcome(null);
      setScanModalError(null);
      setScanModalOpen(true);
      try {
        const res = await fetch(API.SCAN_GITHUB, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoFullName }),
          signal: controller.signal,
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
      } catch (err) {
        // Closing the modal aborts the request rather than just hiding it --
        // that's an intentional cancellation, not a failure worth surfacing.
        if (err instanceof Error && err.name === "AbortError") return null;
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

      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-5"
      >
        {/* A load failure, not an action failure: it explains the empty list
            below it, so unlike the banner underneath it does not time out
            after eight seconds and leave the emptiness unexplained. */}
        {loadError && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl text-sm border bg-destructive/10 text-destructive border-destructive/20"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 min-w-0">{loadError}</span>
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                setLoading(true);
                init();
              }}
              className="inline-flex h-9 items-center rounded-md border border-destructive/30 px-3 text-xs font-medium hover:bg-destructive/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              Try again
            </button>
          </div>
        )}

        {summariesFailed && (
          <p
            role="status"
            className="text-xs text-muted-foreground px-1 leading-relaxed"
          >
            Scan history could not be loaded, so the &ldquo;last scanned&rdquo;
            line on each repository below is missing rather than empty.
          </p>
        )}

        {(error || success) && (
          <div
            role={error ? "alert" : "status"}
            aria-live={error ? "assertive" : "polite"}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl text-sm border",
              error
                ? "bg-destructive/10 text-destructive border-destructive/20"
                : "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
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
              className="text-xs font-medium hover:underline opacity-70 hover:opacity-100 transition-opacity rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              Dismiss
            </button>
          </div>
        )}

        {!status.connected ? (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] gap-8 lg:gap-12 items-center pt-6">
            <div className="flex flex-col gap-4 min-w-0">
              <div className="flex flex-col gap-1">
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                  Repos
                </h1>
                <p className="text-sm text-muted-foreground max-w-prose">
                  Run a security review on your repo source: any kind of repo,
                  not just web apps. Bots, games, CLIs, libraries, whatever. Not
                  URL/HTTP problems, actual code-level issues.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Hardcoded secrets",
                  "SQL injection",
                  "Command injection",
                ].map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground"
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Repo access hasn&apos;t been granted yet
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Grant it from your GitHub connection in Social settings.
                  </p>
                </div>
                <Button asChild className="gap-2 shrink-0">
                  <Link href={`${ROUTES.PROFILE}?tab=social`}>
                    <GithubIcon className="h-4 w-4" />
                    Go to Social settings
                  </Link>
                </Button>
              </div>
            </div>

            {/* A concrete example of what a review turns up, so "AI review"
                isn't just a claim in a sentence. */}
            <div className="rounded-xl border border-border/60 bg-muted/30 overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border/60 bg-muted/50 px-3.5 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--severity-medium))]/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--success))]/60" />
                <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                  config/database.js
                </span>
              </div>
              <pre className="px-4 py-3.5 overflow-x-auto text-xs leading-6 font-mono">
                <code className="block">
                  <span className="block text-muted-foreground/60">
                    <span className="inline-block w-4 text-muted-foreground/40">
                      1
                    </span>
                    const client = new Redis({"{"}
                  </span>
                  <span className="-mx-4 block bg-destructive/10 px-4">
                    <span className="inline-block w-4 text-muted-foreground/40">
                      2
                    </span>
                    <span className="text-foreground/90">
                      {'  password: "prod_'}
                    </span>
                    <span className="font-semibold text-destructive">
                      Kx9pL2mQ...
                    </span>
                    <span className="text-foreground/90">{'",'}</span>
                  </span>
                  <span className="block text-muted-foreground/60">
                    <span className="inline-block w-4 text-muted-foreground/40">
                      3
                    </span>
                    {"});"}
                  </span>
                </code>
              </pre>
              <div className="flex items-start gap-2 border-t border-border/60 px-4 py-3">
                <ShieldAlert
                  className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-destructive">
                    Critical:
                  </span>{" "}
                  hardcoded credential committed to source control
                </p>
              </div>
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
              <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card/50 px-6 py-8 sm:flex-row sm:items-center sm:gap-6">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                  <GithubIcon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    No repos selected yet
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Signed in as{" "}
                    <span className="font-mono text-foreground/80">
                      {status.githubUsername}
                    </span>
                    . Pick which repos should show up here.
                  </p>
                </div>
                <Button
                  className="gap-2 shrink-0"
                  onClick={() => setPickerOpen(true)}
                >
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
                            className="flex-1 min-w-0 text-left rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
        onOpenChange={(next) => {
          if (!next) scanAbortRef.current?.abort();
          setScanModalOpen(next);
        }}
        loading={scanningRepo !== null}
        repoFullName={scanningRepo}
        error={scanModalError}
        outcome={scanModalOutcome}
      />

      <Footer />
    </div>
  );
}
