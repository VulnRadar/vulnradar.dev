"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EditDialog,
  type EditSaveOutcome,
} from "@/components/shared/edit-dialog";

/** The name a rename would send: trimmed, and only when it is a change. */
export function renameCandidate(saved: string, draft: string): string | null {
  const next = draft.trim();
  return next !== "" && next !== saved ? next : null;
}

/**
 * Renaming a team, from its own page and from the admin Teams tab.
 *
 * The length limit is the server's. Both routes check the editable
 * MAX_TEAM_NAME_LENGTH setting, so a number typed here could only drift from
 * it, and a name past the limit is refused with the reason shown in this
 * dialog, the draft still in the field.
 */
export function RenameTeamDialog({
  team,
  onRename,
  onClose,
}: {
  team: { name: string };
  /** The new name, trimmed. A refusal is { ok: false, error } or a throw. */
  onRename: (name: string) => EditSaveOutcome | Promise<EditSaveOutcome>;
  onClose: () => void;
}) {
  // Mounted only while open, so every opening starts from the saved name and a
  // refetch of the team list cannot reset a draft that is being typed.
  const [name, setName] = useState(team.name);
  const fieldId = useId();
  const next = renameCandidate(team.name, name);

  return (
    <EditDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Rename team"
      description={`Everyone in ${team.name} sees the new name straight away. They are not told it changed.`}
      size="sm"
      saveLabel="Rename team"
      dirty={name !== team.name}
      canSave={next !== null}
      onSave={() => (next === null ? undefined : onRename(next))}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={fieldId}>Team name</Label>
        <Input
          id={fieldId}
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          autoFocus
        />
      </div>
    </EditDialog>
  );
}
