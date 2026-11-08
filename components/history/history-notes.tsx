"use client";

import { useId, useState } from "react";
import { MessageSquare, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EditDialog } from "@/components/shared/edit-dialog";

/** Same cap the PATCH route and the old inline textarea enforced. */
export const NOTES_MAX_LENGTH = 2000;

export const NOTES_KEPT_SENTENCE =
  "Your text is still here, nothing was saved.";

/** Resolves to null when the note saved, or to the message the dialog shows
 *  while it stays open with the draft in it. */
export async function saveNotesDraft(
  onSave: (notes: string) => Promise<string | null>,
  draft: string,
): Promise<string | null> {
  const error = await onSave(draft);
  return error ? `${error} ${NOTES_KEPT_SENTENCE}` : null;
}

interface HistoryNotesProps {
  notes: string;
  isOwner: boolean;
  /** Resolves to the server error on failure, or null when the note saved.
   *  A void return used to make a failed PATCH indistinguishable from a
   *  successful one: the editor closed either way and the text was gone. */
  onSave: (notes: string) => Promise<string | null>;
}

export function HistoryNotes({ notes, isOwner, onSave }: HistoryNotesProps) {
  // The card renders the prop, never a copy of it. The copy this replaced was
  // seeded once and never re-synced, so the card could go on showing a note
  // the scan no longer had.
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Notes</h3>
        </div>
        {isOwner && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            className="h-11 sm:h-7 text-xs gap-1.5 text-muted-foreground"
          >
            <Pencil className="h-3 w-3" />
            {notes ? "Edit" : "Add note"}
          </Button>
        )}
      </div>

      {notes ? (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {notes}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground/60 italic">
          {isOwner
            ? "No notes yet. Add one so the next person reading this report knows what state the host was in."
            : "No notes for this scan."}
        </p>
      )}

      {editing && isOwner && (
        <NotesDialog
          notes={notes}
          onSave={onSave}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/**
 * Mounted only while open, so the draft is seeded from the saved note on every
 * opening and a refetch of the scan cannot reset it mid-edit. An empty note is
 * a valid save: it is how a note is cleared.
 */
export function NotesDialog({
  notes,
  onSave,
  onClose,
}: {
  notes: string;
  onSave: (notes: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(notes);
  const fieldId = useId();

  return (
    <EditDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Notes on this scan"
      saveLabel="Save note"
      size="md"
      dirty={draft !== notes}
      onSave={() => saveNotesDraft(onSave, draft)}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId}>Scan notes</Label>
        <Textarea
          id={fieldId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add notes about this scan..."
          maxLength={NOTES_MAX_LENGTH}
          autoFocus
          className="min-h-[140px] resize-y"
        />
      </div>
    </EditDialog>
  );
}
