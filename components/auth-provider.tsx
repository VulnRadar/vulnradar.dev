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
