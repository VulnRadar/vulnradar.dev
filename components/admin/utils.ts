// Admin Panel Utility Functions

import { ACTION_META } from "./constants"
import type { AuditEntry } from "./types"

export function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  
  if (diffSecs < 60) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function getActionSentence(log: AuditEntry): string {
  const meta = ACTION_META[log.action]
  const adminName = log.admin_name || log.admin_email.split("@")[0]
  const targetName = log.target_name || (log.target_email ? log.target_email.split("@")[0] : null)
  
  if (meta?.verb) {
    if (targetName) {
      return `${adminName} ${meta.verb} ${targetName}`
    }
    return `${adminName} ${meta.verb.replace(/ (for|to|from|of)$/, "")}`
  }
  
  // Fallback
  const actionLabel = log.action.split("_").join(" ")
  return targetName ? `${adminName} performed "${actionLabel}" on ${targetName}` : `${adminName} performed "${actionLabel}"`
}

export function filterAuditLogs(logs: AuditEntry[], filter: string, search: string): AuditEntry[] {
  return logs.filter(log => {
    // Search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase()
      const matchesSearch = 
        log.admin_email?.toLowerCase().includes(searchLower) ||
        log.admin_name?.toLowerCase().includes(searchLower) ||
        log.target_email?.toLowerCase().includes(searchLower) ||
        log.target_name?.toLowerCase().includes(searchLower) ||
        log.action?.toLowerCase().includes(searchLower) ||
        log.details?.toLowerCase().includes(searchLower)
      if (!matchesSearch) return false
    }
    
    // Category filter
    if (filter === "all") return true
    if (filter === "security") {
      return ["reset_password", "revoke_sessions", "revoke_api_keys", "reset_2fa", "force_logout_all", "reset_temp_password"].includes(log.action)
    }
    if (filter === "user") {
      return ["set_role", "make_admin", "remove_admin", "change_email", "award_badge", "revoke_badge"].includes(log.action)
    }
    if (filter === "plan") {
      return ["set_plan", "gift_plan", "remove_gift", "update_plan", "gift_subscription", "revoke_gift"].includes(log.action)
    }
    if (filter === "danger") {
      return ["delete_user", "disable_user", "delete_scan", "delete_scans", "revoke_sessions", "revoke_api_keys", "delete", "disable"].includes(log.action)
    }
    return true
  })
}

export function getEffectivePlan(user: { plan: string; gifted_plan?: string | null }): string | null {
  return user.gifted_plan || user.plan
}

export function formatPlanLabel(plan: string): string {
  return plan.replace("_supporter", "").charAt(0).toUpperCase() + plan.replace("_supporter", "").slice(1)
}
