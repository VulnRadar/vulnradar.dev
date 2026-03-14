"use client"

import { useEffect, useState } from "react"

interface Version {
  current: string
  engine: string
  latest: string | null
  status: "up-to-date" | "behind" | "ahead" | "unknown"
  message: string
}

let versionCache: Version | null = null
let versionFetching: Promise<Version> | null = null

async function fetchVersionOnce(): Promise<Version> {
  // Return cached version if available
  if (versionCache) {
    return versionCache
  }
  
  // If already fetching, wait for that request
  if (versionFetching) {
    return versionFetching
  }
  
  // Fetch and cache
  versionFetching = fetch("/api/version", { cache: "no-store" })
    .then((res) => res.json())
    .catch((err) => {
      console.error("[v0] Failed to fetch version:", err)
      return {
        current: "unknown",
        engine: "unknown",
        latest: null,
        status: "unknown" as const,
        message: "Could not load version info",
      }
    })
    .then((data) => {
      versionCache = data
      versionFetching = null
      return data
    })
  
  return versionFetching
}

export function useVersion() {
  const [version, setVersion] = useState<Version>({ current: "loading", engine: "loading", latest: null, status: "unknown", message: "Loading..." })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchVersionOnce()
      .then((data) => {
        setVersion(data)
        setError(null)
      })
      .catch((err) => {
        setError(err.message)
        setVersion({ current: "unknown", engine: "unknown", latest: null, status: "unknown", message: "Failed to load" })
      })
  }, [])

  return { version, error }
}
