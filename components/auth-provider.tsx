"use client"

import { createContext, useContext, ReactNode, useEffect, useState } from "react"
import useSWR from "swr"

interface AuthContextType {
  me: any
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function getInitialAuthData() {
  if (typeof window === "undefined") return null
  try {
    const cached = localStorage.getItem("vr_auth_cache")
    const timestamp = localStorage.getItem("vr_auth_timestamp")
    
    if (cached && timestamp) {
      const age = Date.now() - parseInt(timestamp, 10)
      // Use cache if less than 1 hour old
      if (age < 3600000) {
        return JSON.parse(cached)
      }
    }
    return null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialData] = useState(() => getInitialAuthData())

  // Only fetch if we don't have cached data or it's stale
  const shouldFetch = !initialData

  const { data: me } = useSWR(
    shouldFetch ? "/api/auth/me" : null,
    (url: string) => fetch(url).then((r) => r.json()),
    {
      fallbackData: initialData,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 3600000, // 1 hour
      focusThrottleInterval: 3600000,
      keepPreviousData: true,
      shouldRetryOnError: false,
      errorRetryCount: 0,
      errorRetryInterval: 0,
    }
  )

  // Cache auth data in localStorage whenever it updates
  useEffect(() => {
    if (me) {
      try {
        localStorage.setItem("vr_auth_cache", JSON.stringify(me))
        localStorage.setItem("vr_auth_timestamp", Date.now().toString())
      } catch {}
    }
  }, [me])

  return (
    <AuthContext.Provider value={{ me, isLoading: false }}>
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

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function getInitialAuthData() {
  if (typeof window === "undefined") return null
  try {
    const cached = sessionStorage.getItem("vr_auth_cache")
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialData] = useState(() => getInitialAuthData())

  const { data: me, isLoading } = useSWR(
    "/api/auth/me",
    (url: string) => fetch(url).then((r) => r.json()),
    {
      fallbackData: initialData,
      revalidateOnFocus: false,
      dedupingInterval: 300000, // 5 minutes
      focusThrottleInterval: 300000,
      keepPreviousData: true,
    }
  )

  // Cache auth data in sessionStorage whenever it updates
  useEffect(() => {
    if (me) {
      try {
        sessionStorage.setItem("vr_auth_cache", JSON.stringify(me))
      } catch {}
    }
  }, [me])

  return (
    <AuthContext.Provider value={{ me, isLoading }}>
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
