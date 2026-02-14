"use client"

import { useState } from "react"
import { Share2, Check, Link2, Loader2, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ShareButtonProps {
  scanId: number
}

export function ShareButton({ scanId }: ShareButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "shared" | "copied">("idle")
  const [shareUrl, setShareUrl] = useState<string | null>(null)

  async function handleShare() {
    setState("loading")
    try {
      const res = await fetch(`/api/history/${scanId}/share`, { method: "POST" })
      const data = await res.json()
      if (res.ok && data.token) {
        const url = `${window.location.origin}/shared/${data.token}`
        setShareUrl(url)
        await navigator.clipboard.writeText(url)
        setState("copied")
        setTimeout(() => setState("shared"), 2000)
      } else {
        setState("idle")
      }
    } catch {
      setState("idle")
    }
  }

  async function handleCopy() {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl)
      setState("copied")
      setTimeout(() => setState("shared"), 2000)
    }
  }

  async function handleRevoke() {
    try {
      await fetch(`/api/history/${scanId}/share`, { method: "DELETE" })
      setShareUrl(null)
      setState("idle")
    } catch {
      // silently fail
    }
  }

  if (state === "idle") {
    return (
      <Button variant="outline" onClick={handleShare} size="sm" className="gap-2 bg-transparent">
        <Share2 className="h-4 w-4" />
        Share
      </Button>
    )
  }

  if (state === "loading") {
    return (
      <Button variant="outline" disabled size="sm" className="gap-2 bg-transparent">
        <Loader2 className="h-4 w-4 animate-spin" />
        Sharing...
      </Button>
    )
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        onClick={handleCopy}
        size="sm"
        className="gap-2 bg-transparent"
      >
        {state === "copied" ? (
          <>
            <Check className="h-4 w-4 text-emerald-500" />
            Link Copied
          </>
        ) : (
          <>
            <Link2 className="h-4 w-4" />
            Copy Link
          </>
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleRevoke}
        className="text-muted-foreground hover:text-destructive"
        title="Revoke share link"
      >
        <Unlink className="h-4 w-4" />
      </Button>
    </div>
  )
}
