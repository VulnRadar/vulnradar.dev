"use client"

import { createContext, useContext, ReactNode, useEffect, useSyncExternalStore } from "react"
import useSWR from "swr"

interface AuthContextType {
  me: any
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// ── Synchronous localStorage cache ──────────────────────────────
// This lets us read the cached auth data on the very first client
// render, completely avoiding the flash.

let memoryCache: any = null

function readCache(): any {
  if (memoryCache) return memoryCache
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem("vr_auth_cache")
    if (raw) {
      memoryCache = JSON.parse(raw)
      return memoryCache
    }
  } catch {}
  return null
}

function subscribe(cb: () => void) {
  window.addEventListener("vr-auth-update", cb)
  return () => window.removeEventListener("vr-auth-update", cb)
}

function getSnapshot() {
  return memoryCache ?? readCache()
}

function getServerSnapshot() {
  return null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Synchronously read cached auth on first client render
  const cached = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const { data: fetched } = useSWR(
    "/api/auth/me",
    (url: string) => fetch(url).then((r) => r.json()),
    {
      fallbackData: cached,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 300000,
      focusThrottleInterval: 300000,
      keepPreviousData: true,
      shouldRetryOnError: false,
      errorRetryCount: 0,
    }
  )

  const me = fetched ?? cached

  // Persist to localStorage + memory whenever auth data changes
  useEffect(() => {
    if (me) {
      memoryCache = me
      try {
        localStorage.setItem("vr_auth_cache", JSON.stringify(me))
      } catch {}
      window.dispatchEvent(new Event("vr-auth-update"))
    }
  }, [me])

  return (
    <AuthContext.Provider value={{ me, isLoading: !me }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return context
}

// Call on logout to clear cache
export function clearAuthCache() {
  memoryCache = null
  try {
    localStorage.removeItem("vr_auth_cache")
  } catch {}
  window.dispatchEvent(new Event("vr-auth-update"))
}
