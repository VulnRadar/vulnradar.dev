"use client";

import { Loader2, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SeverityPill } from "@/components/history/severity-pill";
import { SEVERITY_TONE } from "@/components/scanner/severity-badge";
import { SEVERITY_ORDER } from "@/lib/config/client-constants";
import { focus } from "@/lib/ui/animations";
import { pluralize } from "@/lib/ui/plural";
import { cn } from "@/lib/ui/utils";
import { GithubIcon } from "./github-icon";
import type { GithubRepo, RepoScanSummary } from "./types";

/**
 * The repository list, in the house table shape: a rounded-xl panel, a column
 * header band above the rows, and a severity rail down each row's left edge.
 *
 * It used to be a bare bordered box of unlabelled columns with no rail, which
 * is most of why /repos read as a different product from /history and /assets
 * despite doing the same job. The three columns are the same three those pages
 * carry (what it is, what the last scan found, when it last changed), so they
 * are labelled the same way and the severity pills are literally the same
 * component /history and /assets render.
 */

/** The five-track layout the header band and every row key off. */
const GRID = "sm:grid-cols-[1rem_minmax(0,1fr)_10.5rem_5.5rem_auto]";

/**
 * The rail colour for a repo's last scan: green when it came back clean, the
 * worst severity present otherwise, and nothing at all when the repo has never
 * been scanned. An unscanned repo genuinely has no status, and painting it a
 * colour would be decoration.
 */
function railClass(summary: RepoScanSummary | undefined): string | null {
  if (!summary) return null;
  if (summary.lastScan.findingsCount === 0) return "bg-[hsl(var(--success))]";
  const worst = SEVERITY_ORDER.find(
    (s) => (summary.lastScan.summary[s] ?? 0) > 0,
  );
  // findingsCount > 0 with every bucket empty should not happen, but a rail is
  // not the place to find out: fall back to the quietest level rather than
  // leaving the loudest signal on the row blank.
  return SEVERITY_TONE[worst ?? "info"].solid;
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
  const rail = railClass(summary);

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 border-l-2 border-transparent py-3 pl-4 pr-4 transition-colors hover:bg-muted/30",
        "sm:grid sm:items-center sm:gap-4",
        GRID,
      )}
    >
      {rail && (
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0 w-[3px]", rail)}
        />
      )}

      {repo.private ? (
        <Lock
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      ) : (
        <GithubIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}

      {/* The whole block is the control, not just the name line: it was
          already the row's only route into the repo's history and shrinking it
          to one line of text would have made it a worse target on a phone. */}
      <button
        type="button"
        onClick={() => onOpen(repo.fullName)}
        className={cn("min-w-0 flex-1 rounded-sm text-left", focus.ring)}
      >
        <span
          title={repo.fullName}
          className="block truncate text-sm font-medium text-foreground hover:underline"
        >
          {repo.fullName}
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

      <div className="hidden min-w-0 sm:flex sm:items-center">
        <LastScan summary={summary} summariesFailed={summariesFailed} />
      </div>

      <div className="hidden sm:flex sm:items-center sm:justify-end">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {formatUpdated(repo.updatedAt)}
        </span>
      </div>

      <Button
        size="sm"
        variant="outline"
        disabled={scanning}
        onClick={() => onScan(repo.fullName)}
        className="h-11 shrink-0 gap-1.5 sm:h-9 sm:justify-self-end"
      >
        {scanning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {/* "Scan" claims this repo has never been scanned. With the history
            fetch failed we do not know that, so the label drops the claim
            instead of guessing wrong on a repo that has a history. */}
        {summary ? "Rescan" : summariesFailed ? "Run scan" : "Scan"}
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
      <div
        className={cn(
          "hidden gap-4 border-b border-border bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid",
          GRID,
        )}
      >
        <span aria-hidden />
        <span>Repository</span>
        <span>Last scan</span>
        <span className="text-right">Updated</span>
        <span className="text-right">Actions</span>
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
