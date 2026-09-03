"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { worthFiltering } from "@/components/shared/list-filter-bar";
import {
  AlertTriangle,
  Check,
  Loader2,
  Pencil,
  Search,
  ShieldAlert,
} from "lucide-react";
import { API, ROUTES } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { useQueryParam } from "@/lib/ui/url-state";
import { GithubIcon } from "@/components/repos/github-icon";
import { GithubRepoPickerModal } from "@/components/repos/github-repo-picker-modal";
import { GithubScanResultModal } from "@/components/repos/github-scan-result-modal";
import { RepoDetail } from "@/components/repos/repo-detail";
import { ReposDataSkeleton } from "@/components/repos/repos-skeleton";
import { ReposList } from "@/components/repos/repos-list";
import { ReposStats } from "@/components/repos/repos-stats";
import {
  applyRepoQuery,
  ReposFilters,
  REPO_QUERY_DEFAULTS,
  type RepoQuery,
} from "@/components/repos/repos-filters";
import type {
  GithubRepo,
  GithubScanOutcome,
  RepoScanSummary,
} from "@/components/repos/types";
import type { ScanResult } from "@/lib/scanner/types";

interface GithubStatus {
  connected: boolean;
  githubUsername?: string;
  selectedRepos?: string[];
}

const STATUS_UNKNOWN_MESSAGE =
  "Your GitHub connection status could not be loaded, so this page cannot tell whether you have connected an account.";

