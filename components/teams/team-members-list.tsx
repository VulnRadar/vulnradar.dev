"use client"

import { Eye, Loader2, MoreHorizontal, X, Trash2, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/ui/utils"
import { TEAM_ROLES, STAFF_ROLES, STAFF_ROLE_LABELS, ROLE_BADGE_STYLES } from "@/lib/config/constants"
import { type Member, type Invite, ROLE_ICONS, ROLE_COLORS } from "./teams-types"

interface TeamMembersListProps {
  members: Member[]
  invites: Invite[]
  loading: boolean
  currentRole: string
  onViewScans: (member: Member) => void
  onRemoveMember: (userId: number) => void
  onCancelInvite: (inviteId: number) => void
}

export function TeamMembersList({
  members, invites, loading, currentRole,
  onViewScans, onRemoveMember, onCancelInvite,
}: TeamMembersListProps) {
  const canManage = currentRole === TEAM_ROLES.OWNER || currentRole === TEAM_ROLES.ADMIN

  return (
    <>
      {/* Members */}
      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <p className="text-sm font-medium">Members</p>
            <span className="text-xs text-muted-foreground tabular-nums">{members.length}</span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-12 justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading members...</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {members.map((m) => {
                const Icon = ROLE_ICONS[m.role] || Eye
                return (
                  <div
                    key={m.user_id}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors group"
                  >
                    {m.avatar_url ? (
                      <img
                        src={m.avatar_url}
                        alt=""
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
                        <p className="text-sm font-medium truncate">{m.name || "Unnamed"}</p>
                        {m.staff_role && m.staff_role !== STAFF_ROLES.USER && ROLE_BADGE_STYLES[m.staff_role] && (
                          <span className={cn(
                            "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border shrink-0",
                            ROLE_BADGE_STYLES[m.staff_role]
                          )}>
                            {STAFF_ROLE_LABELS[m.staff_role] || m.staff_role}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                    </div>

                    <span className={cn(
                      "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border shrink-0",
                      ROLE_COLORS[m.role]
                    )}>
                      <Icon className="h-3 w-3" />
                      <span className="capitalize">{m.role}</span>
                    </span>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => onViewScans(m)}>
                          <Eye className="h-4 w-4 mr-2" />View Scans
                        </DropdownMenuItem>
                        {canManage && m.role !== TEAM_ROLES.OWNER && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => onRemoveMember(m.user_id)}
                            >
                              <X className="h-4 w-4 mr-2" />Remove
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })}
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
              <span className="text-xs text-muted-foreground tabular-nums">{invites.length}</span>
            </div>
            <div className="divide-y divide-border">
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-center w-9 h-9 rounded-full bg-muted/50 shrink-0">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-muted-foreground truncate">{inv.email}</p>
                    <p className="text-xs text-muted-foreground/70">
                      Expires {new Date(inv.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={cn(
                    "text-xs font-medium px-2.5 py-1 rounded-full border capitalize shrink-0",
                    ROLE_COLORS[inv.role]
                  )}>
                    {inv.role}
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => onCancelInvite(inv.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
