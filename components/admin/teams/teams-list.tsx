"use client";

import React, { useState } from "react";
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/ui/utils";
import { PaginationControl } from "@/components/ui/pagination-control";
import { UserAvatar, ConfirmDialog } from "@/components/admin/shared";
import {
  hasStaffPermission,
  STAFF_PERMISSIONS,
} from "@/lib/auth/permissions-client";

interface Team {
  id: number;
  name: string;
  slug: string;
  owner_id: number;
  owner_email: string;
  owner_name: string | null;
  owner_avatar_url: string | null;
  member_count: number;
  created_at: string;
}

interface TeamMember {
  user_id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: string;
}

interface TeamsListProps {
  teams: Team[];
  teamsLoading: boolean;
  teamsSearch: string;
  setTeamsSearch: (search: string) => void;
  fetchTeams: (page?: number, search?: string) => void;
  teamsTotalPages: number;
  teamsPage: number;
  teamsPageSize: number;
  setTeamsPageSize: (size: number) => void;
  handleTeamRename: (teamId: number, newName: string) => void;
  handleTeamDelete: (teamId: number) => void;
  fetchTeamMembers: (teamId: number) => void;
  teamMembers: { team: Team; members: TeamMember[] } | null;
  setTeamMembers: (
    members: { team: Team; members: TeamMember[] } | null,
  ) => void;
  teamMembersLoading: boolean;
  actionLoading: string | null;
  callerRole: string;
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
  const [editingTeam, setEditingTeam] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  // Track which team was clicked so modal opens instantly before data loads
  const [modalTeam, setModalTeam] = useState<Team | null>(null);

  const openTeamModal = (team: Team) => {
    setModalTeam(team);
    fetchTeamMembers(team.id);
  };

  const closeTeamModal = () => {
    setModalTeam(null);
    setTeamMembers(null);
  };

