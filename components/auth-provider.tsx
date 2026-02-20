"use client"

import { createContext, useContext, ReactNode } from "react"
import useSWR from "swr"

interface User {
  id: string
  name: string
  email: string
  role: string | null
  avatar_url: string | null
}

interface AuthContextType {
  me: User | undefined
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useSWR<User>(
    "/api/auth/me",
    (url: string) => fetch(url).then((r) => r.json()),
    {
      revalidateOnFocus: false,
      dedupingInterval: 300000, // 5 minutes - cache aggressively across page navigations
      revalidateOnReconnect: false,
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
  if (context === undefined) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return context
}
