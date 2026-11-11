"use client";

import { useState } from "react";
import {
  EditDialog,
  type EditSaveOutcome,
} from "@/components/shared/edit-dialog";
import { TEAM_ROLES } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { type Member } from "./teams-types";

/**
 * Who a team can be handed to: everyone on it except the owner. PATCH
 * /api/v3/teams refuses anyone who is not a member, so the list is the
 * member list and nothing else, never an address typed in.
 */
export function transferCandidates(members: readonly Member[]): Member[] {
  return members.filter((m) => m.role !== TEAM_ROLES.OWNER);
}

/** What happens, named for the person picked. */
export function transferDescription(memberLabel: string | null): string {
  return `You become an admin. Only ${memberLabel ?? "the new owner"} can transfer it back or delete the team.`;
}

/**
 * Hand the team to another member, from the owner's menu on its page.
 *
 * Picking the new owner is an edit of the team, so it is a form in the shared
 * edit dialog (CLAUDE.md "Edit in a modal") rather than a menu pick followed
 * by a confirmation: the person and the consequence are on screen together and
 * Save is the explicit step. Save is red because the owner cannot take it back
 * on their own; only the new owner can.
 */
export function TransferOwnershipDialog({
  team,
  members,
  onTransfer,
  onClose,
}: {
  team: { name: string };
  members: readonly Member[];
  /** The chosen member's id. A refusal is { ok: false, error } or a throw. */
  onTransfer: (
    newOwnerId: number,
  ) => EditSaveOutcome | Promise<EditSaveOutcome>;
  onClose: () => void;
}) {
  // Mounted only while open, so every opening starts with nobody picked.
  const [selected, setSelected] = useState<number | null>(null);
  const candidates = transferCandidates(members);
  const picked = candidates.find((m) => m.user_id === selected) ?? null;

  return (
    <EditDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Transfer ownership of ${team.name}?`}
      description={transferDescription(
        picked ? picked.name || picked.email : null,
      )}
      size="sm"
      destructive
      saveLabel="Transfer ownership"
      dirty={selected !== null}
      canSave={picked !== null}
      onSave={() => (picked ? onTransfer(picked.user_id) : undefined)}
    >
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody else is on this team yet. Invite someone first: ownership can
          only go to a member.
        </p>
      ) : (
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-sm font-medium text-foreground">
            New owner
          </legend>
          {candidates.map((m, i) => {
            const checked = selected === m.user_id;
            return (
              <label
                key={m.user_id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                  checked
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/50",
                )}
              >
                <input
                  type="radio"
                  name="new-owner"
                  value={m.user_id}
                  checked={checked}
                  onChange={() => setSelected(m.user_id)}
                  autoFocus={i === 0}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {m.name || m.email}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {m.name ? `${m.email}, ` : ""}
                    <span className="capitalize">{m.role}</span>
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
    </EditDialog>
  );
}
