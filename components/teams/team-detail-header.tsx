"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Crown,
  Pencil,
  UserPlus,
  MoreHorizontal,
  Trash2,
  LogOut,
} from "lucide-react";
import { type EditSaveOutcome } from "@/components/shared/edit-dialog";
import { Button } from "@/components/ui/button";
import { pluralize } from "@/lib/ui/plural";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hasTeamPermission } from "@/lib/config/client-constants";
import { type Member, type Team } from "./teams-types";
import { RolePill } from "./role-pill";
import { TeamAvatar } from "./team-avatar";
import { TeamAvatarPicker } from "./team-avatar-picker";
import { RenameTeamDialog } from "./rename-team-dialog";
import { TransferOwnershipDialog } from "./transfer-ownership-dialog";

interface TeamDetailHeaderProps {
  team: Team;
  currentRole: string;
  memberCount: number;
  onBack: () => void;
  /** Throws an Error carrying the reason when the rename is refused. */
  onRename: (name: string) => Promise<void>;
  onInvite: () => void;
  onDelete: () => void;
  onLeave: () => void;
  /** The team's picture changed: the new URL, or null when it was cleared. */
  onAvatarChange: (avatarUrl: string | null) => void;
  onAvatarError: (message: string) => void;
  /** The roster, for picking who a transfer of ownership goes to. */
  members?: readonly Member[];
  /** Hand the team to this member (PATCH /api/v3/teams { teamId,
   *  newOwnerId }). Throws, or returns { ok: false, error }, with the reason
   *  when it is refused. Without it the owner's menu has no transfer item. */
  onTransferOwnership?: (
    newOwnerId: number,
  ) => EditSaveOutcome | Promise<EditSaveOutcome>;
}

export function TeamDetailHeader({
  team,
  currentRole,
  memberCount,
  onBack,
  onRename,
  onInvite,
  onDelete,
  onLeave,
  onAvatarChange,
  onAvatarError,
  members = [],
  onTransferOwnership,
}: TeamDetailHeaderProps) {
  const [renaming, setRenaming] = useState(false);
  const [transferring, setTransferring] = useState(false);
  // "delete_team" is the owner's alone, and so is handing the team on: both
  // decide who answers for it. The route checks the same thing.
  const isOwner = hasTeamPermission(currentRole, "delete_team");
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
        <ArrowLeft className="h-4 w-4" />
        Back to teams
      </button>

      {/* rounded-xl, the page-panel rung. Every panel on this page used the
          Card primitive, which is rounded-lg, so /teams drew its page panels
          one rung below the identical panels on /shares and /history. */}
      <div className="rounded-xl border border-border bg-card p-5">
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
                    onClick={() => setRenaming(true)}
                    aria-label="Rename team"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-auto sm:w-auto sm:p-1.5"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
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
                onClick={onInvite}
                aria-label="Invite people"
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
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
              <DropdownMenuContent align="end" className="w-52">
                {isOwner && onTransferOwnership && (
                  <DropdownMenuItem onClick={() => setTransferring(true)}>
                    <Crown className="h-4 w-4 mr-2" aria-hidden="true" />
                    Transfer ownership
                  </DropdownMenuItem>
                )}
                {isOwner ? (
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

      {renaming && (
        <RenameTeamDialog
          team={team}
          onRename={onRename}
          onClose={() => setRenaming(false)}
        />
      )}

      {transferring && isOwner && onTransferOwnership && (
        <TransferOwnershipDialog
          team={team}
          members={members}
          onTransfer={onTransferOwnership}
          onClose={() => setTransferring(false)}
        />
      )}
    </>
  );
}
