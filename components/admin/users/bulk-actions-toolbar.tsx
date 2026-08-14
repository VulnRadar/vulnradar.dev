"use client";

import { useState } from "react";
import { Ban, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminPasswordConfirmDialog, Toast } from "@/components/admin/shared";
import type { ToastState } from "@/components/admin/types";
import { STAFF_ROLES, STAFF_ROLE_LABELS } from "@/lib/config/constants";
import {
  bulkActionDialogCopy,
  summarizeBulkOutcome,
  type BulkActionUser,
  type PendingBulkAction,
} from "./bulk-actions-toolbar-utils";

// Pure reducer/formatter helpers and the useBulkUserSelection hook live in
// ./bulk-actions-toolbar-utils.ts (re-exported below for existing
// importers), not in this file -- this project's Vitest runs in a plain
// node environment with no jsdom/JSX transform for .test.ts files, so a
// module containing JSX (this component) can't be imported by a test file
// at all, even just for its non-JSX exports. See
// components/admin/shared/use-unsaved-changes-warning.ts for the same
// split applied to a hook.
export {
  toggleSelection,
  toggleAllSelection,
  pruneSelection,
  selectionSummary,
  useBulkUserSelection,
  bulkActionDialogCopy,
  summarizeBulkOutcome,
  type SelectionSummary,
  type BulkActionUser,
  type PendingBulkAction,
  type BulkItemResult,
  type BulkActionDialogCopy,
  type BulkOutcomeToast,
} from "./bulk-actions-toolbar-utils";

const ASSIGNABLE_ROLES = Object.values(STAFF_ROLES).filter(
  (r) => r !== STAFF_ROLES.SUPER_ADMIN,
);

interface BulkActionsToolbarProps {
  /** Selected row ids -- e.g. `useBulkUserSelection(...).selectedIds`. */
  selectedIds: number[];
  /** The currently-rendered user list, used only to render the count/names
   * that already-selected ids resolve to. */
  users: BulkActionUser[];
  /** Signed-in admin's own role, from the same `callerRole` state
   * app/admin/page.tsx already tracks for UserDetailPanel. */
  callerRole: string;
  /** Called after a successful (or partially successful) bulk action so the
   * caller can clear its own selection state. */
  onCleared: () => void;
  /** Called after a successful (or partially successful) bulk action so the
   * caller can refetch the user list/stats. */
  onActionComplete: () => void;
}

/**
 * Row-selection toolbar for the admin Users table (AUDIT-010). Renders
 * nothing when nothing is selected or the caller isn't admin-tier -- see
 * app/api/v3/admin/bulk/route.ts's header comment for why only admin/
 * super_admin can reach the 3 supported actions (set_role, disable,
 * delete), so this hides the buttons instead of showing ones that would
 * always 403.
 *
 * Self-contained: owns its own confirm/password-gate flow and toast, and
 * calls POST /api/v3/admin/bulk directly. Needs `selectedIds` (row
 * checkbox state) from a parent -- see this file's `useBulkUserSelection`
 * hook -- since the checkboxes themselves live inside each table row,
 * which this component does not render.
 */
export function BulkActionsToolbar({
  selectedIds,
  users,
  callerRole,
  onCleared,
  onActionComplete,
}: BulkActionsToolbarProps) {
  const [pendingAction, setPendingAction] = useState<PendingBulkAction | null>(
    null,
  );
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [roleChoice, setRoleChoice] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);

  const isAdmin = callerRole === "admin" || callerRole === "super_admin";

  if (selectedIds.length === 0 || !isAdmin) return null;

  const count = selectedIds.length;
  const label = count === 1 ? "1 user" : `${count} users`;
  const selectedUserIds = new Set(selectedIds);
  const namedCount = users.filter((u) => selectedUserIds.has(u.id)).length;

  const resetPending = () => {
    setPendingAction(null);
    setRoleChoice("");
  };

  const runBulkAction = async (
    action: string,
    extra: Record<string, unknown>,
    password: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch("/api/v3/admin/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: selectedIds,
          action,
          currentAdminPassword: password,
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || "Bulk action failed." };
      }
      setToast(summarizeBulkOutcome(data));
      onCleared();
      onActionComplete();
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error. Please try again." };
    }
  };

  const dialogCopy = pendingAction
    ? bulkActionDialogCopy(pendingAction, count)
    : null;

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5"
        role="toolbar"
        aria-label="Bulk user actions"
      >
        <span className="text-sm font-medium">
          {label} selected
          {namedCount < count && (
            <span className="text-muted-foreground">
              {" "}
              ({namedCount} on this page)
            </span>
          )}
        </span>
        <div className="flex-1" />
        {/* Native <select>, not the Radix-based Select used elsewhere in
            this codebase -- a custom-rendered listbox popup doesn't hand
            off to the OS's native picker UI, which is what iOS Safari and
            some other mobile browsers need to open it at all. Same
            pattern as the role <select> in user-detail-panel.tsx. */}
        <select
          value={roleChoice}
          onChange={(e) => {
            const nextRole = e.target.value;
            setRoleChoice(nextRole);
            setPendingAction({ kind: "set_role", role: nextRole });
            setShowPasswordDialog(true);
          }}
          aria-label="Change role for selected users"
          className="h-8 w-[150px] rounded-md border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="" disabled>
            Change role...
          </option>
          {ASSIGNABLE_ROLES.map((roleOption) => (
            <option key={roleOption} value={roleOption}>
              {STAFF_ROLE_LABELS[roleOption] || roleOption}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => {
            setPendingAction({ kind: "disable" });
            setShowPasswordDialog(true);
          }}
        >
          <Ban className="h-3.5 w-3.5" aria-hidden="true" />
          Disable
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => {
            setPendingAction({ kind: "delete" });
            setShowPasswordDialog(true);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Delete
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={onCleared}
          aria-label="Clear selection"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Clear
        </Button>
      </div>

      {pendingAction && dialogCopy && (
        <AdminPasswordConfirmDialog
          open={showPasswordDialog}
          onOpenChange={(open) => {
            setShowPasswordDialog(open);
            if (!open) resetPending();
          }}
          title={dialogCopy.title}
          description={dialogCopy.description}
          confirmLabel={dialogCopy.confirmLabel}
          variant={dialogCopy.variant}
          onConfirm={async (password) => {
            const extra =
              pendingAction.kind === "set_role"
                ? { role: pendingAction.role }
                : {};
            const result = await runBulkAction(
              pendingAction.kind,
              extra,
              password,
            );
            if (result.ok) {
              setShowPasswordDialog(false);
              resetPending();
            }
            return result;
          }}
        />
      )}

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </>
  );
}
