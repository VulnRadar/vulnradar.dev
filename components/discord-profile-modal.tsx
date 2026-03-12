"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Check, X, Loader2 } from "lucide-react"
import { API } from "@/lib/client-constants"

// Auth update endpoint for profile changes
const AUTH_UPDATE_ENDPOINT = "/api/v2/auth/update"

export function DiscordProfileModal() {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const discordConnected = searchParams.get("discord_connected") === "true"
  const discordUsername = searchParams.get("discord_username")
  const discordAvatar = searchParams.get("discord_avatar")
  
  const [open, setOpen] = useState(discordConnected && !!discordUsername)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleClose = () => {
    setOpen(false)
    // Clean up URL params
    const url = new URL(window.location.href)
    url.searchParams.delete("discord_connected")
    url.searchParams.delete("discord_username")
    url.searchParams.delete("discord_avatar")
    router.replace(url.pathname + url.search)
  }

  const handleUseDiscordProfile = async () => {
    setLoading(true)
    setError("")
    
    try {
      const res = await fetch(AUTH_UPDATE_ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: discordUsername,
          avatarUrl: discordAvatar,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Failed to update profile")
        return
      }

      // Refresh the page to show updated profile
      handleClose()
      router.refresh()
      window.location.reload()
    } catch {
      setError("Failed to update profile")
    } finally {
      setLoading(false)
    }
  }

  if (!discordConnected || !discordUsername) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <svg className="h-5 w-5 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
            Discord Connected!
          </DialogTitle>
          <DialogDescription>
            Would you like to use your Discord profile picture and username for your VulnRadar account?
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-6">
          <div className="relative">
            <Avatar className="h-24 w-24 border-4 border-[#5865F2]/20">
              <AvatarImage src={discordAvatar || undefined} alt={discordUsername} />
              <AvatarFallback className="bg-[#5865F2]/10 text-[#5865F2] text-2xl">
                {discordUsername?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-[#5865F2] flex items-center justify-center">
              <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-lg font-semibold">{discordUsername}</p>
            <p className="text-sm text-muted-foreground">Your Discord username</p>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={loading}
            className="flex items-center gap-2"
          >
            <X className="h-4 w-4" />
            No, keep my current profile
          </Button>
          <Button
            onClick={handleUseDiscordProfile}
            disabled={loading}
            className="flex items-center gap-2 bg-[#5865F2] hover:bg-[#4752C4]"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Yes, use Discord profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
