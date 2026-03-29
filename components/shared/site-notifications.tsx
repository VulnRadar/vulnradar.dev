"use client"

import React, { useState, useEffect, useCallback } from "react"
import { X, ExternalLink, AlertCircle, CheckCircle2, AlertTriangle, Info, Megaphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Notification {
  id: number
  cookie_id: string
  title: string
  message: string
  type: "banner" | "modal" | "toast" | "bell"
  variant: "info" | "success" | "warning" | "error"
  is_dismissible: boolean
  dismiss_duration_hours?: number | null
  action_label?: string | null
  action_url?: string | null
  action_external?: boolean
}

// Cookie utilities for per-notification dismiss tracking
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) return parts.pop()?.split(";").shift() || null
  return null
}

function setCookie(name: string, value: string, hours?: number | null): void {
  if (typeof document === "undefined") return
  let expires = ""
  if (hours) {
    const date = new Date()
    date.setTime(date.getTime() + hours * 60 * 60 * 1000)
    expires = `; expires=${date.toUTCString()}`
  } else {
    // Default to 30 days if no duration specified
    const date = new Date()
    date.setTime(date.getTime() + 30 * 24 * 60 * 60 * 1000)
    expires = `; expires=${date.toUTCString()}`
  }
  document.cookie = `${name}=${value}${expires}; path=/; SameSite=Lax`
}

function isNotificationDismissed(cookieId: string): boolean {
  return getCookie(`dismissed_${cookieId}`) === "1"
}

function dismissNotification(cookieId: string, durationHours?: number | null): void {
  setCookie(`dismissed_${cookieId}`, "1", durationHours)
}

// Design tokens matching site aesthetic - uses CSS variables for theme consistency
const variantConfig = {
  info: {
    bg: "bg-primary/10",
    border: "border-primary/20",
    iconBg: "bg-primary/15",
    iconColor: "text-primary",
    progressBar: "bg-primary",
    icon: Info,
  },
  success: {
    bg: "bg-[hsl(var(--success))]/10",
    border: "border-[hsl(var(--success))]/20",
    iconBg: "bg-[hsl(var(--success))]/15",
    iconColor: "text-[hsl(var(--success))]",
    progressBar: "bg-[hsl(var(--success))]",
    icon: CheckCircle2,
  },
  warning: {
    bg: "bg-[hsl(var(--warning))]/10",
    border: "border-[hsl(var(--warning))]/20",
    iconBg: "bg-[hsl(var(--warning))]/15",
    iconColor: "text-[hsl(var(--warning))]",
    progressBar: "bg-[hsl(var(--warning))]",
    icon: AlertTriangle,
  },
  error: {
    bg: "bg-destructive/10",
    border: "border-destructive/20",
    iconBg: "bg-destructive/15",
    iconColor: "text-destructive",
    progressBar: "bg-destructive",
    icon: AlertCircle,
  },
}

