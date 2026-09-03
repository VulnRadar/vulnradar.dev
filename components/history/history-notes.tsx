"use client";

import { useState } from "react";
import { MessageSquare, Pencil, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HistoryNotesProps {
  notes: string;
  isOwner: boolean;
  /** Resolves to the server error on failure, or null when the note saved.
   *  A void return used to make a failed PATCH indistinguishable from a
   *  successful one: the editor closed either way and the text was gone. */
  onSave: (notes: string) => Promise<string | null>;
}

export function HistoryNotes({
  notes: initialNotes,
  isOwner,
  onSave,
}: HistoryNotesProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const error = await onSave(notes);
    setSaving(false);
    if (error) {
      // Stay in edit mode with the typed text intact. Collapsing the editor
      // here is what made a lost paragraph of remediation notes read as a
      // successful save.
      setSaveError(error);
      return;
    }
    setEditing(false);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Notes</h3>
        </div>
        {isOwner && (
          <>
            {!editing ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(true)}
                className="h-7 text-xs gap-1.5 text-muted-foreground"
              >
                <Pencil className="h-3 w-3" />
                {notes ? "Edit" : "Add note"}
              </Button>
            ) : (
              <div className="flex gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setNotes(initialNotes);
                    setSaveError(null);
                  }}
                  className="h-7 text-xs text-muted-foreground"
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                  className="h-7 text-xs gap-1.5 bg-transparent"
                >
                  {saving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  Save
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {editing && isOwner ? (
        <>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
            placeholder="Add notes about this scan..."
            aria-label="Scan notes"
            maxLength={2000}
            // rounded-md and a 2px ring: this is a control, and both the
            // radius ladder and every other input in the product say so. It
            // was the only text field left drawing a 1px focus ring.
            className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring resize-y"
          />
          {saveError && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {saveError} Your text is still here, nothing was saved.
            </p>
          )}
        </>
      ) : notes ? (
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
    </div>
  );
}
