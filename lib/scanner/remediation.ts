/**
 * Per-finding remediation status: the user's own tracking of what they've
 * done about a finding (Open / In progress / Fixed / Accepted risk / Won't
 * fix), distinct from the accuracy feedback (confirmed / false_positive /
 * not_applicable) that feeds the global confidence model.
 *
 * IDENTITY / why it survives rescans: a remediation row is keyed on
 * (user_id, finding_id, finding_url), NOT on the scan row id. `finding_id`
 * is the deterministic `<checkId>--<fnvHash(url)>` string generateId()
 * produces (lib/scanner/_helpers.ts) -- the same check firing against the
 * same URL always yields the same id across scans, which is exactly what
 * the compare/diff and regression-alert features already rely on. So a
 * finding marked "fixed" on one scan keeps that status when the same host
 * is scanned again, even though the new scan is a different scan_history
 * row.
 *
 * This module is pure (no DB import) so it is safe to import from client
 * components AND the API route. The DB read/merge helper lives in
 * lib/scanner/remediation-store.ts (server-only).
 */

/**
 * `open` is the implicit default (absence of a row). The other four are the
 * states a user can explicitly set. Order is the display order in the UI
 * control.
 */
export const REMEDIATION_STATUSES = [
  "open",
  "in_progress",
  "fixed",
  "accepted_risk",
  "wont_fix",
] as const;

export type RemediationStatus = (typeof REMEDIATION_STATUSES)[number];

export interface FindingRemediation {
  status: RemediationStatus;
  note?: string | null;
  assignee?: string | null;
}

export function isRemediationStatus(v: unknown): v is RemediationStatus {
  return (
    typeof v === "string" &&
    (REMEDIATION_STATUSES as readonly string[]).includes(v)
  );
}

/** Full-word label for every status, used by the detail-view control. */
export const REMEDIATION_LABELS: Record<RemediationStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  fixed: "Fixed",
  accepted_risk: "Accepted risk",
  wont_fix: "Won't fix",
};

export interface RemediationBadgeStyle {
  /** Short label for the compact list badge. */
  label: string;
  /** Tailwind classes: border + bg + text, using the existing tokens. */
  className: string;
}

/**
 * Compact list-badge styling for every non-open status. `open` is absent on
 * purpose: an open finding shows no badge (it is the default). fixed reads
 * as success, in_progress as brand, accepted/wont-fix as muted -- so the
 * open work still stands out.
 */
export const REMEDIATION_BADGE: Record<
  Exclude<RemediationStatus, "open">,
  RemediationBadgeStyle
> = {
  in_progress: {
    label: "In progress",
    className: "border-primary/20 bg-primary/10 text-primary",
  },
  fixed: {
    label: "Fixed",
    className:
      "border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
  },
  accepted_risk: {
    label: "Accepted",
    className: "border-border bg-muted text-muted-foreground",
  },
  wont_fix: {
    label: "Won't fix",
    className: "border-border bg-muted text-muted-foreground",
  },
};
