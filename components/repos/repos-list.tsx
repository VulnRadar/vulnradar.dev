"use client";

import { Loader2, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SeverityPill } from "@/components/history/severity-pill";
import {
  SEVERITY_TONE,
  severityTone,
} from "@/components/scanner/severity-badge";
import { SEVERITY_ORDER } from "@/lib/config/client-constants";
import { focus } from "@/lib/ui/animations";
import { pluralize } from "@/lib/ui/plural";
import { cn } from "@/lib/ui/utils";
import { GithubIcon } from "./github-icon";
import type { GithubRepo, RepoScanSummary } from "./types";

/**
 * The repository list, built on the same geometry as the scan list on
 * /history (components/history/history-scan-row.tsx). They are the same kind
 * of table doing the same job, and /repos read as a different product because
 * it was the same idea drawn three different ways:
 *
 *  - The row opened on a bare 16px icon in a 1rem track, so nothing anchored
 *    the left edge and the name, the lock and the rail all floated at slightly
 *    different heights. /history opens on a 36px tinted chip.
 *  - The rail was an absolutely-positioned 3px span drawn only when the repo
 *    had been scanned, so rows shifted by 3px depending on their own state.
 *    /history uses border-l-2 on every row and paints it transparent when
 *    there is nothing to say.
 *  - The three trailing tracks were sized `10.5rem 5.5rem auto`, and `auto`
 *    for a button whose label switches between "Scan", "Rescan" and "Run
 *    scan" meant the ACTIONS header sat over a column whose width changed per
 *    row. Fixed widths, like /history's w-20 / w-40 / w-12.
 *
 * The severity pills are literally the component /history and /assets render,
 * and the three columns are the three those pages carry: what it is, what the
 * last scan found, when it last changed.
 */

/** The five-track layout the header band and every row key off. */
const GRID = "sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]";

/**
 * The worst severity present on a repo's last scan, or null when it came back
 * clean or has never been scanned. Drives the rail and the icon chip together,
 * so the two can never disagree about how bad a row is.
 */
function worstSeverity(summary: RepoScanSummary | undefined) {
  if (!summary || summary.lastScan.findingsCount === 0) return null;
  // findingsCount > 0 with every bucket empty should not happen, but a row is
  // not the place to find out: fall back to the quietest level rather than
  // leaving the loudest signal on the row blank.
  return (
    SEVERITY_ORDER.find((s) => (summary.lastScan.summary[s] ?? 0) > 0) ?? "info"
  );
}

/**
 * The rail colour for a repo's last scan: green when it came back clean, the
 * worst severity present otherwise, and transparent when the repo has never
 * been scanned. An unscanned repo genuinely has no status, and painting it a
 * colour would be decoration; painting it nothing at all, as this used to,
 * moved the row.
 */
function railColor(summary: RepoScanSummary | undefined): string {
  if (!summary) return "transparent";
  const worst = worstSeverity(summary);
  return worst ? `hsl(var(--severity-${worst}))` : "hsl(var(--success))";
}

function formatUpdated(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** What the "Last scan" column holds: severity pills, a clean chip, or the
 *  reason there is neither. */
function LastScan({
  summary,
  summariesFailed,
}: {
  summary: RepoScanSummary | undefined;
  summariesFailed: boolean;
}) {
  if (!summary) {
    return (
      <span className="text-[11px] text-muted-foreground/70">
        {/* "Not scanned yet" is a claim, and with the history fetch failed we
            do not know it: this row used to say it about a repo scanned
            yesterday, contradicting the banner above the list. */}
        {summariesFailed ? "Last scan unknown" : "Not scanned yet"}
      </span>
    );
  }
  if (summary.lastScan.findingsCount === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--success))]/20 bg-[hsl(var(--success))]/10 px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--success))]">
        <ShieldCheck aria-hidden className="h-3 w-3" />
        Clean
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {SEVERITY_ORDER.map((s) => (
        <SeverityPill
          key={s}
          severity={s}
          count={summary.lastScan.summary[s] ?? 0}
        />
      ))}
    </span>
  );
}

