"use client"

import { createContext, useContext, ReactNode, useEffect, useMemo } from "react"
import useSWR from "swr"
import { API, STAFF_ROLES } from "@/lib/constants"
import { 
  isStaffRole, 
  hasStaffPermission, 
  canAccessAdmin, 
  canAccessStaffPage,
  getStaffPermissions,
  STAFF_PERMISSIONS,
  type StaffPermission 
} from "@/lib/permissions-client"

interface AuthContextType {
  me: any
  isLoading: boolean
  // Permission helpers
  isStaff: boolean
  canAccessAdmin: boolean
  canAccessStaffPage: boolean
  hasPermission: (permission: StaffPermission) => boolean
  permissions: StaffPermission[]
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useSWR(API.AUTH.ME, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 300000,
    keepPreviousData: true,
  })

  // Compute permissions based on role
  const userRole = me?.role || null
  const authHelpers = useMemo(() => ({
    isStaff: isStaffRole(userRole),
    canAccessAdmin: canAccessAdmin(userRole),
    canAccessStaffPage: canAccessStaffPage(userRole),
    hasPermission: (permission: StaffPermission) => hasStaffPermission(userRole, permission),
    permissions: getStaffPermissions(userRole),
  }), [userRole])

  // Keep localStorage + injected <style> in sync so the blocking
  // script in layout.tsx shows the right elements before React loads.
  useEffect(() => {
    if (!me) return
    try {
      localStorage.setItem("vr_auth_cache", JSON.stringify(me))
    } catch {}

    // Update the injected style tag to match live auth state
    const userIsStaff = isStaffRole(me.role)
    let css = ""
    if (me.userId) css += ".vr-auth-only{visibility:visible!important;pointer-events:auto!important}"
    if (userIsStaff) css += ".vr-staff-only{display:flex!important}"

    let el = document.getElementById("vr-auth-css")
    if (!el) {
      el = document.createElement("style")
      el.id = "vr-auth-css"
      document.head.appendChild(el)
    }
    el.textContent = css
  }, [me])

  return (
    <AuthContext.Provider value={{ me, isLoading, ...authHelpers }}>
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
