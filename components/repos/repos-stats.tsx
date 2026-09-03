"use client";

import { FolderGit2, ScanSearch, ShieldCheck, ShieldX } from "lucide-react";
import { StatStrip } from "@/components/shared/stat-strip";
import type { GithubRepo, RepoScanSummary } from "./types";

/**
 * The page-opening strip for /repos, the same element /history, /assets and
 * /shares open with. The facts are the ones the page already had and was
 * making the reader count by hand: how many repositories are in the working
 * set, how many of them have ever been scanned, how many came back clean, and
 * how many findings are outstanding across the lot.
 *
 * The caller must not render this when the scan-history fetch failed: three of
 * the four cells are derived from it, and with no history loaded they would
 * all read zero, which is a claim ("nothing scanned, nothing found") rather
 * than a blank.
 */
export function ReposStats({
  repos,
  summaries,
}: {
  repos: GithubRepo[];
  summaries: Record<string, RepoScanSummary>;
}) {
  if (repos.length === 0) return null;

  const scanned = repos.filter((r) => summaries[r.fullName]).length;
  // `=== 0` rather than `!`: an unscanned repo has no summary at all, and it
  // is not clean, it is unknown.
  const clean = repos.filter(
    (r) => summaries[r.fullName]?.lastScan.findingsCount === 0,
  ).length;
  const findings = repos.reduce(
    (acc, r) => acc + (summaries[r.fullName]?.lastScan.findingsCount ?? 0),
    0,
  );

  return (
    <StatStrip
      items={[
        {
          value: repos.length,
          label: repos.length === 1 ? "Repo" : "Repos",
          icon: FolderGit2,
          iconTone: "primary",
        },
        {
          value: scanned,
          label: "Scanned",
          icon: ScanSearch,
          iconTone: "primary",
        },
        {
          value: clean,
          label: "Came back clean",
          icon: ShieldCheck,
          textTone: "text-[hsl(var(--success))]",
          iconTone: "success",
        },
        {
          // Counts the LATEST scan of each repo, not every scan ever run, so
          // rescanning a repo replaces its contribution rather than adding to
          // it. That is the number the rows below add up to.
          value: findings,
          label: "Findings total",
          icon: ShieldX,
          textTone: "text-[hsl(var(--severity-high))]",
          iconTone: "severity-high",
        },
      ]}
    />
  );
}
