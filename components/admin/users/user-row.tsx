"use client"

import { Eye, Ban, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { STAFF_ROLES, STAFF_ROLE_LABELS, ROLE_BADGE_STYLES } from "@/lib/constants"
import { UserAvatar } from "../shared/user-avatar"
import type { AdminUser } from "../types"

interface UserRowProps {
  user: AdminUser
  onSelect: () => void
  onAction: (action: string) => void
  onConfirmAction: (config: { title: string; description: string; confirmLabel: string; danger: boolean; action: () => Promise<void> }) => void
  actionLoading: string | null
  canDisable: boolean
}

export function UserRow({ user: u, onSelect, onAction, onConfirmAction, actionLoading, canDisable }: UserRowProps) {
  const isLoading = (action: string) => actionLoading === `${u.id}-${action}`

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
      <td className="px-5 py-3">
        <button
          onClick={onSelect}
          className="flex items-center gap-3 text-left hover:text-primary transition-colors"
        >
          <UserAvatar name={u.name} email={u.email} size="sm" avatarUrl={u.avatar_url} />
          <div className="min-w-0">
            <p className="font-medium text-foreground truncate max-w-[180px]">
              {u.name || "Unnamed"}
              {u.disabled_at && (
                <span className="ml-2 text-[10px] text-destructive">(Disabled)</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground truncate max-w-[180px]">{u.email}</p>
          </div>
        </button>
      </td>
      <td className="px-5 py-3">
        {u.role && u.role !== STAFF_ROLES.USER && ROLE_BADGE_STYLES[u.role] && (
          <Badge className={cn(ROLE_BADGE_STYLES[u.role], "text-[10px] px-2 py-0.5")}>
            {STAFF_ROLE_LABELS[u.role as keyof typeof STAFF_ROLE_LABELS] || u.role}
          </Badge>
        )}
      </td>
      <td className="px-5 py-3">
        {(() => {
          const effectivePlan = u.gifted_plan || u.plan
          if (!effectivePlan || effectivePlan === "free") return <span className="text-xs text-muted-foreground">Free</span>
          const label = effectivePlan.replace("_supporter", "").charAt(0).toUpperCase() + effectivePlan.replace("_supporter", "").slice(1)
          return (
            <Badge className={cn(
              "text-[10px] px-2 py-0.5",
              u.gifted_plan ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-primary/10 text-primary border-primary/20"
            )}>
              {label}{u.gifted_plan ? " (Gift)" : ""}
            </Badge>
          )
        })()}
      </td>
      <td className="px-5 py-3 text-center">
        <span className="text-sm font-medium">{u.scan_count.toLocaleString()}</span>
      </td>
      <td className="px-5 py-3">
        <span className="text-xs text-muted-foreground">
          {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </span>
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="View Details"
            onClick={onSelect}
          >
            <Eye className="h-4 w-4" />
          </Button>
          {canDisable && (
            u.disabled_at ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/10"
                title="Re-enable"
                onClick={() => onAction("enable")}
                disabled={isLoading("enable")}
              >
                {isLoading("enable") ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                title="Disable"
                onClick={() => onConfirmAction({
                  title: "Disable Account",
                  description: `Suspend ${u.email}? They will be logged out and unable to sign in.`,
                  confirmLabel: "Disable",
                  danger: true,
                  action: () => onAction("disable") as unknown as Promise<void>,
                })}
              >
                <Ban className="h-4 w-4" />
              </Button>
            )
          )}
        </div>
      </td>
    </tr>
  )
}
