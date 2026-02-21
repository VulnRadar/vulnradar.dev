"use client"

import { createContext, useContext, ReactNode, useEffect } from "react"
import useSWR from "swr"

interface AuthContextType {
  me: any
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useSWR("/api/auth/me", fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 300000,
    keepPreviousData: true,
  })

  // Keep localStorage + injected <style> in sync so the blocking
  // script in layout.tsx shows the right elements before React loads.
  useEffect(() => {
    if (!me) return
    try {
      localStorage.setItem("vr_auth_cache", JSON.stringify(me))
    } catch {}

    // Update the injected style tag to match live auth state
    const isStaff = ["admin", "moderator", "support"].includes(me.role)
    let css = ""
    if (me.userId) css += ".vr-auth-only{visibility:visible!important;pointer-events:auto!important}"
    if (isStaff) css += ".vr-staff-only{display:flex!important}"

    let el = document.getElementById("vr-auth-css")
    if (!el) {
      el = document.createElement("style")
      el.id = "vr-auth-css"
      document.head.appendChild(el)
    }
    el.textContent = css
  }, [me])

  return (
    <AuthContext.Provider value={{ me, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used within AuthProvider")
  return context
}

export function clearAuthCache() {
  try { localStorage.removeItem("vr_auth_cache") } catch {}
  const el = document.getElementById("vr-auth-css")
  if (el) el.textContent = ""
}
