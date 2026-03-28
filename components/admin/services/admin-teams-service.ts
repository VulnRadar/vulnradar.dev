// Admin teams service - API calls for team management

import { adminApi } from "../api-client"
import type { AdminTeamsResponse, AdminTeamDetailResponse, TeamRenameResponse, TeamDeleteResponse } from "../types.responses"

export interface FetchTeamsParams {
  page?: number
  limit?: number
  search?: string
}

/**
 * Fetch paginated list of teams
 */
export async function fetchTeams(params: FetchTeamsParams = {}): Promise<AdminTeamsResponse> {
  return adminApi.getTeams(params)
}

/**
 * Fetch team detail with members
 */
export async function fetchTeamDetail(teamId: number): Promise<AdminTeamDetailResponse> {
  return adminApi.getTeamDetail(teamId)
}

/**
 * Rename a team
 */
export async function renameTeam(teamId: number, name: string): Promise<TeamRenameResponse> {
  return adminApi.renameTeam(teamId, name)
}

/**
 * Delete a team
 */
export async function deleteTeam(teamId: number): Promise<TeamDeleteResponse> {
  return adminApi.deleteTeam(teamId)
}
