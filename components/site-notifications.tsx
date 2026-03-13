"use client"

import React, { useState, useEffect, useCallback } from "react"
import { X, ExternalLink, AlertCircle, CheckCircle2, AlertTriangle, Info } from "lucide-react"
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

const variantStyles: Record<string, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
  info: {
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-200 dark:border-blue-800",
    text: "text-blue-900 dark:text-blue-100",
    icon: <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />,
  },
  success: {
    bg: "bg-emerald-50 dark:bg-emerald-950",
    border: "border-emerald-200 dark:border-emerald-800",
    text: "text-emerald-900 dark:text-emerald-100",
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />,
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-950",
    border: "border-amber-200 dark:border-amber-800",
    text: "text-amber-900 dark:text-amber-100",
    icon: <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />,
  },
  error: {
    bg: "bg-red-50 dark:bg-red-950",
    border: "border-red-200 dark:border-red-800",
    text: "text-red-900 dark:text-red-100",
    icon: <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />,
  },
}

export function SiteBanner({ notification }: { notification: Notification }) {
  const [dismissed, setDismissed] = useState(() => isNotificationDismissed(notification.cookie_id))
  const style = variantStyles[notification.variant]

  const handleDismiss = useCallback(() => {
    dismissNotification(notification.cookie_id, notification.dismiss_duration_hours)
    setDismissed(true)
  }, [notification.cookie_id, notification.dismiss_duration_hours])

  if (dismissed) return null

  return (
    <div className={cn("border-b", style.bg, style.border, style.text)}>
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          {style.icon}
          <div className="flex-1">
            {notification.title && <h3 className="font-semibold text-sm">{notification.title}</h3>}
            <p className="text-sm opacity-90">{notification.message}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {notification.action_url && (
            <Button
              size="sm"
              variant="ghost"
              asChild
              className={style.text}
            >
              <a
                href={notification.action_url}
                target={notification.action_external ? "_blank" : "_self"}
                rel={notification.action_external ? "noopener noreferrer" : undefined}
                className="flex items-center gap-1"
              >
                {notification.action_label}
                {notification.action_external && <ExternalLink className="h-3 w-3" />}
              </a>
            </Button>
          )}
          {notification.is_dismissible && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className={style.text}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function SiteModal({ notification, onClose }: { notification: Notification; onClose: () => void }) {
  const style = variantStyles[notification.variant]

  const handleClose = useCallback(() => {
    if (notification.is_dismissible) {
      dismissNotification(notification.cookie_id, notification.dismiss_duration_hours)
    }
    onClose()
  }, [notification.cookie_id, notification.dismiss_duration_hours, notification.is_dismissible, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className={cn("bg-background border rounded-lg shadow-lg max-w-md w-full mx-4", style.border)}>
        <div className={cn("p-6", style.bg)}>
          <div className="flex items-start gap-3 mb-4">
            {style.icon}
            <div className="flex-1">
              {notification.title && <h2 className="font-bold text-lg">{notification.title}</h2>}
            </div>
            {notification.is_dismissible && (
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
          <p className="text-sm text-foreground mb-6">{notification.message}</p>
          <div className="flex gap-2 justify-end">
            {notification.action_url && (
              <Button asChild>
                <a
                  href={notification.action_url}
                  target={notification.action_external ? "_blank" : "_self"}
                  rel={notification.action_external ? "noopener noreferrer" : undefined}
                  className="flex items-center gap-1"
                >
                  {notification.action_label}
                  {notification.action_external && <ExternalLink className="h-4 w-4" />}
                </a>
              </Button>
            )}
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          </div>
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
  
  // Filter out dismissed notifications and separate by type
  const banners = notifications.filter(
    n => n.type === "banner" && !isNotificationDismissed(n.cookie_id)
  )
  const modals = notifications.filter(
    n => n.type === "modal" && !isNotificationDismissed(n.cookie_id)
  )

  // Show the highest priority modal that hasn't been dismissed
  useEffect(() => {
    if (modals.length > 0 && !activeModal) {
      setActiveModal(modals[0])
    }
  }, [modals, activeModal])

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
    </>
  )
}
