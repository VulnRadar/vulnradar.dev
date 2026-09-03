"use client";

import { ArrowUpDown, ShieldAlert } from "lucide-react";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import {
  FilterDropdown,
  ListFilterBar,
  ListSearchInput,
} from "@/components/shared/list-filter-bar";
import type { Share } from "./shares-types";

export type ShareStatus = "any" | "safe" | "caution" | "unsafe";
export type ShareSort = "newest" | "oldest" | "expiring";

export interface ShareQuery {
  search: string;
  status: ShareStatus;
  sort: ShareSort;
}

export const SHARE_QUERY_DEFAULTS: ShareQuery = {
  search: "",
  status: "any",
  sort: "newest",
};

// Declaration order is menu order, and the three verdicts are worded exactly
// as the stat strip directly above the row words them.
const STATUS_LABELS: Record<ShareStatus, string> = {
  any: "Any status",
  safe: "Clean",
  caution: "Have warnings",
  unsafe: "Exploitable",
};

const SORT_LABELS: Record<ShareSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  expiring: "Expiring soonest",
};

/** A link with no expiry sorts last under "Expiring soonest": it is not
 *  overdue, it is never due. */
const NEVER_EXPIRES = Number.POSITIVE_INFINITY;

function expiresAtMs(share: Share): number {
  return share.expiresAt ? new Date(share.expiresAt).getTime() : NEVER_EXPIRES;
}

export function applyShareQuery(shares: Share[], query: ShareQuery): Share[] {
  const q = query.search.trim().toLowerCase();

  const matched = shares.filter((share) => {
    if (q && !share.url.toLowerCase().includes(q)) return false;
    if (query.status === "any") return true;
    return getSafetyRating(share.findings) === query.status;
  });

  // filter() already handed back a new array, so sorting in place here never
  // reorders the caller's own list.
  return matched.sort((a, b) => {
    if (query.sort === "expiring") return expiresAtMs(a) - expiresAtMs(b);
    const diff =
      new Date(a.scannedAt).getTime() - new Date(b.scannedAt).getTime();
    return query.sort === "oldest" ? diff : -diff;
  });
}

export function SharesFilters({
  query,
  onChange,
  showDropdowns = true,
}: {
  query: ShareQuery;
  onChange: (patch: Partial<ShareQuery>) => void;
  /** Narrowing controls only. The search field is always rendered. */
  showDropdowns?: boolean;
}) {
  return (
    <ListFilterBar>
      <ListSearchInput
        value={query.search}
        onChange={(search) => onChange({ search })}
        placeholder="Search by URL..."
        label="Filter shared reports by URL"
      />
      {showDropdowns && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            icon={ShieldAlert}
            label="Filter shared reports by verdict"
            value={query.status}
            labels={STATUS_LABELS}
            active={query.status !== SHARE_QUERY_DEFAULTS.status}
            onChange={(status) => onChange({ status })}
          />
          <FilterDropdown
            icon={ArrowUpDown}
            label="Sort shared reports"
            value={query.sort}
            labels={SORT_LABELS}
            active={query.sort !== SHARE_QUERY_DEFAULTS.sort}
            onChange={(sort) => onChange({ sort })}
          />
        </div>
      )}
    </ListFilterBar>
  );
}
