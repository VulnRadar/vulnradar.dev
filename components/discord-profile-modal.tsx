"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Check, Loader2, Sparkles } from "lucide-react"

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
      <DialogContent className="sm:max-w-[420px] p-0 overflow-hidden border-0 gap-0">
        {/* Header with Discord branding */}
        <div className="relative bg-[#5865F2] px-6 pt-8 pb-14">
          {/* Decorative background pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-4 left-8 w-16 h-16 rounded-full bg-white/20" />
            <div className="absolute top-12 right-12 w-8 h-8 rounded-full bg-white/20" />
            <div className="absolute bottom-8 left-1/4 w-6 h-6 rounded-full bg-white/20" />
          </div>
          
          <div className="relative flex items-center gap-3">
            <svg className="h-8 w-8 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
            <div>
              <h2 className="text-xl font-bold text-white">Discord Connected!</h2>
              <p className="text-white/80 text-sm">Your account is now linked</p>
            </div>
          </div>
        </div>

        {/* Avatar overlapping header */}
        <div className="relative -mt-10 flex justify-center">
          <div className="relative">
            <Avatar className="h-20 w-20 border-4 border-background ring-4 ring-[#5865F2]/20">
              <AvatarImage src={discordAvatar || undefined} alt={discordUsername} />
              <AvatarFallback className="bg-[#5865F2] text-white text-2xl font-bold">
                {discordUsername?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center ring-2 ring-background">
              <Check className="h-3.5 w-3.5 text-white" />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pt-4 pb-6">
          <div className="text-center mb-6">
            <p className="text-lg font-semibold text-foreground">{discordUsername}</p>
            <p className="text-sm text-muted-foreground">Discord Profile</p>
          </div>

          {/* Question card */}
          <div className="rounded-xl bg-muted/50 border border-border p-4 mb-6">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-[#5865F2]/10 shrink-0">
                <Sparkles className="h-4 w-4 text-[#5865F2]" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Sync your profile?</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Use your Discord avatar and username as your VulnRadar profile.
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 mb-4">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleUseDiscordProfile}
              disabled={loading}
              className="w-full h-11 bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Yes, use Discord profile
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={loading}
              className="w-full h-11 text-muted-foreground hover:text-foreground"
            >
              No thanks, keep my current profile
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
