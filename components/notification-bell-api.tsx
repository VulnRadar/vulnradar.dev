"use client"

import React, { useState, useEffect } from "react"
import { Bell, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/components/auth-provider"

interface BellNotification {
  id: number
  title: string
  message: string
  variant: "info" | "success" | "warning" | "error"
  action_label?: string | null
  action_url?: string | null
  action_external?: boolean
  priority: number
}

export function NotificationBell() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<BellNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return

    const fetchNotifications = async () => {
      try {
        setLoading(true)
        const response = await fetch(
          `/api/notifications/active?audience=${user ? "authenticated" : "unauthenticated"}&type=bell`
        )
        if (!response.ok) throw new Error("Failed to fetch")
        const data = await response.json()
        setNotifications(data)
      } catch (error) {
        console.error("Error fetching notifications:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchNotifications()
  }, [open, user])

  const unreadCount = notifications.length

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 h-2 w-2 bg-primary rounded-full" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="p-3 font-semibold text-sm">Notifications</div>
        <DropdownMenuSeparator />
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">No notifications</div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {notifications.map((notif) => (
              <div key={notif.id} className="p-3 border-b hover:bg-muted cursor-pointer transition-colors">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {notif.title && <p className="font-semibold text-sm truncate">{notif.title}</p>}
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{notif.message}</p>
                    {notif.action_url && (
                      <a
                        href={notif.action_url}
                        target={notif.action_external ? "_blank" : "_self"}
                        rel={notif.action_external ? "noopener noreferrer" : undefined}
                        className="text-xs text-primary hover:underline mt-2 inline-block"
                      >
                        {notif.action_label || "Learn more"}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
