"use client"

import { createContext, useContext, ReactNode } from "react"
import useSWR from "swr"

interface AuthContextType {
  me: any
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useSWR(
    "/api/auth/me",
    (url: string) => fetch(url).then((r) => r.json()),
    {
      revalidateOnFocus: false,
      dedupingInterval: 300000, // 5 minutes
      focusThrottleInterval: 300000,
    }
  )

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
