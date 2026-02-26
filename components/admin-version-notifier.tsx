"use client"

import { useEffect } from "react"
import { useAuth } from "@/components/auth-provider"
import { STAFF_ROLES } from "@/lib/constants"

interface VersionData {
  current: string
  latest: string
  status: "ahead" | "behind" | "current"
  release_url?: string
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) return parts.pop()?.split(";").shift() || null
  return null
}

function dispatchNotification(
  id: string,
  title: string,
  message: string,
  type: "warning" | "info" | "success" | "error",
  actionLabel?: string,
  actionUrl?: string
): void {
  const event = new CustomEvent("app:notification", {
    detail: {
      id,
      title,
      message,
      type,
      actionLabel,
      actionUrl,
      autoClose: false,
    },
  })
  window.dispatchEvent(event)
}

export function AdminVersionNotifier() {
  const { me } = useAuth()

  useEffect(() => {
    // Wait for auth to be ready
    if (!me) return

    // Only run once per session
    if (sessionStorage.getItem("versionNotifierRan")) return

    async function checkVersion() {
      try {
        console.log("Version notifier running for user:", me?.userId)
        const res = await fetch("/api/version")
        if (!res.ok) {
          console.log("Version API returned:", res.status)
          return
        }

        const data: VersionData = await res.json()
        console.log("Version check result:", data)

        const isAdmin = me?.role === STAFF_ROLES.ADMIN
        console.log("Is admin:", isAdmin, "Role:", me?.role, "ADMIN const:", STAFF_ROLES.ADMIN)

        const changelogSeen = getCookie("changelogSeen")
        console.log("Changelog seen:", changelogSeen, "Current:", data.current)

        // Case 1: Ahead of latest
        if (data.status === "ahead") {
          console.log("Status: AHEAD")
          if (isAdmin) {
            console.log("Dispatching admin ahead notification")
            dispatchNotification(
              "version-ahead",
              "Running Ahead of Latest",
              `You are running version ${data.current}, but the latest official release is ${data.latest}. Verify version consistency.`,
              "warning"
            )
          }
          sessionStorage.setItem("versionNotifierRan", "1")
          return
        }

        // Case 2: Behind latest
        if (data.status === "behind") {
          console.log("Status: BEHIND")
          if (isAdmin) {
            console.log("Dispatching admin behind notification")
            dispatchNotification(
              "version-behind",
              "Update Available",
              `Current: ${data.current}\nLatest: ${data.latest}\n\nAn update is available. Review the changelog and update when ready.`,
              "warning",
              "View Update",
              data.release_url || "/changelog"
            )
          }
          sessionStorage.setItem("versionNotifierRan", "1")
          return
        }
      } catch (err) {
        console.error("Version check failed:", err)
      }
    }

    checkVersion()
  }, [me?.userId]) // Only depend on userId, not the entire me object

  return null
}
