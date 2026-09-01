"use client";

import React, { useMemo, useState } from "react";
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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/ui/utils";
import { ROLE_COLORS } from "@/components/teams/teams-types";
import { PaginationControl } from "@/components/ui/pagination-control";
import {
  UserAvatar,
  ConfirmDialog,
  EmptyState,
  TableScrollArea,
  DataTableSkeleton,
  SortableHeader,
  type SortDirection,
} from "@/components/admin/shared";
import { useModalA11y } from "@/lib/hooks/use-modal-a11y";
import { useAdminPermissions } from "@/components/admin/hooks";

const focusRing =
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

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
  fetchTeams: (page?: number, search?: string, pageSize?: number) => void;
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
  const perms = useAdminPermissions(callerRole);
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
  const [teamSort, setTeamSort] = useState<{
    column: "members" | "created" | null;
    direction: SortDirection;
  }>({ column: null, direction: null });

  const openTeamModal = (team: Team) => {
    setModalTeam(team);
    fetchTeamMembers(team.id);
  };

  const closeTeamModal = () => {
    setModalTeam(null);
    setTeamMembers(null);
  };

  const { dialogProps: teamDialogProps, titleProps: teamTitleProps } =
    useModalA11y({ open: !!modalTeam, onClose: closeTeamModal });

  // Client-side sort of the currently loaded page of teams. Does not
  // trigger a refetch; only reorders what's already on screen.
  const sortedTeams = useMemo(() => {
    if (!teamSort.column || !teamSort.direction) return teams;
    const dir = teamSort.direction === "asc" ? 1 : -1;
    return [...teams].sort((a, b) => {
      if (teamSort.column === "members") {
        return (a.member_count - b.member_count) * dir;
      }
      // "created"
      return (
        (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
        dir
      );
    });
  }, [teams, teamSort]);

  const toggleTeamSort = (column: "members" | "created") => {
    setTeamSort((prev) => {
      if (prev.column !== column) return { column, direction: "asc" };
      if (prev.direction === "asc") return { column, direction: "desc" };
      return { column: null, direction: null };
    });
  };

  return (
    <>
      {/* Team members modal — rendered outside card flow to prevent layout shift */}
      {modalTeam && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
          onClick={closeTeamModal}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            {...teamDialogProps}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <UsersRound
                    className="h-4 w-4 text-primary"
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <h3
                    className="text-base font-semibold text-foreground"
                    {...teamTitleProps}
                  >
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
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {teamMembersLoading ? (
              <DataTableSkeleton rows={4} />
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
                        ROLE_COLORS[member.role] ||
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
                  <UsersRound
                    className="h-4 w-4 text-primary"
                    aria-hidden="true"
                  />
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
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                    aria-hidden="true"
                  />
                  <Input
                    placeholder="Search teams by name..."
                    value={teamsSearch}
                    onChange={(e) => setTeamsSearch(e.target.value)}
                    aria-label="Search teams by name"
                    className="pl-9 h-10 bg-background/50 border-border/40 focus:border-primary/50"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 px-3 gap-2 border-border/40 shrink-0"
                  onClick={() => fetchTeams(teamsPage, teamsSearch)}
                  aria-label="Refresh teams"
                >
                  <RefreshCw
                    className={cn("h-4 w-4", teamsLoading && "animate-spin")}
                    aria-hidden="true"
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {teamsLoading ? (
              <div className="p-4 sm:p-5">
                <DataTableSkeleton rows={6} />
              </div>
            ) : teams.length === 0 ? (
              <EmptyState
                icon={UsersRound}
                title={teamsSearch ? "No teams found" : "No teams yet"}
                description={
                  teamsSearch
                    ? `No results for "${teamsSearch}". Try a different search term.`
                    : "Teams created by users will appear here."
                }
              />
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block">
                  <TableScrollArea maxHeight="65vh">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm supports-backdrop-filter:bg-muted/90">
                        <TableRow className="border-y border-border/50 hover:bg-transparent">
                          <TableHead className="px-5 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Team
                          </TableHead>
                          <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Owner
                          </TableHead>
                          <TableHead className="px-4 h-10 text-center">
                            <SortableHeader
                              label="Members"
                              align="center"
                              active={teamSort.column === "members"}
                              direction={
                                teamSort.column === "members"
                                  ? teamSort.direction
                                  : null
                              }
                              onClick={() => toggleTeamSort("members")}
                            />
                          </TableHead>
                          <TableHead className="px-4 h-10">
                            <SortableHeader
                              label="Created"
                              active={teamSort.column === "created"}
                              direction={
                                teamSort.column === "created"
                                  ? teamSort.direction
                                  : null
                              }
                              onClick={() => toggleTeamSort("created")}
                            />
                          </TableHead>
                          <TableHead className="px-5 h-10 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedTeams.map((team) => (
                          <TableRow
                            key={team.id}
                            className="border-border/40 group"
                          >
                            <TableCell className="px-5 py-4">
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
                                    aria-label="Team name"
                                    className={cn(
                                      "h-8 text-sm w-40 bg-background/50",
                                      focusRing,
                                    )}
                                    autoFocus
                                  />
                                  <Button
                                    size="sm"
                                    className="h-8 px-2"
                                    onClick={() => {
                                      handleTeamRename(
                                        team.id,
                                        editingTeam.name,
                                      );
                                      setEditingTeam(null);
                                    }}
                                    disabled={
                                      actionLoading === `team-rename-${team.id}`
                                    }
                                    aria-label="Save team name"
                                  >
                                    {actionLoading ===
                                    `team-rename-${team.id}` ? (
                                      <Loader2
                                        className="h-3 w-3 animate-spin"
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <Save
                                        className="h-3 w-3"
                                        aria-hidden="true"
                                      />
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 px-2"
                                    onClick={() => setEditingTeam(null)}
                                    aria-label="Cancel rename"
                                  >
                                    <X className="h-3 w-3" aria-hidden="true" />
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
                            </TableCell>
                            <TableCell className="px-4 py-4">
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
                            </TableCell>
                            <TableCell className="px-4 py-4 text-center">
                              <Badge
                                variant="secondary"
                                className="text-xs font-medium"
                              >
                                {team.member_count}
                              </Badge>
                            </TableCell>
                            <TableCell className="px-4 py-4 text-sm text-muted-foreground whitespace-nowrap">
                              {new Date(team.created_at).toLocaleDateString(
                                "en-US",
                                {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                },
                              )}
                            </TableCell>
                            <TableCell className="px-5 py-4">
                              <div className="flex items-center gap-1 justify-end">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
                                  onClick={() => openTeamModal(team)}
                                  aria-label={`View members of ${team.name}`}
                                >
                                  <Eye
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  <span className="text-xs">View</span>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
                                  onClick={() =>
                                    setEditingTeam({
                                      id: team.id,
                                      name: team.name,
                                    })
                                  }
                                  aria-label={`Rename ${team.name}`}
                                >
                                  <Pencil
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                </Button>
                                {perms.canDeleteUsers && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
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
                                    aria-label={`Delete ${team.name}`}
                                  >
                                    <Trash2
                                      className="h-3.5 w-3.5"
                                      aria-hidden="true"
                                    />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableScrollArea>
                </div>

                {/* Mobile view */}
                <div className="md:hidden">
                  {sortedTeams.map((team) => (
                    <div
                      key={team.id}
                      className="px-5 py-4 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        {/* The rename editor has to exist in this branch too.
                            It used to live only in the hidden md:block table,
                            so tapping Rename on a phone set editingTeam and
                            then rendered nothing: no way to rename a team. */}
                        {editingTeam?.id === team.id ? (
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <Input
                              value={editingTeam.name}
                              onChange={(e) =>
                                setEditingTeam({
                                  ...editingTeam,
                                  name: e.target.value,
                                })
                              }
                              aria-label="Team name"
                              className={cn(
                                "h-8 text-sm min-w-0 flex-1 bg-background/50",
                                focusRing,
                              )}
                              autoFocus
                            />
                            <Button
                              size="sm"
                              className="h-8 px-2 shrink-0"
                              onClick={() => {
                                handleTeamRename(team.id, editingTeam.name);
                                setEditingTeam(null);
                              }}
                              disabled={
                                actionLoading === `team-rename-${team.id}`
                              }
                              aria-label="Save team name"
                            >
                              {actionLoading === `team-rename-${team.id}` ? (
                                <Loader2
                                  className="h-3 w-3 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Save className="h-3 w-3" aria-hidden="true" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 shrink-0"
                              onClick={() => setEditingTeam(null)}
                              aria-label="Cancel rename"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="min-w-0">
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
                          </>
                        )}
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
                          aria-label={`View members of ${team.name}`}
                        >
                          <Eye className="h-3 w-3 mr-1.5" aria-hidden="true" />{" "}
                          View Members
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0 border-border/40"
                          onClick={() =>
                            setEditingTeam({ id: team.id, name: team.name })
                          }
                          aria-label={`Rename ${team.name}`}
                        >
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                        </Button>
                        {perms.canDeleteUsers && (
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
                            aria-label={`Delete ${team.name}`}
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
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
                        // Pass s explicitly: the state update has not committed
                        // yet, so fetchTeams would still read the old size.
                        fetchTeams(1, undefined, s);
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
