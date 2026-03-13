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

const variantConfig = {
  info: {
    gradient: "from-blue-500/20 via-blue-500/10 to-transparent",
    iconBg: "bg-blue-500/20",
    iconColor: "text-blue-400",
    borderColor: "border-blue-500/30",
    accentColor: "text-blue-400",
    icon: Info,
  },
  success: {
    gradient: "from-emerald-500/20 via-emerald-500/10 to-transparent",
    iconBg: "bg-emerald-500/20",
    iconColor: "text-emerald-400",
    borderColor: "border-emerald-500/30",
    accentColor: "text-emerald-400",
    icon: CheckCircle2,
  },
  warning: {
    gradient: "from-amber-500/20 via-amber-500/10 to-transparent",
    iconBg: "bg-amber-500/20",
    iconColor: "text-amber-400",
    borderColor: "border-amber-500/30",
    accentColor: "text-amber-400",
    icon: AlertTriangle,
  },
  error: {
    gradient: "from-red-500/20 via-red-500/10 to-transparent",
    iconBg: "bg-red-500/20",
    iconColor: "text-red-400",
    borderColor: "border-red-500/30",
    accentColor: "text-red-400",
    icon: AlertCircle,
  },
}

// Banner - full width at top of page
export function SiteBanner({ notification }: { notification: Notification }) {
  const [dismissed, setDismissed] = useState(() => isNotificationDismissed(notification.cookie_id))
  const config = variantConfig[notification.variant]
  const Icon = config.icon

  const handleDismiss = useCallback(() => {
    dismissNotification(notification.cookie_id, notification.dismiss_duration_hours)
    setDismissed(true)
  }, [notification.cookie_id, notification.dismiss_duration_hours])

  if (dismissed) return null

  return (
    <div className={cn(
      "relative overflow-hidden border-b bg-card/80 backdrop-blur-sm",
      config.borderColor
    )}>
      {/* Gradient accent */}
      <div className={cn("absolute inset-0 bg-gradient-to-r", config.gradient)} />
      
      <div className="relative max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={cn("flex-shrink-0 p-2 rounded-lg", config.iconBg)}>
            <Megaphone className={cn("h-4 w-4", config.iconColor)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {notification.title && (
                <span className="font-semibold text-sm text-foreground">{notification.title}</span>
              )}
              <span className="text-sm text-muted-foreground">{notification.message}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {notification.action_url && (
            <Button size="sm" variant="ghost" asChild className={cn("h-8 text-xs font-medium", config.accentColor)}>
              <a
                href={notification.action_url}
                target={notification.action_external ? "_blank" : "_self"}
                rel={notification.action_external ? "noopener noreferrer" : undefined}
                className="flex items-center gap-1.5"
              >
                {notification.action_label || "Learn more"}
                {notification.action_external && <ExternalLink className="h-3 w-3" />}
              </a>
            </Button>
          )}
          {notification.is_dismissible && (
            <button
              onClick={handleDismiss}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Modal - centered overlay with glassmorphism
export function SiteModal({ notification, onClose }: { notification: Notification; onClose: () => void }) {
  const config = variantConfig[notification.variant]
  const Icon = config.icon

  const handleClose = useCallback(() => {
    if (notification.is_dismissible) {
      dismissNotification(notification.cookie_id, notification.dismiss_duration_hours)
    }
    onClose()
  }, [notification.cookie_id, notification.dismiss_duration_hours, notification.is_dismissible, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={notification.is_dismissible ? handleClose : undefined}
      />
      
      {/* Modal */}
      <div className={cn(
        "relative w-full max-w-md rounded-2xl border bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden",
        config.borderColor
      )}>
        {/* Gradient header accent */}
        <div className={cn("absolute top-0 left-0 right-0 h-32 bg-gradient-to-b opacity-50", config.gradient)} />
        
        <div className="relative p-6">
          {/* Header */}
          <div className="flex items-start gap-4 mb-4">
            <div className={cn("flex-shrink-0 p-3 rounded-xl", config.iconBg)}>
              <Icon className={cn("h-6 w-6", config.iconColor)} />
            </div>
            <div className="flex-1 min-w-0 pt-1">
              {notification.title && (
                <h2 className="text-lg font-semibold text-foreground">{notification.title}</h2>
              )}
            </div>
            {notification.is_dismissible && (
              <button 
                onClick={handleClose} 
                className="flex-shrink-0 p-2 -m-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
          
          {/* Content */}
          <p className="text-sm text-muted-foreground leading-relaxed mb-6 pl-[52px]">
            {notification.message}
          </p>
          
          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pl-[52px]">
            {notification.is_dismissible && (
              <Button variant="ghost" size="sm" onClick={handleClose} className="h-9">
                Dismiss
              </Button>
            )}
            {notification.action_url && (
              <Button size="sm" asChild className="h-9">
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
    </div>
  )
}

// Toast - sleek notification in corner
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
    }, 200)
  }, [notification.cookie_id, notification.dismiss_duration_hours, onDismiss])

  // Auto-dismiss with progress bar
  useEffect(() => {
    if (!notification.is_dismissible) return
    
    const duration = 8000
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
        "pointer-events-auto w-full max-w-sm rounded-xl border bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden transition-all duration-300",
        config.borderColor,
        exiting ? "opacity-0 translate-x-8 scale-95" : "opacity-100 translate-x-0 scale-100"
      )}
    >
      {/* Progress bar */}
      {notification.is_dismissible && (
        <div className="h-1 bg-muted/30">
          <div 
            className={cn("h-full transition-all duration-100 ease-linear", config.iconBg.replace('/20', ''))}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn("flex-shrink-0 p-2 rounded-lg", config.iconBg)}>
            <Icon className={cn("h-4 w-4", config.iconColor)} />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            {notification.title && (
              <p className="text-sm font-semibold text-foreground mb-0.5">{notification.title}</p>
            )}
            <p className="text-sm text-muted-foreground leading-relaxed">{notification.message}</p>
            {notification.action_url && (
              <a
                href={notification.action_url}
                target={notification.action_external ? "_blank" : "_self"}
                rel={notification.action_external ? "noopener noreferrer" : undefined}
                className={cn(
                  "inline-flex items-center gap-1 text-sm font-medium mt-2 hover:underline underline-offset-2",
                  config.accentColor
                )}
              >
                {notification.action_label || "Learn more"}
                {notification.action_external && <ExternalLink className="h-3 w-3" />}
              </a>
            )}
          </div>
          {notification.is_dismissible && (
            <button
              onClick={handleDismiss}
              className="flex-shrink-0 p-1.5 -m-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X className="h-4 w-4" />
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
