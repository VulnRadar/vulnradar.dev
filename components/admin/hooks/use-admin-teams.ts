"use client"

import { useState, useCallback } from "react"
import type { Team, TeamDetail } from "../types"
import { fetchTeams, fetchTeamDetail, renameTeam, deleteTeam } from "../services"
import type { AdminToastController } from "./use-admin-toast"

interface UseAdminTeamsOptions {
  toast: AdminToastController
}

/**
 * Admin teams hook - manages team listing and mutations
 */
export function useAdminTeams({ toast }: UseAdminTeamsOptions) {
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState("")
  
  // Team detail
  const [teamDetail, setTeamDetail] = useState<TeamDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  
  // Editing state
  const [editingTeam, setEditingTeam] = useState<{ id: number; name: string } | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  /**
   * Fetch teams with pagination and search
   */
  const refresh = useCallback(async (p = 1, searchQuery = search) => {
    setLoading(true)
    setError(null)
    
    try {
      const data = await fetchTeams({ 
        page: p, 
        limit: 10, 
        search: searchQuery.trim() || undefined 
      })
      setTeams(data.teams || [])
      setPage(data.page || 1)
      setTotalPages(data.totalPages || 1)
    } catch (error) {
      setError(err instanceof Error ? err.message : "Failed to load teams")
    }
    
    setLoading(false)
  }, [search])

  /**
   * Fetch team detail with members
   */
  const getTeamDetail = useCallback(async (teamId: number) => {
    setDetailLoading(true)
    try {
      const data = await fetchTeamDetail(teamId)
      setTeamDetail(data)
      return data
    } catch {
      toast.error("Failed to load team members")
      return null
    } finally {
      setDetailLoading(false)
    }
  }, [toast])

  /**
   * Rename a team
   */
  const handleRename = useCallback(async (teamId: number, newName: string) => {
    setActionLoading(`team-rename-${teamId}`)
    
    try {
      const result = await renameTeam(teamId, newName)
      if (result.error) {
        toast.error(result.error)
        return false
      }
      
      toast.success("Team renamed successfully")
      setEditingTeam(null)
      await refresh(page)
      return true
    } catch (error) {
      toast.error("Failed to rename team")
      return false
    } finally {
      setActionLoading(null)
    }
  }, [page, refresh, toast])

  /**
   * Delete a team
   */
  const handleDelete = useCallback(async (teamId: number) => {
    setActionLoading(`team-delete-${teamId}`)
    
    try {
      const result = await deleteTeam(teamId)
      if (result.error) {
        toast.error(result.error)
        return false
      }
      
      toast.success("Team deleted successfully")
      await refresh(page)
      return true
    } catch (error) {
      toast.error("Failed to delete team")
      return false
    } finally {
      setActionLoading(null)
    }
  }, [page, refresh, toast])

  /**
   * Close team detail
   */
  const closeDetail = useCallback(() => {
    setTeamDetail(null)
  }, [])

  return {
    // State
    teams,
    loading,
    error,
    page,
    totalPages,
    search,
    
    // Detail
    teamDetail,
    detailLoading,
    
    // Editing
    editingTeam,
    actionLoading,
    
    // Setters
    setPage,
    setSearch,
    setEditingTeam,
    
    // Actions
    refresh,
    getTeamDetail,
    handleRename,
    handleDelete,
    closeDetail,
  }
}

export type AdminTeamsController = ReturnType<typeof useAdminTeams>
