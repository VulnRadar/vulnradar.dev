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

function setCookie(name: string, value: string, days: number = 365): void {
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
    // Only run once per session
    if (sessionStorage.getItem("versionNotifierRan")) return
    sessionStorage.setItem("versionNotifierRan", "1")

    async function checkVersion() {
      try {
        const res = await fetch("/api/version")
        if (!res.ok) return

        const data: VersionData = await res.json()
        const isAdmin = me?.role && STAFF_ROLES.includes(me.role)
        const changelogSeen = getCookie("changelogSeen")

        // Case 1: Ahead of latest
        if (data.status === "ahead") {
          if (isAdmin) {
            dispatchNotification(
              "version-ahead",
              "Running Ahead of Latest",
              `⚠️ You are running version ${data.current}, but the latest official release is ${data.latest}. Verify version consistency.`,
              "warning"
            )
          }
          return
        }

        // Case 2: Behind latest
        if (data.status === "behind") {
          if (isAdmin) {
            dispatchNotification(
              "version-behind",
              "🚨 Update Available",
              `Current: ${data.current}\nLatest: ${data.latest}\n\nAn update is available. Review the changelog and update when ready.`,
              "warning",
              "View Update",
              data.release_url || "/changelog"
            )
          }

          // Show changelog if not seen this version
          if (changelogSeen !== data.current) {
            dispatchNotification(
              "changelog-new",
              `What's New in ${data.current}`,
              "A new version is available. Check out the latest features and improvements.",
              "info",
              "View Changelog",
              "/changelog"
            )
            setCookie("changelogSeen", data.current)
          }
          return
        }

        // Case 3: On current version
        if (data.status === "current") {
          if (changelogSeen !== data.current) {
            dispatchNotification(
              "changelog-new",
              `What's New in ${data.current}`,
              "Check out the latest features and improvements in this version.",
              "info",
              "View Changelog",
              "/changelog"
            )
            setCookie("changelogSeen", data.current)
          }
        }
      } catch (err) {
        console.error("[v0] Version check failed:", err)
      }
    }

    checkVersion()
  }, [me])

  return null
}