export default function ReposPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** A failed *load*, as opposed to a failed action. Never auto-dismissed. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summariesFailed, setSummariesFailed] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  /**
   * null means "we could not ask", not "not connected". Those were the same
   * value before: the status fetch defaulted to `{ connected: false }`, so a
   * failed request rendered the full "Repo access hasn't been granted yet"
   * hero at a user who had already granted it. Only a status we actually read
   * back is allowed to answer that question.
   */
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoQuery, setRepoQuery] = useState<RepoQuery>(REPO_QUERY_DEFAULTS);
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
        // Deliberately no setRepos([]): an empty array is the same value as
        // "you have not selected anything", so the render stacked the "No
        // repos selected yet" empty state directly under the banner saying
        // this was NOT an empty working set. Left null, the failure replaces
        // that empty state instead of sitting above it.
        setLoadError(
          data.error ||
            "Your repositories could not be loaded. That is a problem on our side, not an empty working set.",
        );
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
    } finally {
      // `finally`, not a bare call after the try: the non-ok branch above
      // returns straight past that, which left the list spinner up forever
      // and made the error state below it unreachable.
      setReposLoading(false);
    }
  }, []);

  // No setLoading(true) at the top: `loading` starts true, and setting it
  // synchronously from the mount effect below is a cascading render. The
  // retry button flips it itself, from an event handler, where it belongs.
  const init = useCallback(async () => {
    try {
      const res = await fetch(API.ACCOUNT_GITHUB);
      const data = (await res.json().catch(() => null)) as
        (GithubStatus & { error?: string }) | null;
      // A 5xx that answers with a JSON error body parses fine, so the catch
      // below never ran: `connected` came back undefined, read as false, and
      // the page confidently told the user they had no repo access. Only a
      // body that actually carries a boolean `connected` counts as an answer.
      if (!res.ok || typeof data?.connected !== "boolean") {
        setStatus(null);
        setLoadError(data?.error || STATUS_UNKNOWN_MESSAGE);
      } else {
        setStatus(data);
        if (data.connected && data.selectedRepos?.length) {
          await Promise.all([
            loadWorkingSet(data.selectedRepos),
            loadSummaries(),
          ]);
        }
      }
    } catch {
      setStatus(null);
      setLoadError(STATUS_UNKNOWN_MESSAGE);
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
    // The picker is only reachable from a status we read back, so `prev` is
    // never null here; the guard is what keeps that true rather than
    // synthesising a `connected` this handler never learned.
    setStatus((prev) => (prev ? { ...prev, selectedRepos: selected } : prev));
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

  const activeRepo = activeRepoName
    ? (repos ?? []).find((r) => r.fullName === activeRepoName)
    : undefined;

  // A working set short enough to read at a glance gets no filter row, the
  // call components/teams/teams-list.tsx already made for its own list. The
  // query is forced back to its defaults when the row is not on screen, so a
  // selection edited down to two repos can never land on a filtered-out list
  // with no visible control to undo it.
  const showFilters = worthFiltering(repos?.length ?? 0);
  // Only the dropdown values are reset while their controls are hidden. The
  // search field is always rendered, so its term survives: resetting it too
  // would leave a visible box that does nothing.
  const effectiveQuery = showFilters
    ? repoQuery
    : { ...REPO_QUERY_DEFAULTS, search: repoQuery.search };
  const filteredRepos = applyRepoQuery(repos ?? [], summaries, effectiveQuery);

  return (
    <AppPageShell className="flex flex-col gap-5">
      {/* The page title outranks the banners. Stacked, the summaries note
            and an action result push transient chrome above the H1 that names
            the page, so the header for the connected list is hoisted above
            both. It also stays up while the status load is failing, since the
            error panel below replaces the list, not the page. The other two
            branches carry their own heading (RepoDetail, and the
            not-connected hero below). */}
      {(!status || status.connected) && !activeRepo && (
        <div className="flex items-start justify-between gap-4 flex-wrap pt-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
              Repos
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-prose">
              Source review for{" "}
              {status?.githubUsername ? `${status.githubUsername}'s` : "your"}{" "}
              repos: hardcoded secrets, injection bugs, and other code-level
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
      )}

      {/* Gated on !loadError: this note describes a list, and a load failure
            now replaces that list outright, so on its own it would be a note
            about rows that are not on the page. */}
      {summariesFailed && !loadError && (
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
            // rounded-lg: a callout, same rung as the access callout below.
            // These two were the only ones wearing the page-panel radius.
            "flex items-center gap-3 px-4 py-3 rounded-lg text-sm border",
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

      {/* The loading branch has to come first: `status` is null until the
            fetch lands, and null is also the unknown-status case below, so
            without this the page would answer "we could not read your GitHub
            connection" for the whole first second of every visit. Only this
            slot waits; the title above it is on screen the entire time.

            A failed load is never the empty state and never a "no". It fills
            the same page-panel slot the list or the not-connected hero would
            have taken, so nothing on screen answers a question the page could
            not read the answer to. Same shape as app/shares/page.tsx's
            listError panel, which sits ahead of its empty state for the same
            reason. `!status` is the unknown-status case: it always arrives
            with a loadError, and the fallback copy is only here so the panel
            can never render blank. */}
      {loading ? (
        <ReposDataSkeleton />
      ) : loadError || !status ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-destructive/30 bg-destructive/5 px-4 py-14 text-center"
        >
          <AlertTriangle
            className="h-6 w-6 text-destructive/70"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-foreground">
            {loadError ?? STATUS_UNKNOWN_MESSAGE}
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Nothing has changed about your GitHub connection or the repos you
            picked. This is a problem reading them, not a change to them.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="bg-transparent"
            onClick={() => {
              setLoadError(null);
              setLoading(true);
              init();
            }}
          >
            Retry
          </Button>
        </div>
      ) : !status.connected ? (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] gap-8 lg:gap-12 items-center pt-6">
          <div className="flex flex-col gap-4 min-w-0">
            <div className="flex flex-col gap-1">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
                Repos
              </h1>
              <p className="text-sm text-muted-foreground max-w-prose">
                Run a security review on your repo source: any kind of repo, not
                just web apps. Bots, games, CLIs, libraries, whatever. Not
                URL/HTTP problems, actual code-level issues.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["Hardcoded secrets", "SQL injection", "Command injection"].map(
                (label) => (
                  <span
                    key={label}
                    className="rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground"
                  >
                    {label}
                  </span>
                ),
              )}
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
                <span className="font-medium text-destructive">Critical:</span>{" "}
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
            <div className="flex flex-col gap-5">
              {/* Three of the four cells read off the scan history, so with
                  that fetch failed they would all print a confident zero.
                  The banner above already says the "last scanned" line is
                  missing rather than empty; the strip stays off rather than
                  contradicting it. */}
              {!summariesFailed && (
                <ReposStats repos={repos} summaries={summaries} />
              )}

              {/* Always rendered, because the search box is. Gating the whole
                  bar on worthFiltering() removed search from an account with
                  exactly three repositories, and /repos had a search field
                  before any of this. Only the narrowing dropdowns are
                  conditional now. */}
              <ReposFilters
                query={repoQuery}
                onChange={(patch) =>
                  setRepoQuery((prev) => ({ ...prev, ...patch }))
                }
                showDropdowns={showFilters}
              />

              {filteredRepos.length === 0 ? (
                <EmptyState
                  icon={Search}
                  size="sm"
                  title="No repos match those filters"
                  description="Search matches on the repository name and its description."
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRepoQuery(REPO_QUERY_DEFAULTS)}
                      className="bg-transparent"
                    >
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <ReposList
                  repos={filteredRepos}
                  summaries={summaries}
                  summariesFailed={summariesFailed}
                  scanningRepo={scanningRepo}
                  onOpen={setActiveRepoName}
                  onScan={handleScan}
                />
              )}
            </div>
          )}
        </>
      )}

      {/* Both modals are fixed-position overlays, so living inside main
          rather than beside it changes nothing about where they land. */}
      <GithubRepoPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialSelected={status?.selectedRepos ?? []}
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
    </AppPageShell>
  );
}
