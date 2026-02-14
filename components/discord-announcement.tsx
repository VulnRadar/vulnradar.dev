"use client"

import { useEffect, useState } from "react"
import { X, MessageCircle, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

const DISCORD_COOKIE = "vulnradar_discord_dismissed"
const DISCORD_INVITE_URL = "https://discord.gg/HdKhq7B5S4"

export function DiscordAnnouncement() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const cookies = document.cookie.split("; ")
    const dismissed = cookies.some((c) => c.startsWith(`${DISCORD_COOKIE}=`))
    if (!dismissed) {
      // Small delay so it doesn't flash instantly
      const timer = setTimeout(() => setShow(true), 800)
      return () => clearTimeout(timer)
    }
  }, [])

  const dismiss = () => {
    // Cookie lasts 30 days
    document.cookie = `${DISCORD_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`
    setShow(false)
  }

  const handleJoin = () => {
    dismiss()
    window.open(DISCORD_INVITE_URL, "_blank", "noopener,noreferrer")
  }

  if (!show) return null

  return (
    <div className="fixed top-4 right-4 z-[90] animate-in slide-in-from-right-full fade-in duration-500 w-[340px] max-w-[calc(100vw-2rem)]">
      <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Accent bar */}
        <div className="h-1 w-full bg-[#5865F2]" />

        <div className="p-4">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-[#5865F2]/10 shrink-0">
              <svg className="h-5 w-5 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Join our Discord!</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Connect with the community, get support, and stay up to date with the latest VulnRadar news.
              </p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-0.5"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3 ml-11">
            <Button
              size="sm"
              className="bg-[#5865F2] hover:bg-[#4752C4] text-white gap-1.5 text-xs"
              onClick={handleJoin}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Join Server
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={dismiss}
            >
              Maybe later
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
