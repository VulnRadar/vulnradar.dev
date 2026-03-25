"use client"

import { 
  Eye, 
  KeyRound, 
  LogOut, 
  ShieldOff, 
  Trash2, 
  CalendarOff, 
  Webhook, 
  Download,
  Gift,
  Ban,
  CheckCircle2,
  ImageOff,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react"
import { useState } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AdminUser } from "../types"
import type { AdminAction } from "@/lib/permissions-client"

interface ActionConfig {
  id: AdminAction
  icon: React.ElementType
  label: string
  description: string
  variant: "default" | "warning" | "danger" | "success"
  requiresConfirm?: boolean
  confirmTitle?: string
  confirmDescription?: string
}

const QUICK_ACTIONS: ActionConfig[] = [
  { id: "impersonate", icon: Eye, label: "Impersonate", description: "Sign in as this user", variant: "warning" },
  { id: "reset_password", icon: KeyRound, label: "Reset Password", description: "Send password reset email", variant: "default" },
  { id: "revoke_sessions", icon: LogOut, label: "Revoke Sessions", description: "Log out all devices", variant: "warning" },
  { id: "clear_avatar", icon: ImageOff, label: "Clear Avatar", description: "Remove profile picture", variant: "default" },
  { id: "export_data", icon: Download, label: "Export Data", description: "Download user data", variant: "default" },
]

const DANGER_ACTIONS: ActionConfig[] = [
  { id: "reset_2fa", icon: ShieldOff, label: "Reset 2FA", description: "Disable two-factor auth", variant: "warning", requiresConfirm: true, confirmTitle: "Reset 2FA?", confirmDescription: "This will disable two-factor authentication for this user." },
  { id: "delete_scans", icon: Trash2, label: "Delete Scans", description: "Remove all scan history", variant: "danger", requiresConfirm: true, confirmTitle: "Delete All Scans?", confirmDescription: "This will permanently delete all scan history for this user." },
  { id: "delete_schedules", icon: CalendarOff, label: "Delete Schedules", description: "Remove all schedules", variant: "danger", requiresConfirm: true, confirmTitle: "Delete All Schedules?", confirmDescription: "This will permanently delete all scheduled scans for this user." },
  { id: "delete_webhooks", icon: Webhook, label: "Delete Webhooks", description: "Remove all webhooks", variant: "danger", requiresConfirm: true, confirmTitle: "Delete All Webhooks?", confirmDescription: "This will permanently delete all webhooks for this user." },
  { id: "delete", icon: Trash2, label: "Delete Account", description: "Permanently delete user", variant: "danger", requiresConfirm: true, confirmTitle: "Delete Account?", confirmDescription: "This will permanently delete this user and all their data. This cannot be undone." },
]

interface UserActionsProps {
  user: AdminUser
  onAction: (action: string, extra?: Record<string, unknown>) => Promise<void>
  onConfirmAction: (config: { title: string; description: string; confirmLabel: string; danger: boolean; action: () => Promise<void> }) => void
  actionLoading: string | null
  availableActions: AdminAction[]
}

