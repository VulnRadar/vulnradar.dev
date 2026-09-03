"use client";

import {
  ArrowLeft,
  Pencil,
  UserPlus,
  MoreHorizontal,
  Trash2,
  LogOut,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pluralize } from "@/lib/ui/plural";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hasTeamPermission } from "@/lib/config/client-constants";
import { type Team } from "./teams-types";
import { RolePill } from "./role-pill";
import { TeamAvatar } from "./team-avatar";
import { TeamAvatarPicker } from "./team-avatar-picker";

interface TeamDetailHeaderProps {
  team: Team;
  currentRole: string;
  memberCount: number;
  editingName: boolean;
  nameInput: string;
  savingName: boolean;
  onBack: () => void;
  onEditName: () => void;
  onNameInputChange: (v: string) => void;
  onSaveName: () => void;
  onCancelEdit: () => void;
  onToggleInvite: () => void;
  onDelete: () => void;
  onLeave: () => void;
  /** The team's picture changed: the new URL, or null when it was cleared. */
  onAvatarChange: (avatarUrl: string | null) => void;
  onAvatarError: (message: string) => void;
}

export function TeamDetailHeader({
  team,
  currentRole,
  memberCount,
  editingName,
  nameInput,
  savingName,
  onBack,
  onEditName,
  onNameInputChange,
  onSaveName,
  onCancelEdit,
  onToggleInvite,
  onDelete,
  onLeave,
  onAvatarChange,
  onAvatarError,
}: TeamDetailHeaderProps) {
  // "manage_team" is the rename permission, and the picture rides with it: both
  // change how the team presents itself to everyone in it. PATCH /api/v3/teams
  // enforces the same check, so hiding the control here is presentation, not
  // the gate.
  const canRename = hasTeamPermission(currentRole, "manage_team");
  const canInvite = hasTeamPermission(currentRole, "manage_members");

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="group inline-flex w-fit items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        Back to teams
      </button>

      {/* rounded-xl, the page-panel rung. Every panel on this page used the
          Card primitive, which is rounded-lg, so /teams drew its page panels
          one rung below the identical panels on /shares and /history. */}
      <div className="rounded-xl border border-border/50 bg-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* The team's own face, alongside its name. Teams already showed an
              avatar in the list (the owner's) with nowhere to set one; this is
              where it gets set, by the same people who can rename the team. */}
          <div className="flex flex-1 min-w-0 items-center gap-4">
            {canRename ? (
              <TeamAvatarPicker
                team={team}
                onChange={onAvatarChange}
                onError={onAvatarError}
              />
            ) : (
              <TeamAvatar
                name={team.name}
                avatarUrl={team.avatar_url}
                size={48}
                className="border border-border"
              />
            )}
            <div className="min-w-0 flex-1">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={nameInput}
                    onChange={(e) => onNameInputChange(e.target.value)}
                    aria-label="Team name"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSaveName();
                      if (e.key === "Escape") onCancelEdit();
                    }}
                    className="h-9 text-base font-semibold w-48 sm:w-64"
                    autoFocus
                    maxLength={50}
                  />
                  <Button
                    size="sm"
                    className="h-11 w-11 sm:h-9 sm:w-9 p-0"
                    onClick={onSaveName}
                    disabled={savingName}
                    aria-label="Save team name"
                  >
                    {savingName ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11 w-11 sm:h-9 sm:w-9 p-0"
                    onClick={onCancelEdit}
                    aria-label="Cancel renaming"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {/* h1, not h2: opening a team replaces the list, so this is
                      the only page title on the detail view. It was an h2, so
                      the whole detail branch shipped with no h1 at all and
                      the title shrank from the list's Tier B when you drilled
                      in. Tier B is the in-app sub-page scale. */}
                  <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground truncate">
                    {team.name}
                  </h1>
                  {canRename && (
                    <button
                      type="button"
                      onClick={onEditName}
                      aria-label="Rename team"
                      className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-muted shrink-0"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
              {/* currentRole is "" until the members request resolves, and
                  stays "" if it fails. Printing "0 members · Your role: " with
                  a blank role states two things as fact that are not known
                  yet, so the line waits for the real values instead. The card
                  below is what reports loading or failure. */}
              {currentRole && (
                <p className="text-sm text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{pluralize(memberCount, "member")}</span>
                  <span aria-hidden="true">·</span>
                  <span>You are</span>
                  <RolePill role={currentRole} size="sm" />
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {canInvite && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={onToggleInvite}
              >
                <UserPlus className="h-4 w-4" />
                <span className="hidden sm:inline">Invite</span>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 w-11 sm:h-9 sm:w-9 p-0"
                  aria-label="Team actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {hasTeamPermission(currentRole, "delete_team") ? (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={onDelete}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete team
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={onLeave}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Leave team
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </>
  );
}
