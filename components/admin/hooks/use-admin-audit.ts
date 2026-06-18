"use client"

import { useState, useCallback } from "react"
import type { AuditEntry } from "../types"
import { fetchAuditLogs } from "../services"

interface UseAdminAuditOptions {
  initialPageSize?: number
}

/**
 * Admin audit hook - manages audit log fetching and pagination
 */
export function useAdminAudit({ initialPageSize = 10 }: UseAdminAuditOptions = {}) {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [paging, setPaging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [filter, setFilter] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [expandedLog, setExpandedLog] = useState<number | null>(null)

  /**
   * Fetch audit logs with pagination
   */
  const refresh = useCallback(async (p = 1, limit = pageSize) => {
    setPaging(true)
    setError(null)
    
    try {
      const data = await fetchAuditLogs({ page: p, limit })
      setLogs(data.logs)
      setPage(data.page)
      setTotalPages(data.totalPages)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs")
    }
    
    setPaging(false)
  }, [pageSize])

  /**
   * Filter logs client-side (basic filtering)
   */
  const filteredLogs = logs.filter(log => {
    // Category filter
    if (filter !== "all") {
      const categoryMap: Record<string, string[]> = {
        role: ["set_role", "make_admin", "remove_admin"],
        security: ["reset_password", "revoke_sessions", "revoke_api_keys", "reset_2fa", "force_logout_all"],
        account: ["disable_user", "disable", "enable_user", "enable", "delete_user", "delete"],
        profile: ["update_name", "update_email", "update_plan", "clear_avatar", "verify_email", "unverify_email"],
        badge: ["award_badge", "revoke_badge", "create_badge", "delete_badge"],
        data: ["delete_scans", "delete_webhooks", "delete_schedules", "export_data", "clear_rate_limits"],
      }
      if (categoryMap[filter] && !categoryMap[filter].includes(log.action)) {
        return false
      }
    }
    
    // Search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase()
      const matches = 
        log.action.toLowerCase().includes(searchLower) ||
        (log.admin_email?.toLowerCase().includes(searchLower)) ||
        (log.admin_name?.toLowerCase().includes(searchLower)) ||
        (log.target_email?.toLowerCase().includes(searchLower)) ||
        (log.target_name?.toLowerCase().includes(searchLower)) ||
        (log.details?.toLowerCase().includes(searchLower))
      if (!matches) return false
    }
    
    return true
  })

  /**
   * Toggle expanded log
   */
  const toggleExpanded = useCallback((logId: number) => {
    setExpandedLog(prev => prev === logId ? null : logId)
  }, [])

  return {
    // State
    logs: filteredLogs,
    allLogs: logs,
    paging,
    error,
    page,
    totalPages,
    pageSize,
    filter,
    search,
    expandedLog,
    
    // Setters
    setPage,
    setPageSize,
    setFilter,
    setSearch,
    
    // Actions
    refresh,
    toggleExpanded,
  }
}

export type AdminAuditController = ReturnType<typeof useAdminAudit>
