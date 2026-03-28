"use client"

import React, { useState } from "react"
import {
  Search,
  Loader2,
  RefreshCw,
  X,
  UsersRound,
  Eye,
  Pencil,
  Save,
  Trash2,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { PaginationControl } from "@/components/ui/pagination-control"
import { UserAvatar, ConfirmDialog } from "@/components/admin/shared"
import { hasStaffPermission, STAFF_PERMISSIONS } from "@/lib/permissions-client"

interface Team {
  id: number
  name: string
  slug: string
  owner_id: number
  owner_email: string
  owner_name: string | null
  owner_avatar_url: string | null
  member_count: number
  created_at: string
}

interface TeamMember {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
  role: string
}

interface TeamsListProps {
  teams: Team[]
  teamsLoading: boolean
  teamsSearch: string
  setTeamsSearch: (search: string) => void
  fetchTeams: (page?: number, search?: string) => void
  teamsTotalPages: number
  teamsPage: number
  teamsPageSize: number
  setTeamsPageSize: (size: number) => void
  handleTeamRename: (teamId: number, newName: string) => void
  handleTeamDelete: (teamId: number) => void
  fetchTeamMembers: (teamId: number) => void
  teamMembers: { team: Team; members: TeamMember[] } | null
  setTeamMembers: (members: { team: Team; members: TeamMember[] } | null) => void
  teamMembersLoading: boolean
  actionLoading: string | null
  callerRole: string
}

export function TeamsList({
  teams,
  teamsLoading,
  teamsSearch,
  setTeamsSearch,
  fetchTeams,
  teamsTotalPages,
  teamsPage,
  teamsPageSize,
  setTeamsPageSize,
  handleTeamRename,
  handleTeamDelete,
  fetchTeamMembers,
  teamMembers,
  setTeamMembers,
  teamMembersLoading,
  actionLoading,
  callerRole,
}: TeamsListProps) {
  const [editingTeam, setEditingTeam] = useState<{ id: number; name: string } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    description: string
    confirmLabel: string
    danger?: boolean
    onConfirm: () => void
  } | null>(null)

  return (
    <div className="space-y-4">
      <Card className="bg-card border-border">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Team Management</h2>
                <p className="text-xs text-muted-foreground">View and manage all platform teams</p>
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs self-start sm:self-auto" onClick={() => fetchTeams(1)}>
                <RefreshCw className={cn("h-3.5 w-3.5", teamsLoading && "animate-spin")} />
                Refresh
              </Button>
            </div>
            
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search teams by name..."
                value={teamsSearch}
                onChange={(e) => setTeamsSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchTeams(1, teamsSearch)}
                className="pl-9 h-10 bg-background"
              />
              {teamsSearch && (
                <button 
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => { setTeamsSearch(""); fetchTeams(1, "") }}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Team members modal */}
      {teamMembers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setTeamMembers(null)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{teamMembers.team.name}</h3>
                <p className="text-xs text-muted-foreground">{teamMembers.members.length} members</p>
              </div>
              <button onClick={() => setTeamMembers(null)} className="p-1 rounded hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            
            {teamMembersLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-2">
                {teamMembers.members.map((member) => (
                  <div key={member.user_id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                    <UserAvatar name={member.name} email={member.email} size="sm" avatarUrl={member.avatar_url} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{member.name || member.email.split("@")[0]}</p>
                      <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                    </div>
                    <Badge variant="outline" className={cn(
                      "text-[10px] capitalize",
                      member.role === "owner" && "bg-primary/10 text-primary border-primary/20",
                      member.role === "admin" && "bg-amber-500/10 text-amber-500 border-amber-500/20",
                    )}>
                      {member.role}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Teams table */}
      <Card className="bg-card border-border overflow-hidden">
        {teamsLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Loading teams...</p>
          </div>
        ) : teams.length === 0 ? (
          <div className="py-16 text-center px-4">
            <div className="h-16 w-16 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-4">
              <UsersRound className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-base font-medium text-muted-foreground">
              {teamsSearch ? "No teams found" : "No teams yet"}
            </p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {teamsSearch ? "Try a different search term" : "Teams created by users will appear here"}
            </p>
          </div>
        ) : (
          <>
            <div className="px-4 sm:px-5 py-3 border-b border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{teams.length}</span> teams
              </p>
            </div>
            
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/10">
                    <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Team</th>
                    <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Owner</th>
                    <th className="text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Members</th>
                    <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Created</th>
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team, i) => (
                    <tr key={team.id} className={cn("hover:bg-muted/30 transition-colors", i < teams.length - 1 && "border-b border-border/50")}>
                      <td className="px-5 py-3.5">
                        {editingTeam?.id === team.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={editingTeam.name}
                              onChange={(e) => setEditingTeam({ ...editingTeam, name: e.target.value })}
                              className="h-8 text-sm w-40"
                              autoFocus
                            />
                            <Button size="sm" className="h-8 px-2" onClick={() => { handleTeamRename(team.id, editingTeam.name); setEditingTeam(null); }} disabled={actionLoading === `team-rename-${team.id}`}>
                              {actionLoading === `team-rename-${team.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditingTeam(null)}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <div>
                            <p className="text-sm font-medium text-foreground">{team.name}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{team.slug}</p>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-2">
                          <UserAvatar name={team.owner_name} email={team.owner_email} size="sm" avatarUrl={team.owner_avatar_url} />
                          <div className="min-w-0">
                            <p className="text-sm text-foreground truncate max-w-[120px]">{team.owner_name || team.owner_email.split("@")[0]}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        <Badge variant="secondary" className="text-xs">{team.member_count}</Badge>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className="text-xs text-muted-foreground">{new Date(team.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-1 justify-end">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => fetchTeamMembers(team.id)} title="View members">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditingTeam({ id: team.id, name: team.name })} title="Rename">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_USER) && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => setConfirmDialog({
                                title: "Delete Team",
                                description: `This will permanently delete "${team.name}" and remove all ${team.member_count} members. This cannot be undone.`,
                                confirmLabel: "Delete Team",
                                danger: true,
                                onConfirm: () => { handleTeamDelete(team.id); setConfirmDialog(null); }
                              })}
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Mobile view */}
            <div className="md:hidden divide-y divide-border">
              {teams.map((team) => (
                <div key={team.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{team.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{team.slug}</p>
                    </div>
                    <Badge variant="secondary" className="text-xs">{team.member_count}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <UserAvatar name={team.owner_name} email={team.owner_email} size="sm" avatarUrl={team.owner_avatar_url} />
                    <span className="text-xs text-muted-foreground">{team.owner_name || team.owner_email.split("@")[0]}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={() => fetchTeamMembers(team.id)}>
                      <Eye className="h-3 w-3 mr-1" /> View
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={() => setEditingTeam({ id: team.id, name: team.name })}>
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            
            {teamsTotalPages > 1 && (
              <div className="px-4 sm:px-5 py-3 border-t border-border bg-muted/10">
                <PaginationControl
                  currentPage={teamsPage}
                  totalPages={teamsTotalPages}
                  onPageChange={(p) => fetchTeams(p)}
                  pageSize={teamsPageSize}
                  onPageSizeChange={(s) => { setTeamsPageSize(s); fetchTeams(1) }}
                />
              </div>
            )}
          </>
        )}
      </Card>
      
      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title || ""}
        description={confirmDialog?.description || ""}
        confirmLabel={confirmDialog?.confirmLabel || "Confirm"}
        danger={confirmDialog?.danger}
        onConfirm={confirmDialog?.onConfirm || (() => {})}
        onCancel={() => setConfirmDialog(null)}
      />
    </div>
  )
}