  return (
    <>
      {/* Team members modal — rendered outside card flow to prevent layout shift */}
      {modalTeam && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeTeamModal}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <UsersRound className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {modalTeam.name}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {teamMembersLoading
                      ? "Loading members..."
                      : `${teamMembers?.members.length ?? 0} member${(teamMembers?.members.length ?? 0) !== 1 ? "s" : ""}`}
                  </p>
                </div>
              </div>
              <button
                onClick={closeTeamModal}
                className="p-2 rounded-lg hover:bg-muted transition-colors"
                aria-label="Close team members dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {teamMembersLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-2">
                {(teamMembers?.members ?? []).map((member) => (
                  <div
                    key={member.user_id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/50 transition-colors"
                  >
                    <UserAvatar
                      name={member.name}
                      email={member.email}
                      size="sm"
                      avatarUrl={member.avatar_url}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {member.name || member.email.split("@")[0]}
                      </p>
                      <p className="text-xs text-muted-foreground truncate font-mono">
                        {member.email}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-2 py-0.5 font-medium capitalize",
                        member.role === "owner" &&
                          "bg-primary/10 text-primary border-primary/20",
                        member.role === "admin" &&
                          "bg-amber-500/10 text-amber-500 border-amber-500/20",
                        member.role === "member" &&
                          "bg-muted text-muted-foreground border-border",
                      )}
                    >
                      {member.role}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Teams table */}
        <Card className="border-border/50 bg-card/50 overflow-hidden">
          <CardHeader className="pb-4 pt-5 px-5">
            <div className="flex flex-col gap-4">
              {/* Title row */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <UsersRound className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base font-semibold">
                      Team Directory
                    </CardTitle>
                    <Badge
                      variant="secondary"
                      className="text-[11px] font-medium h-5 px-2"
                    >
                      {teams.length}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    View and manage all platform teams
                  </p>
                </div>
              </div>
              {/* Search and actions row */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search teams by name..."
                    value={teamsSearch}
                    onChange={(e) => setTeamsSearch(e.target.value)}
                    className="pl-9 h-10 bg-background/50 border-border/40 focus:border-primary/50"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 px-3 gap-2 border-border/40 shrink-0"
                  onClick={() => fetchTeams(teamsPage, teamsSearch)}
                >
                  <RefreshCw
                    className={cn("h-4 w-4", teamsLoading && "animate-spin")}
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {teamsLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Loading teams...
                </p>
              </div>
            ) : teams.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-4">
                <div className="p-4 rounded-full bg-muted/50 mb-4">
                  <UsersRound className="h-8 w-8 text-muted-foreground/40" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  {teamsSearch ? "No teams found" : "No teams yet"}
                </p>
                <p className="text-xs text-muted-foreground max-w-sm text-center">
                  {teamsSearch
                    ? `No results for "${teamsSearch}". Try a different search term.`
                    : "Teams created by users will appear here."}
                </p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-y border-border/50 bg-muted/30">
                        <th className="px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">
                          Team
                        </th>
                        <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">
                          Owner
                        </th>
                        <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-center">
                          Members
                        </th>
                        <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">
                          Created
                        </th>
                        <th className="px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {teams.map((team) => (
                        <tr
                          key={team.id}
                          className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors group"
                        >
                          <td className="px-5 py-4">
                            {editingTeam?.id === team.id ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  value={editingTeam.name}
                                  onChange={(e) =>
                                    setEditingTeam({
                                      ...editingTeam,
                                      name: e.target.value,
                                    })
                                  }
                                  className="h-8 text-sm w-40 bg-background/50"
                                  autoFocus
                                />
                                <Button
                                  size="sm"
                                  className="h-8 px-2"
                                  onClick={() => {
                                    handleTeamRename(team.id, editingTeam.name);
                                    setEditingTeam(null);
                                  }}
                                  disabled={
                                    actionLoading === `team-rename-${team.id}`
                                  }
                                >
                                  {actionLoading ===
                                  `team-rename-${team.id}` ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Save className="h-3 w-3" />
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 px-2"
                                  onClick={() => setEditingTeam(null)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <div>
                                <p className="text-sm font-medium text-foreground">
                                  {team.name}
                                </p>
                                <p className="text-xs text-muted-foreground font-mono">
                                  {team.slug}
                                </p>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <UserAvatar
                                name={team.owner_name}
                                email={team.owner_email}
                                size="sm"
                                avatarUrl={team.owner_avatar_url}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate max-w-[140px]">
                                  {team.owner_name ||
                                    team.owner_email.split("@")[0]}
                                </p>
                                <p className="text-xs text-muted-foreground truncate max-w-[140px] font-mono">
                                  {team.owner_email}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <Badge
                              variant="secondary"
                              className="text-xs font-medium"
                            >
                              {team.member_count}
                            </Badge>
                          </td>
                          <td className="px-4 py-4 text-sm text-muted-foreground whitespace-nowrap">
                            {new Date(team.created_at).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              },
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => openTeamModal(team)}
                                title="View members"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span className="text-xs">View</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() =>
                                  setEditingTeam({
                                    id: team.id,
                                    name: team.name,
                                  })
                                }
                                title="Rename"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              {hasStaffPermission(
                                callerRole,
                                STAFF_PERMISSIONS.DELETE_USER,
                              ) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() =>
                                    setConfirmDialog({
                                      title: "Delete Team",
                                      description: `This will permanently delete "${team.name}" and remove all ${team.member_count} members. This cannot be undone.`,
                                      confirmLabel: "Delete Team",
                                      danger: true,
                                      onConfirm: () => {
                                        handleTeamDelete(team.id);
                                        setConfirmDialog(null);
                                      },
                                    })
                                  }
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
                <div className="md:hidden">
                  {teams.map((team) => (
                    <div
                      key={team.id}
                      className="px-5 py-4 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {team.name}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {team.slug}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className="text-xs font-medium shrink-0"
                        >
                          {team.member_count} members
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mb-3">
                        <UserAvatar
                          name={team.owner_name}
                          email={team.owner_email}
                          size="sm"
                          avatarUrl={team.owner_avatar_url}
                        />
                        <div className="min-w-0">
                          <p className="text-sm truncate">
                            {team.owner_name || team.owner_email.split("@")[0]}
                          </p>
                          <p className="text-xs text-muted-foreground truncate font-mono">
                            {team.owner_email}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                        <span>
                          Created{" "}
                          {new Date(team.created_at).toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric" },
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs flex-1 border-border/40"
                          onClick={() => openTeamModal(team)}
                        >
                          <Eye className="h-3 w-3 mr-1.5" /> View Members
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0 border-border/40"
                          onClick={() =>
                            setEditingTeam({ id: team.id, name: team.name })
                          }
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        {hasStaffPermission(
                          callerRole,
                          STAFF_PERMISSIONS.DELETE_USER,
                        ) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 p-0 border-destructive/30 text-destructive hover:bg-destructive/10"
                            onClick={() =>
                              setConfirmDialog({
                                title: "Delete Team",
                                description: `This will permanently delete "${team.name}" and remove all ${team.member_count} members. This cannot be undone.`,
                                confirmLabel: "Delete Team",
                                danger: true,
                                onConfirm: () => {
                                  handleTeamDelete(team.id);
                                  setConfirmDialog(null);
                                },
                              })
                            }
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {teams.length > 0 && (
                  <div className="px-5 py-4 border-t border-border/40 bg-muted/20">
                    <PaginationControl
                      currentPage={teamsPage}
                      totalPages={teamsTotalPages}
                      onPageChange={(p) => fetchTeams(p)}
                      pageSize={teamsPageSize}
                      onPageSizeChange={(s) => {
                        setTeamsPageSize(s);
                        fetchTeams(1);
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </CardContent>
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
    </>
  );
}
