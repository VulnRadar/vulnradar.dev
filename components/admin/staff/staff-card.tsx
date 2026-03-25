"use client"

import { ShieldCheck, Clock, Activity, Globe } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ROLE_BADGE_STYLES, STAFF_ROLE_LABELS } from "@/lib/constants"
import { UserAvatar } from "../shared/user-avatar"
import { formatRelativeTime } from "../utils"
import type { ActiveAdmin } from "../types"

interface StaffCardProps {
  staff: ActiveAdmin
  onClick?: () => void
  className?: string
}

export function StaffCard({ staff, onClick, className }: StaffCardProps) {
  const isOnline = staff.is_active && staff.seconds_since_heartbeat !== undefined && staff.seconds_since_heartbeat < 120

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-start gap-4 p-4 rounded-xl border border-border bg-card hover:bg-muted/30 hover:border-border/80 transition-all text-left w-full",
        className
      )}
    >
      {/* Avatar with status */}
      <div className="relative">
        <UserAvatar
          name={staff.name}
          email={staff.email}
          size="md"
          avatarUrl={staff.avatar_url}
        />
        {isOnline && (
          <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-card" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {staff.name || staff.email.split("@")[0]}
            </h3>
            <p className="text-xs text-muted-foreground truncate">{staff.email}</p>
          </div>
          {staff.role && ROLE_BADGE_STYLES[staff.role] && (
            <Badge className={cn(ROLE_BADGE_STYLES[staff.role], "text-[10px] shrink-0")}>
              {STAFF_ROLE_LABELS[staff.role as keyof typeof STAFF_ROLE_LABELS] || staff.role}
            </Badge>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {/* Status */}
          <span className={cn(
            "flex items-center gap-1 text-[10px] font-medium",
            isOnline ? "text-emerald-500" : "text-muted-foreground"
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              isOnline ? "bg-emerald-500" : "bg-muted-foreground/50"
            )} />
            {isOnline 
              ? staff.current_section ? `Active in ${staff.current_section}` : "Online" 
              : "Offline"
            }
          </span>

          {/* Last action */}
          {staff.last_admin_action && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Activity className="h-3 w-3" />
              {formatRelativeTime(new Date(staff.last_admin_action))}
            </span>
          )}

          {/* Actions count */}
          {staff.actions_24h > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {staff.actions_24h} actions (24h)
            </span>
          )}
        </div>

        {/* Security badges */}
        <div className="flex items-center gap-2 mt-2">
          <div className={cn(
            "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border",
            staff.totp_enabled 
              ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-500" 
              : "bg-muted/50 border-border text-muted-foreground"
          )}>
            <ShieldCheck className="h-3 w-3" />
            {staff.totp_enabled ? "2FA" : "No 2FA"}
          </div>
          {staff.active_sessions > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Globe className="h-3 w-3" />
              {staff.active_sessions} sessions
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