function ReposRow({
  repo,
  summary,
  summariesFailed,
  scanning,
  onOpen,
  onScan,
}: {
  repo: GithubRepo;
  summary: RepoScanSummary | undefined;
  summariesFailed: boolean;
  scanning: boolean;
  onOpen: (fullName: string) => void;
  onScan: (fullName: string) => void;
}) {
  const worst = worstSeverity(summary);
  const isClean = !!summary && !worst;
  const tone = worst ? severityTone(worst) : null;

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 border-l-2 py-3 pl-4 pr-4 transition-colors hover:bg-muted/30",
        "sm:grid sm:items-center sm:gap-4",
        GRID,
        // The loudest rows get a faint wash of their own severity, the same
        // signal /history uses so "this one has a critical" survives a list of
        // fifty. Held at /5, and the hover background replaces it outright
        // rather than compositing, so a pointed-at row still reads as one.
        (worst === "critical" || worst === "high") &&
          SEVERITY_TONE[worst].panel,
      )}
      style={{ borderLeftColor: railColor(summary) }}
    >
      {/* Identity in the mark, scan state in its tone. A lock is the one fact
          about a repository that changes what a finding means (a secret in a
          public repo is already leaked), so it stays visible rather than being
          replaced by a shield that repeats what the pills already say. */}
      <div
        aria-hidden
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
          isClean
            ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]"
            : tone
              ? cn(tone.surface, tone.text)
              : "bg-muted text-muted-foreground",
        )}
      >
        {repo.private ? (
          <Lock className="h-4 w-4" />
        ) : (
          <GithubIcon className="h-4 w-4" />
        )}
      </div>

      {/* The whole block is the control, not just the name line: it was
          already the row's only route into the repo's history and shrinking it
          to one line of text would have made it a worse target on a phone. */}
      <button
        type="button"
        onClick={() => onOpen(repo.fullName)}
        className={cn("min-w-0 flex-1 rounded-sm text-left", focus.ring)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            title={repo.fullName}
            className="truncate text-sm font-medium text-foreground hover:underline"
          >
            {repo.fullName}
          </span>
          {repo.private && (
            <span className="hidden shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:inline">
              Private
            </span>
          )}
        </span>
        {summary ? (
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {pluralize(summary.scanCount, "scan")}
          </span>
        ) : (
          repo.description && (
            // line-clamp-2, not truncate: a description is prose, and one
            // clipped line on a phone showed about six words of it.
            <span className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
              {repo.description}
            </span>
          )
        )}

        {/* Below sm the two columns to the right have nowhere to go, so they
            fold into a meta line here rather than disappearing, which is what
            the row did with "updated" before. */}
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 sm:hidden">
          <LastScan summary={summary} summariesFailed={summariesFailed} />
          <span className="text-[11px] tabular-nums text-muted-foreground">
            Updated {formatUpdated(repo.updatedAt)}
          </span>
        </span>
      </button>

      {/* Fixed widths from here, matching the header band above. An `auto`
          track sized itself to each row's own content, so a row reading
          "Not scanned yet" and one carrying five severity pills put their
          Updated column in two different places. */}
      <div className="hidden w-40 min-w-0 sm:flex sm:items-center sm:justify-center">
        <LastScan summary={summary} summariesFailed={summariesFailed} />
      </div>

      <div className="hidden w-16 sm:flex sm:items-center sm:justify-end">
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatUpdated(repo.updatedAt)}
        </span>
      </div>

      <Button
        size="sm"
        variant="outline"
        disabled={scanning}
        onClick={() => onScan(repo.fullName)}
        className="h-11 w-11 shrink-0 p-0 sm:h-8 sm:w-24 sm:justify-self-end sm:gap-1.5 sm:px-3"
      >
        {scanning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {/* "Scan" claims this repo has never been scanned. With the history
            fetch failed we do not know that, so the label drops the claim
            instead of guessing wrong on a repo that has a history.

            Hidden below sm, where the button is a square icon target: the
            label was the only thing making the column wide enough to squeeze
            the repository name on a narrow phone. */}
        <span className="hidden sm:inline">
          {summary ? "Rescan" : summariesFailed ? "Run scan" : "Scan"}
        </span>
        <span className="sr-only sm:hidden">
          {summary ? "Rescan" : "Scan"} {repo.fullName}
        </span>
      </Button>
    </div>
  );
}

export function ReposList({
  repos,
  summaries,
  summariesFailed,
  scanningRepo,
  onOpen,
  onScan,
}: {
  repos: GithubRepo[];
  summaries: Record<string, RepoScanSummary>;
  summariesFailed: boolean;
  scanningRepo: string | null;
  onOpen: (fullName: string) => void;
  onScan: (fullName: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Every track here has a fixed width except the name, so a header
          label sits over its own column on every row rather than over
          whatever that row's content happened to measure. Matches
          components/history/history-scan-list.tsx. */}
      <div
        className={cn(
          "hidden gap-4 border-b border-border bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid",
          GRID,
        )}
      >
        <span className="w-9" aria-hidden />
        <span>Repository</span>
        <span className="w-40 text-center">Last scan</span>
        <span className="w-16 text-right">Updated</span>
        <span className="w-24 text-right">Actions</span>
      </div>

      <div className="divide-y divide-border">
        {repos.map((repo) => (
          <ReposRow
            key={repo.fullName}
            repo={repo}
            summary={summaries[repo.fullName]}
            summariesFailed={summariesFailed}
            scanning={scanningRepo === repo.fullName}
            onOpen={onOpen}
            onScan={onScan}
          />
        ))}
      </div>
    </div>
  );
}
