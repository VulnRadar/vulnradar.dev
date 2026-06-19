"use client";

import { Plus, Search, Users, Eye, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/ui/utils";
import { type Team, ROLE_ICONS, ROLE_COLORS } from "./teams-types";

interface TeamsListProps {
  teams: Team[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenTeam: (team: Team) => void;
  onShowCreate: () => void;
  showCreate: boolean;
  newName: string;
  onNewNameChange: (v: string) => void;
  onCreate: () => void;
  onCancelCreate: () => void;
  creating: boolean;
}

export function TeamsList({
  teams,
  searchQuery,
  onSearchChange,
  onOpenTeam,
  onShowCreate,
  showCreate,
  newName,
  onNewNameChange,
  onCreate,
  onCancelCreate,
  creating,
}: TeamsListProps) {
  const filtered = teams.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
        <p className="text-sm text-muted-foreground">
          Collaborate with team members on security scans.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search teams..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button className="gap-1.5 shrink-0" onClick={onShowCreate}>
          <Plus className="h-4 w-4" />
          New Team
        </Button>
      </div>

      {showCreate && (
        <Card className="bg-card border-border/50">
          <CardContent className="p-5">
            <p className="text-sm font-medium mb-3">Create New Team</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="Team name"
                value={newName}
                onChange={(e) => onNewNameChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onCreate()}
                className="flex-1"
                autoFocus
                maxLength={50}
              />
              <div className="flex gap-2">
                <Button
                  onClick={onCreate}
                  disabled={creating || !newName.trim()}
                  className="h-10"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Create"
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="h-10"
                  onClick={onCancelCreate}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {filtered.length === 0 && !searchQuery ? (
        <Card className="bg-card border-border/50 border-dashed">
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">No teams yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Create a team to collaborate on security scans with others.
              </p>
            </div>
            <Button size="sm" onClick={onShowCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Create Your First Team
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No teams match &quot;{searchQuery}&quot;
          </p>
        </div>
      ) : (
        <Card className="bg-card border-border/50">
          <CardContent className="p-0">
            <div className="hidden sm:grid grid-cols-[1fr_100px_120px_32px] gap-4 px-5 py-3 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/30 rounded-t-xl">
              <span>Team</span>
              <span>Members</span>
              <span>Your Role</span>
              <span />
            </div>
            <div className="divide-y divide-border">
              {filtered.map((team) => {
                const Icon = ROLE_ICONS[team.role] || Eye;
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => onOpenTeam(team)}
                    className="group w-full flex items-center sm:grid sm:grid-cols-[1fr_100px_120px_32px] gap-4 px-5 py-4 hover:bg-muted/30 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {team.name}
                      </p>
                      <p className="text-xs text-muted-foreground sm:hidden">
                        {team.member_count} member
                        {team.member_count !== 1 && "s"}
                      </p>
                    </div>
                    <span className="hidden sm:block text-sm text-muted-foreground tabular-nums">
                      {team.member_count}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border shrink-0 w-fit",
                        ROLE_COLORS[team.role],
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      <span className="capitalize">{team.role}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
