"use client"

import { useEffect, useCallback } from "react"
import { useAuth } from "@/components/auth-provider"
import { STAFF_ROLES, APP_VERSION } from "@/lib/constants"

type VersionStatus = "up-to-date" | "behind" | "ahead"

const VERSION_NOTIFIER_COOKIE = "vr_version_notifier"

interface NotifierState {
  status: VersionStatus
  latest: string
  lastShown: number
}

/**
 * Automatically checks version for admins and shows notifications
 * via the notification center bell. No UI needed - just logic.
 * 
 * Logic:
 * - Behind: Check every 24 hours (86400000ms)
 * - Ahead: Check every 7 days (604800000ms) 
 * - Current: Check every 7 days (604800000ms)
 */
export function AdminVersionNotifier() {
  const { me } = useAuth()

  const checkVersion = useCallback(async () => {
    // Only for admins
    if (!me?.userId || me.role !== STAFF_ROLES.ADMIN) return

    try {
      // Get stored state
      const stored = localStorage.getItem(VERSION_NOTIFIER_COOKIE)
      const state: NotifierState | null = stored ? JSON.parse(stored) : null
      const now = Date.now()

      // Determine check interval based on status
      const checkInterval = state?.status === "behind" ? 86400000 : 604800000 // 24h vs 7d

      // Skip if we already checked recently
      if (state && now - state.lastShown < checkInterval) return

      // Fetch latest version
      const res = await fetch("/api/version")
      const data = await res.json()

      const current = APP_VERSION.split(".").map(Number)
      const latest = data.latest?.split(".").map(Number) || current
      
      let newStatus: VersionStatus = "up-to-date"
      if (latest[0] > current[0] || 
          (latest[0] === current[0] && latest[1] > current[1]) ||
          (latest[0] === current[0] && latest[1] === current[1] && latest[2] > current[2])) {
        newStatus = "behind"
      } else if (latest[0] < current[0] || 
                 (latest[0] === current[0] && latest[1] < current[1]) ||
                 (latest[0] === current[0] && latest[1] === current[1] && latest[2] < current[2])) {
        newStatus = "ahead"
      }

      // Store new state
      const newState: NotifierState = {
        status: newStatus,
        latest: data.latest || APP_VERSION,
        lastShown: now,
      }
      localStorage.setItem(VERSION_NOTIFIER_COOKIE, JSON.stringify(newState))

      // Show notification if status changed or needs reminder
      if (!state || state.status !== newStatus) {
        showVersionNotification(newStatus, APP_VERSION, data.latest)
      }
    } catch (e) {
      console.error("[v0] Version check failed:", e)
    }
  }, [me])

  useEffect(() => {
    checkVersion()
    // Check again on interval (let's use 1 hour for periodic checks)
    const interval = setInterval(checkVersion, 3600000)
    return () => clearInterval(interval)
  }, [checkVersion])

  return null
}

/**
 * Show version notification via the notification center
 */
function showVersionNotification(status: VersionStatus, current: string, latest: string) {
  // Create a custom event that the NotificationCenter will catch
  const event = new CustomEvent("app:notification", {
    detail: {
      id: `version-${Date.now()}`,
      title: 
        status === "behind" ? "Update Available" :
        status === "ahead" ? "Development Version" :
        "Version Up to Date",
      message:
        status === "behind" ? `VulnRadar v${latest} is available. You're running v${current}.` :
        status === "ahead" ? `You're running v${current}, ahead of the latest release v${latest}.` :
        `You're running the latest version v${current}.`,
      type: status === "behind" ? "warning" : status === "ahead" ? "info" : "success",
      actionLabel: status === "behind" ? "View Release" : undefined,
      actionUrl: status === "behind" ? "https://github.com/VulnRadar/vulnradar.dev/releases" : undefined,
      autoClose: true,
      autoCloseDelay: status === "behind" ? 10000 : 5000,
    },
  })
  window.dispatchEvent(event)
}
