"use client"

import { useAuth } from "@/components/auth-provider"
import { useAdminHeartbeat } from "@/lib/hooks/use-admin-heartbeat"

/**
 * Mounts the global staff heartbeat inside the AuthProvider tree.
 * Fires every 60 seconds only when the current user is a staff member.
 * Must be rendered as a child of <AuthProvider>.
 */
export function StaffHeartbeat() {
  const { isStaff } = useAuth()
  useAdminHeartbeat({ enabled: isStaff })
  return null
}
