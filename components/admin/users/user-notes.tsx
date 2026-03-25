"use client"

import { useState } from "react"
import { StickyNote, Send, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { UserAvatar } from "../shared/user-avatar"
import { formatRelativeTime } from "../utils"
import type { AdminNote } from "../types"

interface UserNotesProps {
  notes: AdminNote[]
  onAddNote: (note: string) => Promise<void>
  loading?: boolean
}

export function UserNotes({ notes, onAddNote, loading }: UserNotesProps) {
  const [newNote, setNewNote] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!newNote.trim()) return
    setSubmitting(true)
    try {
      await onAddNote(newNote.trim())
      setNewNote("")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Add Note */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-0 pt-4 px-4">
          <div className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Add Note
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          <div className="space-y-3">
            <Textarea
              placeholder="Add an internal note about this user..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="min-h-[80px] text-sm resize-none"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={handleSubmit}
                disabled={!newNote.trim() || submitting}
              >
                {submitting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Add Note
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes History */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-0 pt-4 px-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Notes History ({notes.length})
          </p>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          {notes.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No notes yet</p>
          ) : (
            <div className="space-y-3">
              {notes.map((note) => (
                <div key={note.id} className="p-3 rounded-lg bg-muted/30 border border-border">
                  <div className="flex items-start gap-2.5">
                    <UserAvatar
                      name={note.admin_name}
                      email={note.admin_email}
                      size="xs"
                      avatarUrl={note.admin_avatar_url}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-foreground">
                          {note.admin_name || note.admin_email.split("@")[0]}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(new Date(note.created_at))}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                        {note.note}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
