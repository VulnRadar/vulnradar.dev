"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Eye,
  MoreHorizontal,
  ShieldCheck,
  X,
  Trash2,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EditDialog } from "@/components/shared/edit-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/ui/utils";
import { formatDate } from "@/lib/ui/format-date";
import {
  TEAM_ROLES,
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
  hasTeamPermission,
  canAssignTeamRole,
} from "@/lib/config/client-constants";
import {
  type Member,
  type Invite,
  ROLE_ICONS,
  ROLE_ABILITIES,
  ROLE_ORDER,
  INVITABLE_ROLES,
} from "./teams-types";
import { RolePill } from "./role-pill";

/** A role change is not cosmetic: it moves what somebody else can do. */
const ROLE_CHANGE_EFFECT =
  "That changes what they can do with this team's scans straight away.";

/** Save is for picking a different role the viewer may actually grant. */
export function canSaveRoleChange(
  current: string,
  picked: string,
  assignableRoles: readonly string[],
): boolean {
  return picked !== current && assignableRoles.includes(picked);
}

export function roleChangeDescription(
  label: string,
  current: string,
  picked: string,
): string {
  return picked === current
    ? `Choose a new role for ${label}. ${ROLE_CHANGE_EFFECT}`
    : `${label} becomes ${picked}. ${ROLE_CHANGE_EFFECT}`;
}

