import { useCallback, useEffect, useMemo, useState } from "react";
import { STAFF_ROLE_LABELS } from "@/lib/config/constants";

// Pure reducer helpers behind useBulkUserSelection below, and the pure
// copy/summary functions BulkActionsToolbar renders from -- kept in their
// own plain .ts file (no JSX) so they're unit-testable in this project's
// plain-node Vitest environment (no jsdom, no JSX transform configured for
// .test.ts files). Importing any of these from bulk-actions-toolbar.tsx
// itself fails to parse under Vitest even for the pure exports, because the
// same module also contains the JSX-rendering React component -- see
// components/admin/shared/use-unsaved-changes-warning.ts for the same
// split applied to a hook.

/** Toggle a single id in the selection set. */
export function toggleSelection(
  selected: Set<number>,
  id: number,
): Set<number> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Select-all checkbox behavior: select every id on the page, unless every
 * id on the page is already selected, in which case deselect all of them.
 * (Does not touch a selection that extends beyond the current page.) */
export function toggleAllSelection(
  selected: Set<number>,
  pageIds: number[],
): Set<number> {
  if (pageIds.length > 0 && pageIds.every((id) => selected.has(id))) {
    const next = new Set(selected);
    pageIds.forEach((id) => next.delete(id));
    return next;
  }
  return new Set([...selected, ...pageIds]);
}

/** Drops any selected id that is no longer present in `pageIds` (page
 * changed, search changed, a refresh reordered the list) so a stale
 * selection can never silently target a user no longer visible. Returns
 * the same Set instance when nothing changed, so callers can skip a
 * re-render by reference-checking the result. */
export function pruneSelection(
  selected: Set<number>,
  pageIds: number[],
): Set<number> {
  if (selected.size === 0) return selected;
  const pageSet = new Set(pageIds);
  let changed = false;
  const next = new Set<number>();
  selected.forEach((id) => {
    if (pageSet.has(id)) next.add(id);
    else changed = true;
  });
  return changed ? next : selected;
}

export interface SelectionSummary {
  selectedIds: number[];
  allSelected: boolean;
  someSelected: boolean;
}

/** Derives the toolbar/header-checkbox display state from the raw
 * selection set + the ids currently on screen. */
export function selectionSummary(
  selected: Set<number>,
  pageIds: number[],
): SelectionSummary {
  const onPage = pageIds.filter((id) => selected.has(id)).length;
  return {
    selectedIds: Array.from(selected),
    allSelected: pageIds.length > 0 && onPage === pageIds.length,
    someSelected: onPage > 0 && onPage < pageIds.length,
  };
}

/**
 * Row-selection state for the admin Users table (AUDIT-010: bulk user
 * operations). Owns a Set<number> of selected user ids; see
 * `pruneSelection` above for why it's scoped to whatever page/search
 * result is currently on screen.
 */
export function useBulkUserSelection(pageIds: number[]) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Hoisted out of the dependency arrays below: the react-hooks lint rule
  // requires each dep to be a simple identifier/member expression, not an
  // arbitrary call like `pageIds.join(",")` inline in the array literal.
  // This still recomputes every render (cheap for a page-sized id list) but
  // gives effects/memos a stable primitive to actually depend on instead of
  // the `pageIds` array reference, which changes every render regardless of
  // whether its contents did.
  const pageIdsKey = pageIds.join(",");

  useEffect(() => {
    setSelected((prev) => pruneSelection(prev, pageIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIdsKey]);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => toggleSelection(prev, id));
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => toggleAllSelection(prev, pageIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIdsKey]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const summary = useMemo(
    () => selectionSummary(selected, pageIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, pageIdsKey],
  );

  return {
    ...summary,
    isSelected: (id: number) => selected.has(id),
    toggle,
    toggleAll,
    clear,
  };
}

export interface BulkActionUser {
  id: number;
  email: string;
  name: string | null;
  role: string | null;
}

export type PendingBulkAction =
  { kind: "set_role"; role: string } | { kind: "disable" } | { kind: "delete" };

export interface BulkItemResult {
  userId: number;
  ok: boolean;
  error?: string;
}

export interface BulkActionDialogCopy {
  title: string;
  description: string;
  variant: "default" | "destructive";
  confirmLabel: string;
}

/** Confirm-dialog copy for a pending bulk action, pulled out as a pure
 * function (same reasoning as the selection reducers above) so the exact
 * wording is unit-testable without rendering the dialog. */
export function bulkActionDialogCopy(
  action: PendingBulkAction,
  count: number,
): BulkActionDialogCopy {
  const label = count === 1 ? "1 user" : `${count} users`;
  if (action.kind === "set_role") {
    const roleLabel = STAFF_ROLE_LABELS[action.role] || action.role;
    return {
      title: `Change role for ${label}`,
      description: `Set ${label} to "${roleLabel}".`,
      variant: "default",
      confirmLabel: "Change role",
    };
  }
  if (action.kind === "disable") {
    return {
      title: `Disable ${label}`,
      description: `${label} will be signed out everywhere and unable to log in.`,
      variant: "destructive",
      confirmLabel: "Disable users",
    };
  }
  return {
    title: `Permanently delete ${label}`,
    description: `This deletes all scans, API keys, webhooks, and account data for ${label}. This cannot be undone.`,
    variant: "destructive",
    confirmLabel: "Delete users",
  };
}

export interface BulkOutcomeToast {
  message: string;
  type: "success" | "error";
}

/** Turns the bulk endpoint's { succeeded, failed, results } response into
 * the one-line toast message shown after a run. Success-with-some-failures
 * still reads as "success" (most of the batch went through); a total
 * wipeout reads as "error". */
export function summarizeBulkOutcome(data: {
  succeeded: number;
  failed: number;
  results: BulkItemResult[];
}): BulkOutcomeToast {
  const results = data.results || [];
  const failedItems = results.filter((r) => !r.ok);
  if (failedItems.length > 0) {
    return {
      message: `${data.succeeded} succeeded, ${data.failed} failed${
        failedItems[0]?.error ? ` (${failedItems[0].error})` : ""
      }.`,
      type: failedItems.length === results.length ? "error" : "success",
    };
  }
  return {
    message: `${data.succeeded} of ${results.length} user${
      results.length === 1 ? "" : "s"
    } updated.`,
    type: "success",
  };
}
