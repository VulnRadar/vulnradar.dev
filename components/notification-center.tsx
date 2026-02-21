"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import {
  X,
  Sparkles,
  ArrowRight,
  AlertTriangle,
  MessageCircle,
  Bell,
  ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  VERSION_COOKIE_NAME,
  VERSION_COOKIE_MAX_AGE,
  APP_VERSION,
  APP_NAME,
} from "@/lib/constants"
import { PUBLIC_PATHS } from "@/lib/public-paths"
import { useAuth } from "@/components/auth-provider"

// ─── Cookie Helpers ──────────────────────────────────────────────

const DISCORD_COOKIE = "vulnradar_discord_dismissed"
const DISCORD_INVITE_URL = "https://discord.gg/Y7R6hdGbNe"

function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined
  const cookies = document.cookie.split("; ")
  return cookies.find((c) => c.startsWith(`${name}=`))?.split("=")[1]
}

function setCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`
}

// ─── Backup Codes Modal (always shows as full-screen overlay) ────

export function BackupCodesModal() {
  const router = useRouter()
  const pathname = usePathname()
  const [dismissed, setDismissed] = useState(false)
  const [closing, setClosing] = useState(false)
  const { me } = useAuth()

  const isPublicRoute = PUBLIC_PATHS.some((p) => {
    if (p === "/" || p === "/landing") return pathname === p
    return pathname.startsWith(p)
  })

  const show = !isPublicRoute && me?.userId && me?.backupCodesInvalid && !dismissed

  if (!show) return null

  const handleDismiss = () => {
    setClosing(true)
    setTimeout(() => setDismissed(true), 200)
  }

  return (
    <div className={cn(
      "fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm",
      closing ? "animate-out fade-out duration-200" : "animate-in fade-in duration-200",
    )}>
      <div className={cn(
        "relative w-full max-w-lg mx-4",
        closing ? "animate-out zoom-out-95 duration-200" : "animate-in zoom-in-95 duration-300",
      )}>
        <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
          <div className="h-1 w-full bg-destructive" />
          <div className="flex items-center justify-between px-5 pt-4 pb-0">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                Security Alert
              </span>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-8 pt-6 pb-4 flex flex-col items-center text-center">
            <div className="p-4 rounded-2xl mb-5 bg-destructive/10 text-destructive">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-3 text-balance">
              Backup Codes Need Rotation
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm text-pretty">
              We upgraded our security to hash all 2FA backup codes. Your old backup codes will no longer work. Please regenerate them from your profile.
            </p>
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2.5 mt-3 w-full max-w-sm">
              <p className="text-xs text-destructive font-medium">
                Until you regenerate, you cannot use backup codes to log in if you lose your authenticator app.
              </p>
            </div>
          </div>
          <div className="px-8 pb-6 pt-3 flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" className="bg-transparent" onClick={handleDismiss}>
              Remind Me Later
            </Button>
            <Button size="sm" onClick={() => { handleDismiss(); router.push("/profile") }}>
              Rotate Backup Codes
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Notification Item Type ──────────────────────────────────────

interface NotifItem {
  id: string
  icon: React.ReactNode
  iconBg: string
  title: string
  description: string
  action: { label: string; onClick: () => void }
  onDismiss: () => void
}

// ─── Notification Bell (header dropdown) ─────────────────────────

export function NotificationBell() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [versionDismissed, setVersionDismissed] = useState(true)
  const [discordDismissed, setDiscordDismissed] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const { me } = useAuth()

  const isPublicRoute = PUBLIC_PATHS.some((p) => {
    if (p === "/" || p === "/landing") return pathname === p
    return pathname.startsWith(p)
  })

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", handle)
    return () => document.removeEventListener("mousedown", handle)
  }, [open])

  // Check notification dismissal state
  useEffect(() => {
    if (!me?.userId) return
    const lastSeenVersion = getCookie(VERSION_COOKIE_NAME)
    if (!lastSeenVersion || lastSeenVersion !== APP_VERSION) setVersionDismissed(false)
    const discordSeen = getCookie(DISCORD_COOKIE)
    if (!discordSeen) setDiscordDismissed(false)
  }, [me?.userId])

  const dismissVersion = useCallback(() => {
    setCookie(VERSION_COOKIE_NAME, APP_VERSION, VERSION_COOKIE_MAX_AGE)
    setVersionDismissed(true)
  }, [])

  const dismissDiscord = useCallback(() => {
    setCookie(DISCORD_COOKIE, "1", 60 * 60 * 24 * 30)
    setDiscordDismissed(true)
  }, [])

  const notifications = useMemo<NotifItem[]>(() => {
    const list: NotifItem[] = []

    if (!versionDismissed) {
      list.push({
        id: "version",
        icon: <Sparkles className="h-4 w-4" />,
        iconBg: "bg-primary/10 text-primary",
        title: `${APP_NAME} v${APP_VERSION} Released`,
        description: "New features, improvements, and bug fixes are available.",
        action: {
          label: "View Changelog",
          onClick: () => { dismissVersion(); setOpen(false); router.push("/changelog") },
        },
        onDismiss: dismissVersion,
      })
    }

    if (!discordDismissed) {
      list.push({
        id: "discord",
        icon: (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" />
          </svg>
        ),
        iconBg: "bg-[#5865F2]/10 text-[#5865F2]",
        title: "Join Our Discord",
        description: "Connect with the community, get support, and stay updated.",
        action: {
          label: "Join Server",
          onClick: () => { dismissDiscord(); setOpen(false); window.open(DISCORD_INVITE_URL, "_blank", "noopener,noreferrer") },
        },
        onDismiss: dismissDiscord,
      })
    }

    return list
  }, [versionDismissed, discordDismissed, dismissVersion, dismissDiscord, router])

  const count = notifications.length

  // Always render space to prevent layout shift
  if (isPublicRoute) return <div className="h-8 w-8" />
  if (!me?.userId) return <div className="h-8 w-8" />

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(!open)}
        aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ""}`}
        className="relative text-muted-foreground hover:text-foreground h-8 w-8"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {count}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {count > 0 && (
              <span className="text-xs text-muted-foreground">{count} new</span>
            )}
          </div>

          {/* Items */}
          {count === 0 ? (
            <div className="px-4 py-8 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">All caught up!</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {notifications.map((n) => (
                <div key={n.id} className="px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={cn("flex-shrink-0 p-2 rounded-lg", n.iconBg)}>
                      {n.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.description}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={n.action.onClick}
                          className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                        >
                          {n.action.label}
                          {n.id === "discord" ? <ExternalLink className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
                        </button>
                        <button
                          onClick={n.onDismiss}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={n.onDismiss}
                      className="flex-shrink-0 p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                      aria-label={`Dismiss ${n.title}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