export function ChangeRoleDialog({
  member,
  assignableRoles,
  onChangeRole,
  onClose,
}: {
  member: Member;
  assignableRoles: readonly string[];
  /** Resolves once the role changed and throws an Error carrying the reason
   *  when it did not: the dialog shows that message and stays open. */
  onChangeRole: (userId: number, role: string) => void | Promise<void>;
  onClose: () => void;
}) {
  // Mounted only while open, so it always starts on the member's saved role.
  const [role, setRole] = useState(member.role);
  const label = member.name || member.email;

  return (
    <EditDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Change role"
      description={roleChangeDescription(label, member.role, role)}
      size="sm"
      dirty={role !== member.role}
      canSave={canSaveRoleChange(member.role, role, assignableRoles)}
      saveLabel="Change role"
      onSave={() => onChangeRole(member.user_id, role)}
    >
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="sr-only">Role for {label}</legend>
        {assignableRoles.map((r) => {
          const RoleIcon = ROLE_ICONS[r] || Eye;
          const checked = role === r;
          return (
            <label
              key={r}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                checked
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50",
              )}
            >
              <input
                type="radio"
                name="member-role"
                value={r}
                checked={checked}
                onChange={() => setRole(r)}
                autoFocus={r === member.role}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium capitalize text-foreground">
                  <RoleIcon
                    className="h-3.5 w-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  {r}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {ROLE_ABILITIES[r]}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </EditDialog>
  );
}

interface TeamMembersListProps {
  members: Member[];
  invites: Invite[];
  loading: boolean;
  /** Set when the members request failed. A team always contains at least its
   *  owner, so an empty list is not a state real data can produce: without
   *  this the card renders "Members 0" over a blank div and looks authoritative. */
  loadError?: string | null;
  currentRole: string;
  /** The viewer's own user id, so their own row does not offer a role change
   *  that PATCH /api/v3/teams/members refuses ("You can't change your own
   *  role."). Optional: without it the option is still offered and the API is
   *  still the one saying no. */
  currentUserId?: number;
  onViewScans: (member: Member) => void;
  onRemoveMember: (userId: number) => void;
  onCancelInvite: (inviteId: number) => void;
  /** Change a teammate's role. PATCH /api/v3/teams/members has always
   *  supported this (with its own ceiling and self-demotion guards) but had no
   *  caller, so the only way to change a role was to remove the person and
   *  re-invite them, which destroys their team scans' association on the way
   *  through (AUDIT-011#drift-21). Optional so the list still renders in any
   *  context that has nothing to wire it to. */
  onChangeRole?: (userId: number, role: string) => void | Promise<void>;
}

export function TeamMembersList({
  members,
  invites,
  loading,
  loadError = null,
  currentRole,
  currentUserId,
  onViewScans,
  onRemoveMember,
  onCancelInvite,
  onChangeRole,
}: TeamMembersListProps) {
  const [roleTarget, setRoleTarget] = useState<Member | null>(null);
  const canManage = hasTeamPermission(currentRole, "manage_members");
  // Only the roles this viewer may actually grant. The team roles are a
  // partial order rather than a ladder, so this is the same subset relation
  // the API enforces (canAssignTeamRole), not a rank comparison: offering a
  // role the caller cannot assign would just produce a 403 on click.
  const assignableRoles = INVITABLE_ROLES.filter((r) =>
    canAssignTeamRole(currentRole, r),
  );

  return (
    <>
      {/* Members */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* No count on the right. The header directly above this card already
            says "4 members" in words, so the bare digit here was the same fact
            twice within about forty pixels, and it was wrong while the request
            was still in flight: members is empty during loading, so it printed
            a confident "0" over a card full of skeletons. */}
        <div className="px-5 py-4 border-b border-border">
          <p className="text-sm font-medium">Members</p>
        </div>

        {loading ? (
          <div
            className="divide-y divide-border"
            role="status"
            aria-live="polite"
            aria-label="Loading members"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <Skeleton className="w-9 h-9 rounded-full shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full shrink-0" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="px-5 py-10 text-center" role="alert">
            <p className="text-sm text-destructive">{loadError}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {members.map((m) => {
              return (
                <div
                  key={m.user_id}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors group"
                >
                  {m.avatar_url ? (
                    <Image
                      src={m.avatar_url}
                      alt=""
                      width={36}
                      height={36}
                      loading="lazy"
                      className="w-9 h-9 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="flex items-center justify-center w-9 h-9 rounded-full bg-muted shrink-0">
                      <span className="text-sm font-medium">
                        {(m.name || m.email)[0].toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">
                        {m.name || m.email}
                      </p>
                      {m.staff_role &&
                        m.staff_role !== STAFF_ROLES.USER &&
                        ROLE_BADGE_STYLES[m.staff_role] && (
                          <span
                            className={cn(
                              "inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wider border shrink-0",
                              ROLE_BADGE_STYLES[m.staff_role],
                            )}
                          >
                            {STAFF_ROLE_LABELS[m.staff_role] || m.staff_role}
                          </span>
                        )}
                    </div>
                    {/* Only when there is a real name above it. A member
                          with no name on file used to render the placeholder
                          "Unnamed" over their own address; now the address is
                          the name, and printing it twice would say nothing. */}
                    {m.name && (
                      <p className="text-xs text-muted-foreground truncate font-mono">
                        {m.email}
                      </p>
                    )}
                  </div>

                  <RolePill role={m.role} />

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        // This menu is the only route to removing a member,
                        // and opacity-0 until hover is a state a touch
                        // device never reaches: on a phone the control was
                        // invisible and unreachable. Hover-gate it from sm
                        // up only, and give it a real 44px target below that.
                        className="h-11 w-11 sm:h-8 sm:w-8 p-0 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 transition-opacity"
                        aria-label={`Actions for ${m.name || m.email}`}
                      >
                        <MoreHorizontal
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => onViewScans(m)}>
                        <Eye className="h-4 w-4 mr-2" />
                        View scans
                      </DropdownMenuItem>
                      {canManage &&
                        m.role !== TEAM_ROLES.OWNER &&
                        onChangeRole &&
                        m.user_id !== currentUserId &&
                        // The ceiling applies to the CURRENT role too: a
                        // manager must not be able to demote an admin it
                        // cannot itself assign. Same both-directions check
                        // the API makes before it writes.
                        canAssignTeamRole(currentRole, m.role) &&
                        assignableRoles.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              // A frame late: the menu hands focus back to
                              // this row's Actions button as it closes, and
                              // the dialog records its opener when it mounts.
                              onSelect={() =>
                                requestAnimationFrame(() => setRoleTarget(m))
                              }
                            >
                              <ShieldCheck
                                className="h-4 w-4 mr-2"
                                aria-hidden="true"
                              />
                              Change role...
                            </DropdownMenuItem>
                          </>
                        )}
                      {canManage && m.role !== TEAM_ROLES.OWNER && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => onRemoveMember(m.user_id)}
                          >
                            <X className="h-4 w-4 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}

        {/* What each role can do, next to the people who hold it. */}
        {!loading && members.length > 0 && (
          <div className="border-t border-border/50 px-5 py-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              What the roles mean
            </p>
            <dl className="flex flex-col gap-1.5">
              {ROLE_ORDER.filter((r) => members.some((m) => m.role === r)).map(
                (role) => {
                  const Icon = ROLE_ICONS[role] || Eye;
                  return (
                    <div
                      key={role}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
                    >
                      <dt className="flex items-center gap-1.5 font-medium text-foreground capitalize shrink-0">
                        <Icon
                          className="h-3 w-3 text-muted-foreground"
                          aria-hidden="true"
                        />
                        {role}
                      </dt>
                      <dd className="text-muted-foreground">
                        {ROLE_ABILITIES[role]}
                      </dd>
                    </div>
                  );
                },
              )}
            </dl>
          </div>
        )}
      </div>

      {roleTarget && onChangeRole && (
        <ChangeRoleDialog
          member={roleTarget}
          assignableRoles={assignableRoles}
          onChangeRole={onChangeRole}
          onClose={() => setRoleTarget(null)}
        />
      )}

      {/* Pending invites */}
      {invites.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <p className="text-sm font-medium">Pending invites</p>
            <span className="text-xs text-muted-foreground tabular-nums">
              {invites.length}
            </span>
          </div>
          <div className="divide-y divide-border">
            {invites.map((inv) => {
              return (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center justify-center w-9 h-9 rounded-full bg-muted/50 shrink-0">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-muted-foreground truncate font-mono">
                      {inv.email}
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      Expires {formatDate(inv.expires_at)}
                    </p>
                  </div>
                  <RolePill role={inv.role} />
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11 w-11 sm:h-8 sm:w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => onCancelInvite(inv.id)}
                      aria-label={`Cancel the invite to ${inv.email}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
