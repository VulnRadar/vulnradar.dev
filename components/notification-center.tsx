"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { usePathname } from "next/navigation"
import {
  X,
  ArrowRight,
  AlertTriangle,
  Bell,
  ExternalLink,
  Info,
  CheckCircle2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PUBLIC_PATHS } from "@/lib/public-paths"
import { useAuth } from "@/components/auth-provider"
import { STAFF_ROLES } from "@/lib/constants"

// ─── Cookie Helpers ──────────────────────────────────────────────

function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined
  const cookies = document.cookie.split("; ")
  return cookies.find((c) => c.startsWith(`${name}=`))?.split("=")[1]
}

function setCookie(name: string, value: string, maxAgeSeconds: number) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`
}

// ─── Types ───────────────────────────────────────────────────────

interface ApiNotification {
  id: number
  title: string
  message: string
  type: "bell" | "banner" | "modal" | "toast"
  variant: "info" | "success" | "warning" | "error"
  audience: string
  is_dismissible: boolean
  dismiss_duration_hours: number | null
  action_label: string | null
  action_url: string | null
  action_external: boolean
  priority: number
}

// ─── Backup Codes Modal (always shows as full-screen overlay) ────

export function BackupCodesModal() {
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

// ─── Variant Styles ──────────────────────────────────────────────

const VARIANT_ICONS: Record<string, { icon: React.ReactNode; bg: string }> = {
  info: { icon: <Info className="h-4 w-4" />, bg: "bg-blue-500/10 text-blue-500" },
  success: { icon: <CheckCircle2 className="h-4 w-4" />, bg: "bg-emerald-500/10 text-emerald-500" },
  warning: { icon: <AlertTriangle className="h-4 w-4" />, bg: "bg-amber-500/10 text-amber-500" },
  error: { icon: <AlertTriangle className="h-4 w-4" />, bg: "bg-destructive/10 text-destructive" },
}

// ─── Notification Bell (header dropdown) ─────────────────────────

export function NotificationBell() {
  const pathname = usePathname()
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<ApiNotification[]>([])
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set())
  const [hydrated, setHydrated] = useState(false)
  const [loading, setLoading] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  const isPublicRoute = PUBLIC_PATHS.some((p) => {
    if (p === "/" || p === "/landing") return pathname === p
    return pathname.startsWith(p)
  })

  const isStaff = me?.role && STAFF_ROLES.includes(me.role)

  // Initialize dismissed IDs from cookies on mount
  useEffect(() => {
    const dismissed = getCookie("vr_notif_dismissed")
    if (dismissed) {
      try {
        const parsed = JSON.parse(decodeURIComponent(dismissed))
        if (Array.isArray(parsed)) {
          setDismissedIds(new Set(parsed.map(Number)))
        }
      } catch {
        // Invalid cookie, ignore
      }
    }
  }, [])

  // Fetch notifications from API
  useEffect(() => {
    async function fetchNotifications() {
      try {
        const params = new URLSearchParams({
          authenticated: me?.userId ? "true" : "false",
          staff: isStaff ? "true" : "false",
        })
        const res = await fetch(`/api/v2/notifications/active?${params}`)
        if (res.ok) {
          const data = await res.json()
          // Only show "bell" type notifications in the bell dropdown
          setNotifications(data.filter((n: ApiNotification) => n.type === "bell"))
        }
      } catch (err) {
        console.error("Failed to fetch notifications:", err)
      } finally {
        setLoading(false)
      }
    }

    fetchNotifications()
    // Refetch every 5 minutes
    const interval = setInterval(fetchNotifications, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [me?.userId, isStaff])

  // Mark component as hydrated after client mount
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

  const dismissNotification = useCallback((id: number, durationHours: number | null) => {
    setDismissedIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      // Save to cookie
      const maxAge = durationHours ? durationHours * 60 * 60 : 60 * 60 * 24 * 365 // default 1 year
      setCookie("vr_notif_dismissed", encodeURIComponent(JSON.stringify([...next])), maxAge)
      return next
    })
  }, [])

  // Filter out dismissed notifications
  const visibleNotifications = notifications.filter((n) => !dismissedIds.has(n.id))
  const count = visibleNotifications.length

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
          {loading ? (
            <div className="px-4 py-8 text-center">
              <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Loading...</p>
            </div>
          ) : count === 0 ? (
            <div className="px-4 py-8 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">All caught up!</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {visibleNotifications.map((n) => {
                const variant = VARIANT_ICONS[n.variant] || VARIANT_ICONS.info
                return (
                  <div key={n.id} className="px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={cn("flex-shrink-0 p-2 rounded-lg", variant.bg)}>
                        {variant.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{n.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                        <div className="flex items-center gap-2 mt-2">
                          {n.action_url && (
                            <a
                              href={n.action_url}
                              target={n.action_external ? "_blank" : "_self"}
                              rel={n.action_external ? "noopener noreferrer" : undefined}
                              onClick={() => { if (n.is_dismissible) dismissNotification(n.id, n.dismiss_duration_hours); setOpen(false) }}
                              className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                            >
                              {n.action_label || "View"}
                              {n.action_external ? <ExternalLink className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
                            </a>
                          )}
                          {n.is_dismissible && (
                            <button
                              onClick={() => dismissNotification(n.id, n.dismiss_duration_hours)}
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Dismiss
                            </button>
                          )}
                        </div>
                      </div>
                      {n.is_dismissible && (
                        <button
                          onClick={() => dismissNotification(n.id, n.dismiss_duration_hours)}
                          className="flex-shrink-0 p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                          aria-label={`Dismiss ${n.title}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
