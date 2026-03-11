"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { usePathname } from "next/navigation"
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
            <Button size="sm" asChild>
              <a href="/profile#account" onClick={handleDismiss}>Rotate Backup Codes</a>
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
  action: { label: string; href?: string; onClick?: () => void }
  onDismiss: () => void
}

interface CustomNotification {
  id: string
  title: string
  message: string
  type: "warning" | "info" | "success" | "error"
  actionLabel?: string
  actionUrl?: string
  autoClose?: boolean
  autoCloseDelay?: number
}

// ─── Notification Bell (header dropdown) ─────────────────────────

function initVersionDismissed(): boolean {
  if (typeof document === "undefined") return true
  const v = getCookie(VERSION_COOKIE_NAME)
  return !!v && v === APP_VERSION
}


export function NotificationBell() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [versionDismissed, setVersionDismissed] = useState(initVersionDismissed)
  const [customNotifs, setCustomNotifs] = useState<CustomNotification[]>([])
  const [hydrated, setHydrated] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useAuth() // ensure auth hook runs for side-effects (if any), but avoid unused variable

  const isPublicRoute = PUBLIC_PATHS.some((p) => {
    if (p === "/" || p === "/landing") return pathname === p
    return pathname.startsWith(p)
  })

  // Listen for custom notifications from AdminVersionNotifier
  useEffect(() => {
    function handleCustomNotif(e: Event) {
      const evt = e as CustomEvent<CustomNotification>
      if (evt.detail) {
        setCustomNotifs((prev) => {
          const filtered = prev.filter((n) => n.id !== evt.detail.id)
          return [...filtered, evt.detail]
        })

        // Auto-close if specified
        if (evt.detail.autoClose) {
          setTimeout(() => {
            setCustomNotifs((prev) => prev.filter((n) => n.id !== evt.detail.id))
          }, evt.detail.autoCloseDelay || 5000)
        }
      }
    }

    window.addEventListener("app:notification", handleCustomNotif)
    return () => window.removeEventListener("app:notification", handleCustomNotif)
  }, [])

  // Mark component as hydrated after client mount to avoid SSR/CSR mismatches
  useEffect(() => {
    setHydrated(true)
  }, [])

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", handle)
    return () => document.removeEventListener("mousedown", handle)
  }, [open])

  const dismissVersion = useCallback(() => {
    setCookie(VERSION_COOKIE_NAME, APP_VERSION, VERSION_COOKIE_MAX_AGE)
    setVersionDismissed(true)
  }, [])

  const notifications = useMemo<NotifItem[]>(() => {
    const list: NotifItem[] = []

    // Add custom notifications (from AdminVersionNotifier, etc)
    customNotifs.forEach((cn) => {
      let icon = <Sparkles className="h-4 w-4" />
      let iconBg = "bg-primary/10 text-primary"

      if (cn.type === "warning") {
        icon = <AlertTriangle className="h-4 w-4" />
        iconBg = "bg-destructive/10 text-destructive"
      } else if (cn.type === "info") {
        icon = <MessageCircle className="h-4 w-4" />
        iconBg = "bg-blue-500/10 text-blue-500"
      } else if (cn.type === "success") {
        icon = <Sparkles className="h-4 w-4" />
        iconBg = "bg-emerald-500/10 text-emerald-500"
      }

      list.push({
        id: cn.id,
        icon,
        iconBg,
        title: cn.title,
        description: cn.message,
        action: {
          label: cn.actionLabel || "View",
          onClick: () => {
            if (cn.actionUrl) window.open(cn.actionUrl, "_blank", "noopener,noreferrer")
          },
        },
        onDismiss: () => {
          setCustomNotifs((prev) => prev.filter((n) => n.id !== cn.id))
        },
      })
    })

    if (!versionDismissed) {
      list.push({
        id: "version",
        icon: <Sparkles className="h-4 w-4" />,
        iconBg: "bg-primary/10 text-primary",
        title: `${APP_NAME} v${APP_VERSION} Released`,
        description: "New features, improvements, and bug fixes are available.",
        action: {
          label: "View Changelog",
          href: "/changelog",
          onClick: () => { dismissVersion(); setOpen(false) },
        },
        onDismiss: dismissVersion,
      })
    }

    return list
  }, [versionDismissed, dismissVersion, customNotifs])

  const count = notifications.length

  return (
    <div ref={ref} className={cn("relative vr-auth-only", isPublicRoute && "!invisible !pointer-events-none")}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(!open)}
        aria-label={hydrated ? `Notifications${count > 0 ? ` (${count} unread)` : ""}` : "Notifications"}
        className="relative text-muted-foreground hover:text-foreground h-8 w-8"
      >
        <Bell className="h-4 w-4" />
        {hydrated && count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {count}
          </span>
        )}
      </Button>

      {open && (
        <div className="fixed right-3 left-3 sm:left-auto sm:absolute sm:right-0 sm:w-80 top-14 sm:top-full sm:mt-2 rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
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
                        {n.action.href ? (
                          <a
                            href={n.action.href}
                            onClick={n.action.onClick}
                            className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                          >
                            {n.action.label}
                            {n.id === "discord" ? <ExternalLink className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
                          </a>
                        ) : (
                          <button
                            onClick={n.action.onClick}
                            className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                          >
                            {n.action.label}
                            {n.id === "discord" ? <ExternalLink className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
                          </button>
                        )}
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
