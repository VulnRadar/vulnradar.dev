"use client";

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
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/ui/utils";
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
  ROLE_COLORS,
  ROLE_ABILITIES,
  ROLE_ORDER,
  INVITABLE_ROLES,
} from "./teams-types";

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
  onChangeRole?: (userId: number, role: string) => void;
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
      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <p className="text-sm font-medium">Members</p>
            <span className="text-xs text-muted-foreground tabular-nums">
              {loadError ? "" : members.length}
            </span>
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
                const Icon = ROLE_ICONS[m.role] || Eye;
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
                          {m.name || "Unnamed"}
                        </p>
                        {m.staff_role &&
                          m.staff_role !== STAFF_ROLES.USER &&
                          ROLE_BADGE_STYLES[m.staff_role] && (
                            <span
                              className={cn(
                                "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border shrink-0",
                                ROLE_BADGE_STYLES[m.staff_role],
                              )}
                            >
                              {STAFF_ROLE_LABELS[m.staff_role] || m.staff_role}
                            </span>
                          )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate font-mono">
                        {m.email}
                      </p>
                    </div>

                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border shrink-0",
                        ROLE_COLORS[m.role],
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      <span className="capitalize">{m.role}</span>
                    </span>

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
                          View Scans
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
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  <ShieldCheck
                                    className="h-4 w-4 mr-2"
                                    aria-hidden="true"
                                  />
                                  Change role
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="w-40">
                                  <DropdownMenuRadioGroup
                                    value={m.role}
                                    onValueChange={(role) => {
                                      if (role !== m.role)
                                        onChangeRole(m.user_id, role);
                                    }}
                                  >
                                    {assignableRoles.map((role) => {
                                      const RoleIcon = ROLE_ICONS[role] || Eye;
                                      return (
                                        <DropdownMenuRadioItem
                                          key={role}
                                          value={role}
                                          className="capitalize"
                                        >
                                          <RoleIcon
                                            className="h-3.5 w-3.5 mr-2 text-muted-foreground"
                                            aria-hidden="true"
                                          />
                                          {role}
                                        </DropdownMenuRadioItem>
                                      );
                                    })}
                                  </DropdownMenuRadioGroup>
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
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
                {ROLE_ORDER.filter((r) =>
                  members.some((m) => m.role === r),
                ).map((role) => {
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
                })}
              </dl>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending invites */}
      {invites.length > 0 && (
        <Card className="bg-card border-border/50">
          <CardContent className="p-0">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <p className="text-sm font-medium">Pending Invites</p>
              <span className="text-xs text-muted-foreground tabular-nums">
                {invites.length}
              </span>
            </div>
            <div className="divide-y divide-border">
              {invites.map((inv) => {
                const InviteIcon = ROLE_ICONS[inv.role] || Eye;
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
                        Expires {new Date(inv.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border capitalize shrink-0",
                        ROLE_COLORS[inv.role],
                      )}
                    >
                      <InviteIcon className="h-3 w-3" />
                      {inv.role}
                    </span>
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
          </CardContent>
        </Card>
      )}
    </>
  );
}
