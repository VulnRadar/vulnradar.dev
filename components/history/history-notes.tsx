"use client";

import { useState } from "react";
import { MessageSquare, Pencil, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HistoryNotesProps {
  notes: string;
  isOwner: boolean;
  onSave: (notes: string) => Promise<void>;
}

export function HistoryNotes({
  notes: initialNotes,
  isOwner,
  onSave,
}: HistoryNotesProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(notes);
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-4">
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
                {notes ? "Edit" : "Add Note"}
              </Button>
            ) : (
              <div className="flex gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setNotes(initialNotes);
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
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
          placeholder="Add notes about this scan..."
          maxLength={2000}
          className="w-full min-h-[80px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
        />
      ) : notes ? (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {notes}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground/60 italic">
          {isOwner
            ? 'No notes yet. Click "Add Note" to annotate this scan.'
            : "No notes for this scan."}
        </p>
      )}
    </div>
  );
}
