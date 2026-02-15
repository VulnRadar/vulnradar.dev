"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useRouter, usePathname } from "next/navigation"
import useSWR from "swr"
import {
  X,
  Sparkles,
  ArrowRight,
  AlertTriangle,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Bell,
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

// ─── Notification Types ──────────────────────────────────────────

interface Notification {
  id: string
  priority: number // higher = more important, shown first
  icon: React.ReactNode
  accentColor: string
  badge?: string
  title: string
  description: string
  extraContent?: React.ReactNode
  primaryAction: { label: string; icon?: React.ReactNode; onClick: () => void; className?: string }
  secondaryAction?: { label: string; onClick: () => void }
}

// ─── Cookie Helpers ──────────────────────────────────────────────

const DISCORD_COOKIE = "vulnradar_discord_dismissed"
const DISCORD_INVITE_URL = "https://discord.gg/Y7R6hdGbNe"

function getCookie(name: string): string | undefined {
  const cookies = document.cookie.split("; ")
  return cookies.find((c) => c.startsWith(`${name}=`))?.split("=")[1]
}

function setCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`
}

// ─── Notification Center ─────────────────────────────────────────

export function NotificationCenter() {
  const router = useRouter()
  const pathname = usePathname()
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [closing, setClosing] = useState(false)

  // Dismissed states
  const [versionDismissed, setVersionDismissed] = useState(true)
  const [discordDismissed, setDiscordDismissed] = useState(true)
  const [backupDismissed, setBackupDismissed] = useState(false)

  const isPublicRoute = PUBLIC_PATHS.some((p) => {
    if (p === "/" || p === "/landing") return pathname === p
    return pathname.startsWith(p)
  })

  const { data: me } = useSWR(
    isPublicRoute ? null : "/api/auth/me",
    (url: string) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  )

  // Check auth + cookie state on mount
  useEffect(() => {
    if (isPublicRoute) {
      setIsLoggedIn(false)
      return
    }

    if (me?.userId) {
      setIsLoggedIn(true)

      // Version check
      const lastSeenVersion = getCookie(VERSION_COOKIE_NAME)
      if (!lastSeenVersion || lastSeenVersion !== APP_VERSION) {
        setVersionDismissed(false)
      }

      // Discord check
      const discordSeen = getCookie(DISCORD_COOKIE)
      if (!discordSeen) {
        setDiscordDismissed(false)
      }
    }
  }, [isPublicRoute, me?.userId])

  // ─── Dismiss handlers ──────────────────────────────

  const dismissVersion = useCallback(() => {
    setCookie(VERSION_COOKIE_NAME, APP_VERSION, VERSION_COOKIE_MAX_AGE)
    setVersionDismissed(true)
  }, [])

  const dismissDiscord = useCallback(() => {
    setCookie(DISCORD_COOKIE, "1", 60 * 60 * 24 * 30)
    setDiscordDismissed(true)
  }, [])

  const dismissBackup = useCallback(() => {
    setBackupDismissed(true)
  }, [])

  // ─── Build notification list ───────────────────────

  const notifications = useMemo<Notification[]>(() => {
    const list: Notification[] = []

    // Backup codes warning (highest priority)
    if (me?.backupCodesInvalid && !backupDismissed) {
      list.push({
        id: "backup-codes",
        priority: 100,
        icon: <AlertTriangle className="h-6 w-6" />,
        accentColor: "bg-destructive",
        title: "Backup Codes Need Rotation",
        description:
          "We upgraded our security to hash all 2FA backup codes. Your old backup codes will no longer work. Please regenerate them from your profile.",
        extraContent: (
          <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2.5 mt-1">
            <p className="text-xs text-destructive font-medium">
              Until you regenerate, you cannot use backup codes to log in if you lose your authenticator app.
            </p>
          </div>
        ),
        primaryAction: {
          label: "Rotate Backup Codes",
          onClick: () => {
            dismissBackup()
            router.push("/profile")
          },
        },
        secondaryAction: { label: "Remind Me Later", onClick: dismissBackup },
      })
    }

    // New version (high priority)
    if (!versionDismissed) {
      list.push({
        id: "version",
        priority: 50,
        icon: <Sparkles className="h-6 w-6" />,
        accentColor: "bg-gradient-to-r from-primary via-emerald-500 to-primary",
        badge: `v${APP_VERSION}`,
        title: `${APP_NAME} Has Been Updated!`,
        description:
          "We've added new features, improvements, and bug fixes to make your security scanning experience even better.",
        primaryAction: {
          label: "View Changelog",
          icon: <ArrowRight className="h-3.5 w-3.5" />,
          onClick: () => {
            dismissVersion()
            router.push("/changelog")
          },
        },
        secondaryAction: { label: "Dismiss", onClick: dismissVersion },
      })
    }

    // Discord announcement (lower priority)
    if (!discordDismissed) {
      list.push({
        id: "discord",
        priority: 10,
        icon: (
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" />
          </svg>
        ),
        accentColor: "bg-[#5865F2]",
        title: "Join our Discord!",
        description:
          "Connect with the community, get support, and stay up to date with the latest VulnRadar news.",
        primaryAction: {
          label: "Join Server",
          icon: <MessageCircle className="h-3.5 w-3.5" />,
          className: "bg-[#5865F2] hover:bg-[#4752C4] text-white",
          onClick: () => {
            dismissDiscord()
            window.open(DISCORD_INVITE_URL, "_blank", "noopener,noreferrer")
          },
        },
        secondaryAction: { label: "Maybe later", onClick: dismissDiscord },
      })
    }

    // Sort by priority descending
    return list.sort((a, b) => b.priority - a.priority)
  }, [me?.backupCodesInvalid, backupDismissed, versionDismissed, discordDismissed, dismissBackup, dismissVersion, dismissDiscord, router])

  // Reset index if it goes out of bounds
  useEffect(() => {
    if (currentIndex >= notifications.length && notifications.length > 0) {
      setCurrentIndex(Math.max(0, notifications.length - 1))
    }
  }, [notifications.length, currentIndex])

  if (!isLoggedIn || notifications.length === 0) return null

  const current = notifications[Math.min(currentIndex, notifications.length - 1)]
  if (!current) return null

  const handleDismissCurrent = () => {
    current.secondaryAction?.onClick()
  }

  const handleClose = () => {
    setClosing(true)
    setTimeout(() => {
      // Dismiss all
      notifications.forEach((n) => n.secondaryAction?.onClick())
    }, 200)
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
          {/* Accent bar */}
          <div className={cn("h-1 w-full", current.accentColor)} />

          {/* Header bar with counter + close */}
          <div className="flex items-center justify-between px-5 pt-4 pb-0">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Bell className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                Notifications
              </span>
            </div>
            <div className="flex items-center gap-2">
              {notifications.length > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                    disabled={currentIndex === 0}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                    aria-label="Previous notification"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-mono text-muted-foreground tabular-nums min-w-[2rem] text-center">
                    {currentIndex + 1}/{notifications.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentIndex((i) => Math.min(notifications.length - 1, i + 1))}
                    disabled={currentIndex === notifications.length - 1}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                    aria-label="Next notification"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={handleClose}
                className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss all notifications"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-8 pt-6 pb-4 flex flex-col items-center text-center">
            {/* Icon */}
            <div className={cn(
              "p-4 rounded-2xl mb-5",
              current.id === "backup-codes" && "bg-destructive/10 text-destructive",
              current.id === "version" && "bg-primary/10 text-primary",
              current.id === "discord" && "bg-[#5865F2]/10 text-[#5865F2]",
            )}>
              {current.icon}
            </div>

            {/* Badge */}
            {current.badge && (
              <div className="inline-flex items-center gap-2 mb-2">
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                  New Version
                </span>
                <span className="inline-flex items-center rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-xs font-semibold font-mono">
                  {current.badge}
                </span>
              </div>
            )}

            {/* Title */}
            <h2 className="text-xl font-bold text-foreground mb-3 text-balance">
              {current.title}
            </h2>

            {/* Description */}
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm text-pretty">
              {current.description}
            </p>

            {/* Extra content (e.g. backup code warning box) */}
            {current.extraContent && (
              <div className="w-full max-w-sm mt-3">
                {current.extraContent}
              </div>
            )}
          </div>

          {/* Pagination dots */}
          {notifications.length > 1 && (
            <div className="flex justify-center gap-1.5 pb-2">
              {notifications.map((n, i) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setCurrentIndex(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    i === currentIndex ? "w-6 bg-foreground" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50",
                  )}
                  aria-label={`Go to notification ${i + 1}`}
                />
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="px-8 pb-6 pt-3 flex items-center justify-center gap-3">
            {current.secondaryAction && (
              <Button
                variant="outline"
                size="sm"
                className="bg-transparent"
                onClick={handleDismissCurrent}
              >
                {current.secondaryAction.label}
              </Button>
            )}
            <Button
              size="sm"
              className={cn("gap-1.5", current.primaryAction.className)}
              onClick={current.primaryAction.onClick}
            >
              {current.primaryAction.label}
              {current.primaryAction.icon}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
