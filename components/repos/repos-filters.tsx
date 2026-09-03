"use client";

import { ArrowUpDown, ShieldAlert } from "lucide-react";
import {
  FilterDropdown,
  ListFilterBar,
  ListSearchInput,
} from "@/components/shared/list-filter-bar";
import type { GithubRepo, RepoScanSummary } from "./types";

export type RepoStatus = "any" | "scanned" | "unscanned" | "findings" | "clean";
export type RepoSort = "updated" | "name" | "findings";

export interface RepoQuery {
  search: string;
  status: RepoStatus;
  sort: RepoSort;
}

export const REPO_QUERY_DEFAULTS: RepoQuery = {
  search: "",
  status: "any",
  sort: "updated",
};

// Declaration order is menu order.
const STATUS_LABELS: Record<RepoStatus, string> = {
  any: "Any status",
  scanned: "Scanned",
  unscanned: "Not scanned",
  findings: "Has findings",
  clean: "Clean",
};

const SORT_LABELS: Record<RepoSort, string> = {
  updated: "Recently updated",
  name: "Name A-Z",
  findings: "Most findings",
};

/** Findings on the repo's last scan, or null when it has never been scanned.
 *  Null is not zero: "we have never looked" and "we looked and found nothing"
 *  are the two answers the status filter exists to tell apart. */
function lastFindings(summary: RepoScanSummary | undefined): number | null {
  return summary ? summary.lastScan.findingsCount : null;
}

export function applyRepoQuery(
  repos: GithubRepo[],
  summaries: Record<string, RepoScanSummary>,
  query: RepoQuery,
): GithubRepo[] {
  const q = query.search.trim().toLowerCase();

  const matched = repos.filter((repo) => {
    if (
      q &&
      !repo.fullName.toLowerCase().includes(q) &&
      !(repo.description ?? "").toLowerCase().includes(q)
    ) {
      return false;
    }
    const findings = lastFindings(summaries[repo.fullName]);
    switch (query.status) {
      case "scanned":
        return findings !== null;
      case "unscanned":
        return findings === null;
      case "findings":
        return findings !== null && findings > 0;
      case "clean":
        return findings === 0;
      default:
        return true;
    }
  });

  // filter() already handed back a new array, so sorting in place here never
  // reorders the caller's own list.
  return matched.sort((a, b) => {
    if (query.sort === "name") return a.fullName.localeCompare(b.fullName);
    if (query.sort === "findings") {
      // Never-scanned sorts below a repo with zero findings: -1 is "unknown",
      // and a repo we have never looked at is not the most interesting row on
      // a list ordered by how much is wrong.
      return (
        (lastFindings(summaries[b.fullName]) ?? -1) -
        (lastFindings(summaries[a.fullName]) ?? -1)
      );
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function ReposFilters({
  query,
  onChange,
}: {
  query: RepoQuery;
  onChange: (patch: Partial<RepoQuery>) => void;
}) {
  return (
    <ListFilterBar>
      <ListSearchInput
        value={query.search}
        onChange={(search) => onChange({ search })}
        placeholder="Search your repos..."
        label="Search your GitHub repositories"
      />
      <div className="flex flex-wrap items-center gap-2">
        <FilterDropdown
          icon={ShieldAlert}
          label="Filter repositories by scan status"
          value={query.status}
          labels={STATUS_LABELS}
          active={query.status !== REPO_QUERY_DEFAULTS.status}
          onChange={(status) => onChange({ status })}
        />
        <FilterDropdown
          icon={ArrowUpDown}
          label="Sort repositories"
          value={query.sort}
          labels={SORT_LABELS}
          active={query.sort !== REPO_QUERY_DEFAULTS.sort}
          onChange={(sort) => onChange({ sort })}
        />
      </div>
    </ListFilterBar>
  );
}
