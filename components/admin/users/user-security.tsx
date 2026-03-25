"use client"

import { Key, LogOut, ShieldOff, Globe, KeyRound, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { AdminUser, UserDetail } from "../types"

interface UserSecurityProps {
  user: AdminUser & { session_count: number; has_backup_codes: boolean; totp_enabled: boolean }
  detail: UserDetail
  onAction: (action: string) => void
  actionLoading: string | null
  canReset2FA: boolean
  canRevokeSessions: boolean
  canResetPassword: boolean
}

export function UserSecurity({ 
  user: u, 
  detail, 
  onAction, 
  actionLoading,
  canReset2FA,
  canRevokeSessions,
  canResetPassword,
}: UserSecurityProps) {
  const isLoading = (action: string) => actionLoading === `${u.id}-${action}`

  return (
    <div className="space-y-4">
      {/* Active Sessions */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-0 pt-4 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Active Sessions ({detail.activeSessions.length})
              </p>
            </div>
            {canRevokeSessions && detail.activeSessions.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                onClick={() => onAction("revoke_sessions")}
                disabled={isLoading("revoke_sessions")}
              >
                {isLoading("revoke_sessions") ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <LogOut className="h-3 w-3" />
                )}
                Revoke All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          {detail.activeSessions.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No active sessions</p>
          ) : (
            <div className="space-y-2">
              {detail.activeSessions.slice(0, 5).map((session) => (
                <div key={session.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border border-border">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">
                      {session.user_agent ? session.user_agent.split(" ").slice(0, 3).join(" ") : "Unknown device"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {session.ip_address || "Unknown IP"} - Expires {new Date(session.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
              {detail.activeSessions.length > 5 && (
                <p className="text-xs text-muted-foreground text-center pt-1">
                  +{detail.activeSessions.length - 5} more sessions
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-0 pt-4 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                API Keys ({detail.apiKeys.filter(k => !k.revoked_at).length})
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          {detail.apiKeys.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No API keys</p>
          ) : (
            <div className="space-y-2">
              {detail.apiKeys.slice(0, 5).map((key) => (
                <div key={key.id} className={cn(
                  "flex items-center justify-between p-2.5 rounded-lg border",
                  key.revoked_at ? "bg-muted/20 border-border opacity-50" : "bg-muted/30 border-border"
                )}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-foreground truncate">
                        {key.name || "Unnamed Key"}
                      </p>
                      {key.revoked_at && (
                        <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[9px]">Revoked</Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono">{key.key_prefix}...</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security Actions */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-0 pt-4 px-4">
          <div className="flex items-center gap-2">
            <ShieldOff className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Security Actions</p>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          <div className="flex flex-wrap gap-2">
            {canResetPassword && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => onAction("reset_password")}
                disabled={isLoading("reset_password")}
              >
                {isLoading("reset_password") ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                Reset Password
              </Button>
            )}
            {canReset2FA && u.totp_enabled && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 text-amber-500 border-amber-500/30 hover:bg-amber-500/10"
                onClick={() => onAction("reset_2fa")}
                disabled={isLoading("reset_2fa")}
              >
                {isLoading("reset_2fa") ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldOff className="h-3 w-3" />}
                Reset 2FA
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
