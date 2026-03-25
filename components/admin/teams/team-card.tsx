"use client"

import { Users, Mail, Clock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { UserAvatar } from "../shared/user-avatar"
import { formatDate } from "../utils"
import type { TeamWithMembers } from "../types"

interface TeamCardProps {
  team: TeamWithMembers
  onClick?: () => void
  className?: string
}

export function TeamCard({ team, onClick, className }: TeamCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-start gap-4 p-4 rounded-xl border border-border bg-card hover:bg-muted/30 hover:border-border/80 transition-all text-left w-full",
        className
      )}
    >
      {/* Team Icon */}
      <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Users className="h-6 w-6 text-primary" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{team.name}</h3>
            <p className="text-xs text-muted-foreground truncate">/{team.slug}</p>
          </div>
          <Badge className="bg-muted text-muted-foreground border-border text-[10px] shrink-0">
            {team.member_count} members
          </Badge>
        </div>

        {/* Owner */}
        <div className="flex items-center gap-2 mt-3">
          <UserAvatar
            name={team.owner_name}
            email={team.owner_email}
            size="xs"
            avatarUrl={team.owner_avatar}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground truncate">
              Owner: {team.owner_name || team.owner_email.split("@")[0]}
            </p>
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDate(team.created_at)}
          </span>
          {team.pending_invites > 0 && (
            <span className="flex items-center gap-1 text-amber-500">
              <Mail className="h-3 w-3" />
              {team.pending_invites} pending
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
