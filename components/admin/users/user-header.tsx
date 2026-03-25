"use client"

import { Mail, Calendar, Hash, ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ROLE_BADGE_STYLES, STAFF_ROLE_LABELS } from "@/lib/constants"
import { UserAvatar } from "../shared/user-avatar"
import type { AdminUser } from "../types"

interface UserHeaderProps {
  user: AdminUser & { session_count?: number }
  onClose: () => void
  onAction: (action: string) => void
  actionLoading: string | null
  canDisable: boolean
}

export function UserHeader({ user: u, onClose, onAction, actionLoading, canDisable }: UserHeaderProps) {
  const isLoading = (action: string) => actionLoading === `${u.id}-${action}`

  // Get plan display
  const effectivePlan = u.gifted_plan || u.plan || "free"
  const planLabel = effectivePlan.replace("_supporter", "").charAt(0).toUpperCase() + effectivePlan.replace("_supporter", "").slice(1)

  return (
    <div className="flex items-start gap-4 flex-1">
      {/* Avatar */}
      <div className="relative">
        <UserAvatar
          name={u.name}
          email={u.email}
          size="lg"
          avatarUrl={u.avatar_url}
          className="shrink-0 ring-2 ring-border/50 ring-offset-2 ring-offset-card"
        />
        {u.disabled_at && (
          <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-destructive flex items-center justify-center ring-2 ring-card">
            <span className="text-[10px] text-destructive-foreground font-bold">!</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h2 className="text-lg font-bold text-foreground truncate">
            {u.name || "Unnamed User"}
          </h2>
          {u.disabled_at && (
            <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] font-semibold">
              Suspended
            </Badge>
          )}
          {u.role && u.role !== "user" && ROLE_BADGE_STYLES[u.role] && (
            <Badge className={cn(ROLE_BADGE_STYLES[u.role], "text-[10px] font-semibold")}>
              {STAFF_ROLE_LABELS[u.role as keyof typeof STAFF_ROLE_LABELS] || u.role}
            </Badge>
          )}
          {effectivePlan !== "free" && (
            <Badge className={cn(
              "text-[10px] font-semibold",
              u.gifted_plan 
                ? "bg-amber-500/10 text-amber-500 border-amber-500/20" 
                : "bg-primary/10 text-primary border-primary/20"
            )}>
              {planLabel}{u.gifted_plan ? " (Gift)" : ""}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" />
            {u.email}
          </span>
          <span className="flex items-center gap-1.5">
            <Hash className="h-3.5 w-3.5" />
            ID: {u.id}
          </span>
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            Joined {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-3">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 text-xs">
            <span className="font-semibold text-foreground">{u.scan_count.toLocaleString()}</span>
            <span className="text-muted-foreground">scans</span>
          </div>
          {u.totp_enabled && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 text-xs text-emerald-500">
              <span className="font-semibold">2FA</span>
              <span>enabled</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
