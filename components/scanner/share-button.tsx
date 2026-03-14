"use client"

import { useState } from "react"
import { Share2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { API } from "@/lib/constants"
import { ShareModal } from "./share-modal"

interface ShareButtonProps {
  scanId: number
}

export function ShareButton({ scanId }: ShareButtonProps) {
  const [loading, setLoading] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  async function handleShare() {
    // If we already have a share URL, just open the modal
    if (shareUrl) {
      setModalOpen(true)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${API.HISTORY}/${scanId}/share`, { method: "POST" })
      const data = await res.json()
      if (res.ok && data.token) {
        const url = `${window.location.origin}/shared/${data.token}`
        setShareUrl(url)
        setModalOpen(true)
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={handleShare}
        disabled={loading}
        size="sm"
        className="gap-2 bg-transparent"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="hidden sm:inline">Sharing...</span>
          </>
        ) : (
          <>
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">Share</span>
          </>
        )}
      </Button>

      {shareUrl && (
        <ShareModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          shareUrl={shareUrl}
        />
      )}
    </>
  )
}
