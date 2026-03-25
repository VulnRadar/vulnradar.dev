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
  Zap,
} from "lucide-react"
import { useState } from "react"
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
  { id: "reset_password", icon: KeyRound, label: "Reset Password", description: "Send password reset email", variant: "default", requiresConfirm: true, confirmTitle: "Reset Password?", confirmDescription: "This will send a password reset email to the user." },
  { id: "revoke_sessions", icon: LogOut, label: "Revoke Sessions", description: "Log out all devices", variant: "warning", requiresConfirm: true, confirmTitle: "Revoke All Sessions?", confirmDescription: "This will log the user out of all devices." },
  { id: "clear_avatar", icon: ImageOff, label: "Clear Avatar", description: "Remove profile picture", variant: "default" },
  { id: "clear_rate_limits", icon: Zap, label: "Clear Rate Limits", description: "Reset API rate limits", variant: "default" },
  { id: "export_data", icon: Download, label: "Export Data", description: "Download user data", variant: "default" },
]

const DANGER_ACTIONS: ActionConfig[] = [
  { id: "reset_2fa", icon: ShieldOff, label: "Reset 2FA", description: "Disable two-factor auth", variant: "warning", requiresConfirm: true, confirmTitle: "Reset 2FA?", confirmDescription: "This will disable two-factor authentication for this user. They will need to set it up again." },
  { id: "delete_scans", icon: Trash2, label: "Delete Scans", description: "Remove all scan history", variant: "danger", requiresConfirm: true, confirmTitle: "Delete All Scans?", confirmDescription: "This will permanently delete all scan history for this user. This cannot be undone." },
  { id: "delete_schedules", icon: CalendarOff, label: "Delete Schedules", description: "Remove all schedules", variant: "danger", requiresConfirm: true, confirmTitle: "Delete All Schedules?", confirmDescription: "This will permanently delete all scheduled scans for this user." },
  { id: "delete_webhooks", icon: Webhook, label: "Delete Webhooks", description: "Remove all webhooks", variant: "danger", requiresConfirm: true, confirmTitle: "Delete All Webhooks?", confirmDescription: "This will permanently delete all webhooks for this user." },
  { id: "delete", icon: Trash2, label: "Delete Account", description: "Permanently delete user", variant: "danger", requiresConfirm: true, confirmTitle: "Delete Account?", confirmDescription: "This will permanently delete this user and all their data. This action cannot be undone." },
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

  const handleAction = async (config: ActionConfig) => {
    if (config.requiresConfirm) {
      onConfirmAction({
        title: config.confirmTitle || config.label,
        description: config.confirmDescription || `Are you sure you want to ${config.label.toLowerCase()}?`,
        confirmLabel: config.label,
        danger: config.variant === "danger",
        action: async () => {
          await onAction(config.id)
        },
      })
    } else {
      await onAction(config.id)
    }
  }

  const getVariantStyles = (variant: string, isHover = false) => {
    const base = "border rounded-xl transition-all duration-200"
    switch (variant) {
      case "danger":
        return cn(base, "border-destructive/20 bg-destructive/5 hover:bg-destructive/10 hover:border-destructive/40")
      case "warning":
        return cn(base, "border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/40")
      case "success":
        return cn(base, "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 hover:border-emerald-500/40")
      default:
        return cn(base, "border-border/50 bg-muted/30 hover:bg-muted/50 hover:border-border")
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
        return "bg-primary/10 text-primary"
    }
  }

  const quickActionsFiltered = QUICK_ACTIONS.filter(a => canAction(a.id))
  const dangerActionsFiltered = DANGER_ACTIONS.filter(a => canAction(a.id))

  return (
    <div className="space-y-6">
      {/* Account Status Card */}
      {(canAction("disable") || canAction("enable")) && (
        <div className="rounded-xl border border-border/50 bg-gradient-to-br from-card to-card/80 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "h-10 w-10 rounded-lg flex items-center justify-center",
                u.disabled_at ? "bg-destructive/10" : "bg-emerald-500/10"
              )}>
                {u.disabled_at ? (
                  <Ban className="h-5 w-5 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Account Status</p>
                <p className="text-xs text-muted-foreground">
                  {u.disabled_at ? "This account is currently suspended" : "This account is active and in good standing"}
                </p>
              </div>
            </div>
            {u.disabled_at ? (
              <Button
                size="sm"
                className="gap-2 bg-emerald-500 hover:bg-emerald-600 text-white"
                onClick={() => onAction("enable")}
                disabled={isLoading("enable")}
              >
                {isLoading("enable") ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Re-enable
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onConfirmAction({
                  title: "Disable Account",
                  description: `This will suspend ${u.email}. They will be logged out of all sessions and unable to sign in until re-enabled.`,
                  confirmLabel: "Disable Account",
                  danger: true,
                  action: async () => {
                    await onAction("disable")
                  },
                })}
                disabled={isLoading("disable")}
              >
                {isLoading("disable") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                Disable
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      {quickActionsFiltered.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick Actions</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {quickActionsFiltered.map((action) => (
              <button
                key={action.id}
                onClick={() => handleAction(action)}
                disabled={isLoading(action.id)}
                className={cn(
                  "flex items-center gap-3 p-3.5 text-left group",
                  getVariantStyles(action.variant),
                  isLoading(action.id) && "opacity-50 pointer-events-none"
                )}
              >
                <div className={cn(
                  "h-10 w-10 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-105",
                  getIconStyles(action.variant)
                )}>
                  {isLoading(action.id) ? (
                    <Loader2 className="h-4.5 w-4.5 animate-spin" />
                  ) : (
                    <action.icon className="h-4.5 w-4.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{action.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{action.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Gift Subscription */}
      {canAction("gift_subscription") && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Gift className="h-4 w-4 text-amber-500" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subscription</h3>
          </div>
          <button
            onClick={() => onAction("gift_subscription")}
            disabled={isLoading("gift_subscription")}
            className={cn(
              "w-full flex items-center gap-3 p-3.5 text-left group",
              getVariantStyles("warning"),
              isLoading("gift_subscription") && "opacity-50 pointer-events-none"
            )}
          >
            <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-amber-500/10 text-amber-500 transition-transform group-hover:scale-105">
              {isLoading("gift_subscription") ? (
                <Loader2 className="h-4.5 w-4.5 animate-spin" />
              ) : (
                <Gift className="h-4.5 w-4.5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Gift Subscription</p>
              <p className="text-xs text-muted-foreground">
                {u.gifted_plan ? `Currently gifted: ${u.gifted_plan}` : "Grant a free premium subscription"}
              </p>
            </div>
          </button>
        </div>
      )}

      {/* Danger Zone */}
      {dangerActionsFiltered.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setDangerExpanded(!dangerExpanded)}
            className="w-full flex items-center justify-between px-1 py-1 hover:opacity-80 transition-opacity"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <h3 className="text-xs font-semibold text-destructive uppercase tracking-wider">Danger Zone</h3>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>{dangerExpanded ? "Hide" : "Show"}</span>
              {dangerExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </div>
          </button>
          
          {dangerExpanded && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 animate-in slide-in-from-top-2 duration-200">
              {dangerActionsFiltered.map((action) => (
                <button
                  key={action.id}
                  onClick={() => handleAction(action)}
                  disabled={isLoading(action.id)}
                  className={cn(
                    "flex items-center gap-3 p-3.5 text-left group",
                    getVariantStyles(action.variant),
                    isLoading(action.id) && "opacity-50 pointer-events-none"
                  )}
                >
                  <div className={cn(
                    "h-10 w-10 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-105",
                    getIconStyles(action.variant)
                  )}>
                    {isLoading(action.id) ? (
                      <Loader2 className="h-4.5 w-4.5 animate-spin" />
                    ) : (
                      <action.icon className="h-4.5 w-4.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{action.label}</p>
                    <p className="text-xs text-muted-foreground truncate">{action.description}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
