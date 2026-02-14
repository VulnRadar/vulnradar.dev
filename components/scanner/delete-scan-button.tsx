"use client"

import { useState } from "react"
import { Trash2, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

interface DeleteScanButtonProps {
  scanId: number
  onDeleted: () => void
  isOwner: boolean
}

export function DeleteScanButton({ scanId, onDeleted, isOwner }: DeleteScanButtonProps) {
  const [state, setState] = useState<"idle" | "confirming" | "deleting" | "deleted">("idle")

  if (!isOwner) {
    return null
  }

  async function handleDelete() {
    setState("deleting")
    try {
      const res = await fetch(`/api/history/${scanId}/delete`, { method: "DELETE" })
      if (res.ok) {
        setState("deleted")
        setTimeout(() => onDeleted(), 500)
      } else {
        setState("idle")
      }
    } catch {
      setState("idle")
    }
  }

  if (state === "deleted") {
    return (
      <Button variant="outline" disabled size="sm" className="gap-2 bg-transparent text-muted-foreground">
        <Trash2 className="h-4 w-4" />
        Deleted
      </Button>
    )
  }

  if (state === "confirming") {
    return (
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          disabled={state === "deleting"}
          className="gap-2"
        >
          {state === "deleting" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Deleting...
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4" />
              Confirm Delete
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setState("idle")}
          disabled={state === "deleting"}
          className="bg-transparent"
        >
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setState("confirming")}
      className="gap-2 bg-transparent text-destructive hover:text-destructive hover:bg-destructive/10"
    >
      <Trash2 className="h-4 w-4" />
      Delete Scan
    </Button>
  )
}
