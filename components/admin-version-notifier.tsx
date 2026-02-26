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

function setCookie(name: string, value: string, days: number = 1): void {
  if (typeof document === "undefined") return
  const expires = new Date()
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000)
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`
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

    // Only run once per 24 hours (checked via cookie)
    if (getCookie("versionNotifierShown")) return

    async function checkVersion() {
      try {
        console.log("[v0] Version notifier running for user:", me?.userId)
        const res = await fetch("/api/version")
        if (!res.ok) {
          console.log("[v0] Version API returned:", res.status)
          return
        }

        const data: VersionData = await res.json()
        console.log("[v0] Version check result:", data)

        const isAdmin = me?.role === STAFF_ROLES.ADMIN
        console.log("[v0] Is admin:", isAdmin, "Role:", me?.role)

        const changelogSeen = getCookie("changelogSeen")
        console.log("[v0] Changelog seen:", changelogSeen, "Current:", data.current)

        // Case 1: Ahead of latest
        if (data.status === "ahead") {
          console.log("[v0] Status: AHEAD")
          if (isAdmin) {
            console.log("[v0] Dispatching admin ahead notification")
            dispatchNotification(
              "version-ahead",
              "Running Ahead of Latest",
              `You are running version ${data.current}, but the latest official release is ${data.latest}. Verify version consistency.`,
              "warning"
            )
          }
          setCookie("versionNotifierShown", "1", 1) // 24 hours
          return
        }

        // Case 2: Behind latest
        if (data.status === "behind") {
          console.log("[v0] Status: BEHIND")
          if (isAdmin) {
            console.log("[v0] Dispatching admin behind notification")
            dispatchNotification(
              "version-behind",
              "Update Available",
              `Current: ${data.current}\nLatest: ${data.latest}\n\nAn update is available. Review the changelog and update when ready.`,
              "warning",
              "View Update",
              data.release_url || "/changelog"
            )
          }
          setCookie("versionNotifierShown", "1", 1) // 24 hours
          return
        }
      } catch (err) {
        console.error("[v0] Version check failed:", err)
      }
    }

    checkVersion()
  }, [me?.userId])

  return null
}
