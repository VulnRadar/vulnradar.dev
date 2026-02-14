"use client"

import { useState } from "react"
import { Share2, Check, Link2, Loader2, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ShareButtonProps {
  scanId: number
}

/**
 * Clipboard write with fallback for mobile browsers that don't support
 * navigator.clipboard (or block it outside secure user-gesture contexts).
 */
async function copyText(text: string): Promise<boolean> {
  // Try modern clipboard API first
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to legacy fallback
    }
  }

  // Legacy fallback using textarea + execCommand
  try {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.style.position = "fixed"
    textarea.style.left = "-9999px"
    textarea.style.top = "-9999px"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const success = document.execCommand("copy")
    document.body.removeChild(textarea)
    return success
  } catch {
    return false
  }
}

/**
 * Try the Web Share API (native share sheet on mobile), returns true if shared.
 */
async function tryNativeShare(url: string, title: string): Promise<boolean> {
  if (typeof navigator.share !== "function") return false
  try {
    await navigator.share({ title, text: "Check out this VulnRadar scan report", url })
    return true
  } catch {
    // User cancelled or share failed - not an error
    return false
  }
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

        // On mobile, prefer native share sheet
        const shared = await tryNativeShare(url, "VulnRadar Scan Report")
        if (shared) {
          setState("shared")
          return
        }

        // Otherwise copy to clipboard
        const copied = await copyText(url)
        if (copied) {
          setState("copied")
          setTimeout(() => setState("shared"), 2000)
        } else {
          // Even if copy fails, still show the link is generated
          setState("shared")
        }
      } else {
        setState("idle")
      }
    } catch {
      setState("idle")
    }
  }

  async function handleCopy() {
    if (!shareUrl) return

    // Try native share first on mobile
    const shared = await tryNativeShare(shareUrl, "VulnRadar Scan Report")
    if (shared) return

    const copied = await copyText(shareUrl)
    if (copied) {
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