// Banner - full width at top of page, matches header style
export function SiteBanner({ notification }: { notification: Notification }) {
  const [dismissed, setDismissed] = useState(() => isNotificationDismissed(notification.cookie_id))
  const [mounted, setMounted] = useState(false)
  const config = variantConfig[notification.variant]
  const Icon = config.icon

  useEffect(() => setMounted(true), [])

  const handleDismiss = useCallback(() => {
    dismissNotification(notification.cookie_id, notification.dismiss_duration_hours)
    setDismissed(true)
  }, [notification.cookie_id, notification.dismiss_duration_hours])

  if (dismissed) return null

  return (
    <div 
      className={cn(
        "relative border-b bg-background/80 backdrop-blur-lg transition-all duration-300",
        config.border,
        mounted ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      )}
    >
      {/* Subtle left accent bar */}
      <div className={cn("absolute left-0 top-0 bottom-0 w-1", config.progressBar)} />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={cn("flex-shrink-0 p-1.5 rounded-md", config.iconBg)}>
            <Megaphone className={cn("h-4 w-4", config.iconColor)} />
          </div>
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {notification.title && (
              <span className="font-medium text-sm text-foreground">{notification.title}</span>
            )}
            {notification.title && notification.message && (
              <span className="text-muted-foreground hidden sm:inline">—</span>
            )}
            <span className="text-sm text-muted-foreground truncate">{notification.message}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {notification.action_url && (
            <Button size="sm" variant="ghost" asChild className="h-7 px-2.5 text-xs font-medium text-primary hover:text-primary hover:bg-primary/10">
              <a
                href={notification.action_url}
                target={notification.action_external ? "_blank" : "_self"}
                rel={notification.action_external ? "noopener noreferrer" : undefined}
                className="flex items-center gap-1"
              >
                {notification.action_label || "Learn more"}
                {notification.action_external && <ExternalLink className="h-3 w-3" />}
              </a>
            </Button>
          )}
          {notification.is_dismissible && (
            <button
              onClick={handleDismiss}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Modal - centered overlay matching site card/popover styles
export function SiteModal({ notification, onClose }: { notification: Notification; onClose: () => void }) {
  const [mounted, setMounted] = useState(false)
  const config = variantConfig[notification.variant]
  const Icon = config.icon

  useEffect(() => setMounted(true), [])

  const handleClose = useCallback(() => {
    if (notification.is_dismissible) {
      dismissNotification(notification.cookie_id, notification.dismiss_duration_hours)
    }
    onClose()
  }, [notification.cookie_id, notification.dismiss_duration_hours, notification.is_dismissible, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop - matches site overlay style */}
      <div 
        className={cn(
          "absolute inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-200",
          mounted ? "opacity-100" : "opacity-0"
        )}
        onClick={notification.is_dismissible ? handleClose : undefined}
      />
      
      {/* Modal card */}
      <div className={cn(
        "relative w-full max-w-md rounded-lg border border-border bg-card shadow-lg transition-all duration-200",
        mounted ? "opacity-100 scale-100" : "opacity-0 scale-95"
      )}>
        {/* Header */}
        <div className={cn("flex items-start gap-3 p-4 border-b border-border", config.bg)}>
          <div className={cn("flex-shrink-0 p-2 rounded-md", config.iconBg)}>
            <Icon className={cn("h-5 w-5", config.iconColor)} />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            {notification.title && (
              <h2 className="text-base font-semibold text-foreground">{notification.title}</h2>
            )}
          </div>
          {notification.is_dismissible && (
            <button 
              onClick={handleClose} 
              className="flex-shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close modal"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        
        {/* Content */}
        <div className="p-4">
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {notification.message}
          </p>
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 pt-0">
          {notification.is_dismissible && (
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Dismiss
            </Button>
          )}
          {notification.action_url && (
            <Button size="sm" asChild>
              <a
                href={notification.action_url}
                target={notification.action_external ? "_blank" : "_self"}
                rel={notification.action_external ? "noopener noreferrer" : undefined}
                className="flex items-center gap-1.5"
              >
                {notification.action_label || "Learn more"}
                {notification.action_external && <ExternalLink className="h-3.5 w-3.5" />}
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// Toast - compact notification in corner
export function SiteToast({ notification, onDismiss }: { notification: Notification; onDismiss: () => void }) {
  const [dismissed, setDismissed] = useState(() => isNotificationDismissed(notification.cookie_id))
  const [exiting, setExiting] = useState(false)
  const [progress, setProgress] = useState(100)
  const config = variantConfig[notification.variant]
  const Icon = config.icon

  const handleDismiss = useCallback(() => {
    setExiting(true)
    setTimeout(() => {
      dismissNotification(notification.cookie_id, notification.dismiss_duration_hours)
      setDismissed(true)
      onDismiss()
    }, 150)
  }, [notification.cookie_id, notification.dismiss_duration_hours, onDismiss])

  // Auto-dismiss with progress bar
  useEffect(() => {
    if (!notification.is_dismissible) return
    
    const duration = 6000
    const interval = 50
    const decrement = (interval / duration) * 100
    
    const progressTimer = setInterval(() => {
      setProgress(prev => Math.max(0, prev - decrement))
    }, interval)
    
    const dismissTimer = setTimeout(handleDismiss, duration)
    
    return () => {
      clearInterval(progressTimer)
      clearTimeout(dismissTimer)
    }
  }, [notification.is_dismissible, handleDismiss])

  if (dismissed) return null

  return (
    <div 
      className={cn(
        "pointer-events-auto w-full max-w-sm rounded-lg border border-border bg-card shadow-lg overflow-hidden transition-all duration-150",
        exiting ? "opacity-0 translate-x-4 scale-95" : "opacity-100 translate-x-0 scale-100"
      )}
    >
      {/* Progress bar */}
      {notification.is_dismissible && (
        <div className="h-0.5 bg-muted">
          <div 
            className={cn("h-full transition-all duration-100 ease-linear", config.progressBar)}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      
      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <div className={cn("flex-shrink-0 p-1.5 rounded-md mt-0.5", config.iconBg)}>
            <Icon className={cn("h-4 w-4", config.iconColor)} />
          </div>
          <div className="flex-1 min-w-0">
            {notification.title && (
              <p className="text-sm font-medium text-foreground">{notification.title}</p>
            )}
            <p className={cn("text-sm text-muted-foreground leading-snug whitespace-pre-wrap", notification.title && "mt-0.5")}>
              {notification.message}
            </p>
            {notification.action_url && (
              <a
                href={notification.action_url}
                target={notification.action_external ? "_blank" : "_self"}
                rel={notification.action_external ? "noopener noreferrer" : undefined}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary mt-1.5 hover:underline underline-offset-2"
              >
                {notification.action_label || "Learn more"}
                {notification.action_external && <ExternalLink className="h-3 w-3" />}
              </a>
            )}
          </div>
          {notification.is_dismissible && (
            <button
              onClick={handleDismiss}
              className="flex-shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Dismiss toast"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Main component that renders all active notifications
export function SiteNotifications({ 
  notifications 
}: { 
  notifications: Notification[] 
}) {
  const [activeModal, setActiveModal] = useState<Notification | null>(null)
  const [toastQueue, setToastQueue] = useState<Notification[]>([])
  
  // Filter out dismissed notifications and separate by type
  const banners = notifications.filter(
    n => n.type === "banner" && !isNotificationDismissed(n.cookie_id)
  )
  const modals = notifications.filter(
    n => n.type === "modal" && !isNotificationDismissed(n.cookie_id)
  )
  const toasts = notifications.filter(
    n => n.type === "toast" && !isNotificationDismissed(n.cookie_id)
  )

  // Show the highest priority modal that hasn't been dismissed
  useEffect(() => {
    if (modals.length > 0 && !activeModal) {
      setActiveModal(modals[0])
    }
  }, [modals, activeModal])

  // Initialize toast queue
  useEffect(() => {
    if (toasts.length > 0 && toastQueue.length === 0) {
      setToastQueue(toasts)
    }
  }, [toasts, toastQueue.length])

  const removeToast = useCallback((id: number) => {
    setToastQueue(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <>
      {/* Render all active banners - each has independent dismiss state */}
      {banners.map(notification => (
        <SiteBanner key={notification.id} notification={notification} />
      ))}
      
      {/* Render one modal at a time */}
      {activeModal && (
        <SiteModal 
          notification={activeModal} 
          onClose={() => {
            // Find next modal to show
            const nextModal = modals.find(
              m => m.id !== activeModal.id && !isNotificationDismissed(m.cookie_id)
            )
            setActiveModal(nextModal || null)
          }} 
        />
      )}

      {/* Toast container - bottom right */}
      {toastQueue.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {toastQueue.slice(0, 3).map(notification => (
            <SiteToast 
              key={notification.id} 
              notification={notification} 
              onDismiss={() => removeToast(notification.id)}
            />
          ))}
        </div>
      )}
    </>
  )
}

// Wrapper component that fetches notifications and renders them
export function SiteNotificationsWrapper() {
  const [notifications, setNotifications] = useState<Notification[]>([])

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const res = await fetch("/api/v2/notifications/active")
        if (res.ok) {
          const data = await res.json()
          // API returns array directly, not { notifications: [...] }
          const allNotifs = Array.isArray(data) ? data : (data.notifications || [])
          // Filter to only banner, modal, toast types (bell is handled by NotificationCenter)
          const siteNotifs = allNotifs.filter(
            (n: Notification) => n.type === "banner" || n.type === "modal" || n.type === "toast"
          )
          setNotifications(siteNotifs)
        }
      } catch {
        // Silent fail
      }
    }

    fetchNotifications()
  }, [])

  if (notifications.length === 0) return null

  return <SiteNotifications notifications={notifications} />
}
