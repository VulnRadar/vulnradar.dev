"use client";

import { useState } from "react";
import { Trash2, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API } from "@/lib/config/constants";
import { apiDelete } from "@/lib/api/client";

interface DeleteScanButtonProps {
  scanId: number;
  onDeleted: () => void;
  isOwner: boolean;
}

export function DeleteScanButton({
  scanId,
  onDeleted,
  isOwner,
}: DeleteScanButtonProps) {
  const [state, setState] = useState<
    "idle" | "confirming" | "deleting" | "deleted"
  >("idle");

  if (!isOwner) {
    return null;
  }

  async function handleDelete() {
    setState("deleting");
    try {
      await apiDelete(`${API.HISTORY}/${scanId}/delete`);
      setState("deleted");
      setTimeout(() => onDeleted(), 500);
    } catch {
      setState("idle");
    }
  }

  if (state === "deleted") {
    return (
      <Button
        variant="outline"
        disabled
        size="sm"
        className="gap-2 bg-transparent text-muted-foreground"
        aria-label="Scan deleted"
      >
        <Trash2 className="h-4 w-4" />
        <span className="hidden sm:inline">Deleted</span>
      </Button>
    );
  }

  if (state === "confirming") {
    return (
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          disabled={false}
          className="gap-2"
          aria-label="Confirm delete"
        >
          <>
            <AlertCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Confirm</span>
          </>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setState("idle")}
          disabled={false}
          className="bg-transparent"
          aria-label="Cancel delete"
        >
          <span className="hidden sm:inline">Cancel</span>
          <span className="sm:hidden">
            <X className="h-4 w-4" />
          </span>
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setState("confirming")}
      className="gap-2 bg-transparent text-destructive hover:text-destructive hover:bg-destructive/10"
      aria-label="Delete scan"
    >
      <Trash2 className="h-4 w-4" />
      <span className="hidden sm:inline">Delete scan</span>
    </Button>
  );
}