export function UserActions({ 
  user: u, 
  onAction, 
  onConfirmAction,
  actionLoading,
  availableActions,
}: UserActionsProps) {
  const [dangerExpanded, setDangerExpanded] = useState(false)
  
  const isLoading = (action: string) => actionLoading === `${u.id}-${action}`
  const canAction = (action: AdminAction) => availableActions.includes(action)

  const handleAction = (config: ActionConfig) => {
    if (config.requiresConfirm) {
      onConfirmAction({
        title: config.confirmTitle || config.label,
        description: config.confirmDescription || `Are you sure you want to ${config.label.toLowerCase()}?`,
        confirmLabel: config.label,
        danger: config.variant === "danger",
        action: () => onAction(config.id),
      })
    } else {
      onAction(config.id)
    }
  }

  const getVariantStyles = (variant: string) => {
    switch (variant) {
      case "danger":
        return "border-destructive/30 hover:bg-destructive/10 hover:border-destructive/50"
      case "warning":
        return "border-amber-500/30 hover:bg-amber-500/10 hover:border-amber-500/50"
      case "success":
        return "border-emerald-500/30 hover:bg-emerald-500/10 hover:border-emerald-500/50"
      default:
        return "border-border hover:bg-muted/50 hover:border-border"
    }
  }

  const getIconStyles = (variant: string) => {
    switch (variant) {
      case "danger":
        return "bg-destructive/10 text-destructive"
      case "warning":
        return "bg-amber-500/10 text-amber-500"
      case "success":
        return "bg-emerald-500/10 text-emerald-500"
      default:
        return "bg-muted text-muted-foreground"
    }
  }

  const quickActionsFiltered = QUICK_ACTIONS.filter(a => canAction(a.id))
  const dangerActionsFiltered = DANGER_ACTIONS.filter(a => canAction(a.id))

  return (
    <div className="space-y-4">
      {/* Account Status */}
      {(canAction("disable") || canAction("enable")) && (
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Account Status</p>
                <p className="text-xs text-muted-foreground">
                  {u.disabled_at ? "This account is currently disabled" : "This account is active"}
                </p>
              </div>
              {u.disabled_at ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
                  onClick={() => onAction("enable")}
                  disabled={isLoading("enable")}
                >
                  {isLoading("enable") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Re-enable Account
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => onConfirmAction({
                    title: "Disable Account",
                    description: `This will suspend ${u.email}. They will be logged out and unable to sign in.`,
                    confirmLabel: "Disable Account",
                    danger: true,
                    action: () => onAction("disable"),
                  })}
                  disabled={isLoading("disable")}
                >
                  {isLoading("disable") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                  Disable Account
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      {quickActionsFiltered.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-0 pt-4 px-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick Actions</p>
          </CardHeader>
          <CardContent className="p-4 pt-3">
            <div className="grid grid-cols-2 gap-2">
              {quickActionsFiltered.map((action) => (
                <button
                  key={action.id}
                  onClick={() => handleAction(action)}
                  disabled={isLoading(action.id)}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                    getVariantStyles(action.variant),
                    isLoading(action.id) && "opacity-50 pointer-events-none"
                  )}
                >
                  <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", getIconStyles(action.variant))}>
                    {isLoading(action.id) ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <action.icon className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">{action.label}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{action.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Gift Subscription */}
      {canAction("gift_subscription") && (
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <button
              onClick={() => onAction("gift_subscription")}
              disabled={isLoading("gift_subscription")}
              className="flex items-center gap-3 w-full p-3 rounded-lg border border-amber-500/30 hover:bg-amber-500/10 hover:border-amber-500/50 transition-all text-left"
            >
              <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-amber-500/10 text-amber-500">
                {isLoading("gift_subscription") ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Gift className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">Gift Subscription</p>
                <p className="text-[10px] text-muted-foreground">
                  {u.gifted_plan ? `Currently gifted: ${u.gifted_plan}` : "Grant a free subscription"}
                </p>
              </div>
            </button>
          </CardContent>
        </Card>
      )}

      {/* Danger Zone */}
      {dangerActionsFiltered.length > 0 && (
        <Card className="bg-card border-destructive/30">
          <CardHeader className="pb-0 pt-4 px-4">
            <button
              onClick={() => setDangerExpanded(!dangerExpanded)}
              className="flex items-center justify-between w-full"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <p className="text-xs font-semibold text-destructive uppercase tracking-wider">Danger Zone</p>
              </div>
              {dangerExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </CardHeader>
          {dangerExpanded && (
            <CardContent className="p-4 pt-3">
              <div className="grid grid-cols-2 gap-2">
                {dangerActionsFiltered.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => handleAction(action)}
                    disabled={isLoading(action.id)}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                      getVariantStyles(action.variant),
                      isLoading(action.id) && "opacity-50 pointer-events-none"
                    )}
                  >
                    <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", getIconStyles(action.variant))}>
                      {isLoading(action.id) ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <action.icon className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">{action.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{action.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}
