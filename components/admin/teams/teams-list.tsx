"use client"

import { useState } from "react"
import { Search, RefreshCw, X, UsersRound, Eye, Pencil, Trash2, Save, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PaginationControl } from "@/components/ui/pagination-control"
import { cn } from "@/lib/utils"
import { hasStaffPermission, STAFF_PERMISSIONS } from "@/lib/permissions-client"
import { UserAvatar } from "../shared/user-avatar"
import type { Team, TeamDetails } from "../types"

interface TeamsListProps {
  teams: Team[]
  loading: boolean
  page: number
  totalPages: number
  search: string
  onSearchChange: (search: string) => void
  onSearch: () => void
  onPageChange: (page: number) => void
  onRefresh: () => void
  onViewMembers: (teamId: number) => void
  onRename: (teamId: number, newName: string) => Promise<void>
  onDelete: (teamId: number, teamName: string) => void
  callerRole: string
  actionLoading: string | null
  teamMembers: TeamDetails | null
  teamMembersLoading: boolean
  onCloseTeamMembers: () => void
}

export function TeamsList({
  teams,
  loading,
  page,
  totalPages,
  search,
  onSearchChange,
  onSearch,
  onPageChange,
  onRefresh,
  onViewMembers,
  onRename,
  onDelete,
  callerRole,
  actionLoading,
  teamMembers,
  teamMembersLoading,
  onCloseTeamMembers,
}: TeamsListProps) {
  const [editingTeam, setEditingTeam] = useState<{ id: number; name: string } | null>(null)

  const handleRename = async (teamId: number, newName: string) => {
    await onRename(teamId, newName)
    setEditingTeam(null)
  }

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card className="bg-card border-border">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Team Management</h2>
                <p className="text-xs text-muted-foreground">View and manage all platform teams</p>
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs self-start sm:self-auto" onClick={onRefresh}>
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                Refresh
              </Button>
            </div>
            
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search teams by name..."
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearch()}
                className="pl-9 h-10 bg-background"
              />
              {search && (
                <button 
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => { onSearchChange(""); onSearch() }}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Team Members Modal */}
      {teamMembers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCloseTeamMembers}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{teamMembers.team.name}</h3>
                <p className="text-xs text-muted-foreground">{teamMembers.members.length} members</p>
              </div>
              <button onClick={onCloseTeamMembers} className="p-1 rounded hover:bg-muted">
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
      
      {/* Teams List */}
      <Card className="bg-card border-border overflow-hidden">
        {loading ? (
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
              {search ? "No teams found" : "No teams yet"}
            </p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {search ? "Try a different search term" : "Teams created by users will appear here"}
            </p>
          </div>
        ) : (
          <>
            <div className="px-4 sm:px-5 py-3 border-b border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{teams.length}</span> teams
              </p>
            </div>
            
            {/* Desktop Table */}
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
                            <Button size="sm" className="h-8 px-2" onClick={() => handleRename(team.id, editingTeam.name)} disabled={actionLoading === `team-rename-${team.id}`}>
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
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onViewMembers(team.id)} title="View members">
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
                              onClick={() => onDelete(team.id, team.name)}
                              title="Delete team"
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
            
            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-border">
              {teams.map((team) => (
                <div key={team.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{team.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{team.slug}</p>
                    </div>
                    <Badge variant="secondary" className="text-xs shrink-0">{team.member_count} members</Badge>
                  </div>
                  
                  <div className="flex items-center gap-2 mt-3">
                    <UserAvatar name={team.owner_name} email={team.owner_email} size="sm" avatarUrl={team.owner_avatar_url} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">Owner</p>
                      <p className="text-sm text-foreground truncate">{team.owner_name || team.owner_email.split("@")[0]}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
                    <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => onViewMembers(team.id)}>
                      <Eye className="h-3 w-3 mr-1.5" /> View Members
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setEditingTeam({ id: team.id, name: team.name })}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_USER) && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-8 w-8 p-0 text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => onDelete(team.id, team.name)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            {totalPages > 1 && (
              <div className="px-4 sm:px-5 py-3 border-t border-border bg-muted/10">
                <PaginationControl
                  currentPage={page}
                  totalPages={totalPages}
                  onPageChange={onPageChange}
                />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
