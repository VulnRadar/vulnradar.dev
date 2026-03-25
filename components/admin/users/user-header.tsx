"use client"

import { ArrowLeft, X, Ban, CheckCircle2, Loader2 } from "lucide-react"
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

  return (
    <div className="flex items-start gap-4 p-5 border-b border-border bg-gradient-to-b from-muted/30 to-transparent">
      {/* Back button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 -ml-1"
        onClick={onClose}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>

      {/* Avatar */}
      <UserAvatar
        name={u.name}
        email={u.email}
        size="lg"
        avatarUrl={u.avatar_url}
        className="shrink-0"
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-semibold text-foreground truncate">
            {u.name || "Unnamed User"}
          </h2>
          {u.disabled_at && (
            <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px]">
              Disabled
            </Badge>
          )}
          {u.role && u.role !== "user" && ROLE_BADGE_STYLES[u.role] && (
            <Badge className={cn(ROLE_BADGE_STYLES[u.role], "text-[10px]")}>
              {STAFF_ROLE_LABELS[u.role as keyof typeof STAFF_ROLE_LABELS] || u.role}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground truncate">{u.email}</p>
        <p className="text-xs text-muted-foreground mt-1">
          User ID: {u.id}
        </p>
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {canDisable && (
          u.disabled_at ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
              onClick={() => onAction("enable")}
              disabled={isLoading("enable")}
            >
              {isLoading("enable") ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Re-enable
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => onAction("disable")}
              disabled={isLoading("disable")}
            >
              {isLoading("disable") ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Ban className="h-3.5 w-3.5" />
              )}
              Disable
            </Button>
          )
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
