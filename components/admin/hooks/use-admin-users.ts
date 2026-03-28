"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import type { AdminUser, AdminStats, UserDetail, BadgeDef } from "../types"
import { 
  fetchAdminUsers, 
  fetchUserDetail as fetchUserDetailService,
  performUserAction,
  ApiError
} from "../services"
import { fetchBadges } from "../services/admin-badges-service"
import { ACTION_LABELS } from "../config"
import type { AdminToastController } from "./use-admin-toast"

interface UseAdminUsersOptions {
  toast: AdminToastController
  initialPageSize?: number
}

/**
 * Admin users hook - manages user list, search, pagination, and mutations
 */
export function useAdminUsers({ toast, initialPageSize = 10 }: UseAdminUsersOptions) {
  // State
  const [users, setUsers] = useState<AdminUser[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchLoading, setSearchLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [searchQuery, setSearchQuery] = useState("")
  const [callerRole, setCallerRole] = useState<string>("user")
  const [forbidden, setForbidden] = useState(false)
  
  // Selected user detail
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  
  // Action loading state
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  
  // Badges
  const [allBadges, setAllBadges] = useState<BadgeDef[]>([])
  
  // Search debounce ref
  const searchInitRef = useRef(false)

  /**
   * Fetch users with pagination and search
   */
  const refresh = useCallback(async (p = 1, search = searchQuery, isInitial = false, limit = pageSize) => {
    if (isInitial) setLoading(true)
    else setSearchLoading(true)
    setError(null)
    
    try {
      const data = await fetchAdminUsers({ page: p, limit, search: search.trim() || undefined })
      setStats(data.stats)
      setUsers(data.users)
      setPage(data.page)
      setTotalPages(data.totalPages)
      if (data.callerRole) setCallerRole(data.callerRole)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true)
      } else {
        setError(err instanceof Error ? err.message : "Failed to load users")
      }
    }
    
    setLoading(false)
    setSearchLoading(false)
  }, [searchQuery, pageSize])

  /**
   * Fetch user detail
   */
  const fetchUserDetail = useCallback(async (userId: number) => {
    setDetailLoading(true)
    try {
      const data = await fetchUserDetailService(userId)
      setSelectedUser(data)
      return data
    } catch (err) {
      toast.error("Failed to load user details.")
      return null
    } finally {
      setDetailLoading(false)
    }
  }, [toast])

  /**
   * Fetch all badges
   */
  const refreshBadges = useCallback(async () => {
    try {
      const data = await fetchBadges()
      setAllBadges(data.badges || [])
    } catch {
      // Ignore badge fetch errors
    }
  }, [])

  /**
   * Perform action on user with optimistic updates where applicable
   */
  const handleAction = useCallback(async (
    userId: number, 
    action: string, 
    extra?: Record<string, unknown>
  ): Promise<boolean> => {
    setActionLoading(`${userId}-${action}`)
    
    try {
      const data = await performUserAction(userId, action, extra)
      
      // Handle special responses
      if (action === "reset_password" && data.tempPassword) {
        setTempPassword(data.tempPassword)
      }
      
      // Refresh badges if needed
      if (action === "create_badge" || action === "delete_badge") {
        await refreshBadges()
      }
      
      // Show success toast
      const label = ACTION_LABELS[action] || "Action completed."
      toast.success(label)
      
      // Skip refetch for badge operations (handled optimistically)
      const skipRefetch = action === "award_badge" || action === "revoke_badge"
      if (!skipRefetch) {
        await refresh(page)
        if (selectedUser && selectedUser.user.id === userId) {
          if (action === "delete") {
            setSelectedUser(null)
          } else {
            await fetchUserDetail(userId)
          }
        }
      }
      
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed."
      toast.error(message)
      return false
    } finally {
      setActionLoading(null)
    }
  }, [refresh, page, selectedUser, fetchUserDetail, refreshBadges, toast])

  /**
   * Optimistically update user badges
   */
  const updateUserBadges = useCallback((awardedIds: number[], revokedIds: number[]) => {
    setSelectedUser((prev) => {
      if (!prev) return null
      
      // Add awarded badges
      const newBadges = allBadges
        .filter(b => awardedIds.includes(b.id))
        .map(b => ({ ...b, awarded_at: new Date().toISOString() }))
      
      // Remove revoked badges and add new ones
      const updatedBadges = [
        ...prev.badges.filter(b => !revokedIds.includes(b.id)),
        ...newBadges
      ]
      
      return { ...prev, badges: updatedBadges }
    })
  }, [allBadges])

  /**
   * Close selected user detail
   */
  const closeDetail = useCallback(() => {
    setSelectedUser(null)
  }, [])

  /**
   * Clear temp password
   */
  const clearTempPassword = useCallback(() => {
    setTempPassword(null)
  }, [])

  // Debounced search effect
  useEffect(() => {
    if (!searchInitRef.current) {
      searchInitRef.current = true
      return
    }
    
    setSearchLoading(true)
    const timeout = setTimeout(() => {
      refresh(1, searchQuery, false)
    }, 300)
    
    return () => {
      clearTimeout(timeout)
      setSearchLoading(false)
    }
  }, [searchQuery])

  // Initial load
  useEffect(() => {
    refresh(1, "", true)
    refreshBadges()
  }, [])

  return {
    // State
    users,
    stats,
    loading,
    searchLoading,
    error,
    forbidden,
    page,
    totalPages,
    pageSize,
    searchQuery,
    callerRole,
    
    // Selected user
    selectedUser,
    detailLoading,
    
    // Action state
    actionLoading,
    tempPassword,
    
    // Badges
    allBadges,
    
    // Setters
    setPage,
    setPageSize,
    setSearchQuery,
    
    // Actions
    refresh,
    fetchUserDetail,
    handleAction,
    updateUserBadges,
    closeDetail,
    clearTempPassword,
    refreshBadges,
  }
}

export type AdminUsersController = ReturnType<typeof useAdminUsers>
