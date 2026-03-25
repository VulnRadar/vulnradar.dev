"use client"

import { RefreshCw, Shield, Loader2, Dot, Monitor, Activity, Clock, Globe } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PaginationControl, usePagination } from "@/components/ui/pagination-control"
import { cn } from "@/lib/utils"
import { STAFF_ROLE_LABELS, ROLE_BADGE_STYLES } from "@/lib/constants"
import { UserAvatar } from "../shared/user-avatar"
import { ActionBadge } from "../shared/action-badge"
import type { ActiveAdmin } from "../types"

interface ActiveStaffProps {
  admins: ActiveAdmin[]
  loading: boolean
  onRefresh: () => void
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export function ActiveStaff({ admins, loading, onRefresh, page, pageSize, onPageChange, onPageSizeChange }: ActiveStaffProps) {
  const pagination = usePagination(admins, pageSize)
  const pagedStaff = pagination.getPage(page)

  return (
    <Card className="bg-card border-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Active Staff</h2>
          <p className="text-xs text-muted-foreground mt-0.5">View real-time activity of administrators and moderators</p>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs self-start sm:self-auto" onClick={onRefresh}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <CardContent className="p-0">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Loading staff...</p>
          </div>
        ) : admins.length === 0 ? (
          <div className="py-16 text-center px-4">
            <div className="h-16 w-16 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-4">
              <Shield className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-base font-medium text-muted-foreground">No staff members found</p>
            <p className="text-sm text-muted-foreground/70 mt-1">Staff activity will appear here</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {pagedStaff.map((admin, i) => {
                const displayName = admin.name || admin.email.split("@")[0]
                const isActive = admin.is_active
                const isRecentlyActive = admin.seconds_since_heartbeat !== undefined && admin.seconds_since_heartbeat < 300
                const statusDisplay = isActive ? "Active Now" : isRecentlyActive ? "Recently Active" : "Offline"
                
                return (
                  <div key={admin.id} className={cn("flex items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/20", i < pagedStaff.length - 1 && "border-b border-border")}>
                    <div className="relative shrink-0">
                      <UserAvatar name={admin.name} email={admin.email} avatarUrl={admin.avatar_url} />
                      <div className={cn(
                        "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
                        isActive ? "bg-primary animate-pulse" : isRecentlyActive ? "bg-emerald-500" : "bg-muted-foreground/40"
                      )} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">{displayName}</span>
                        <Badge className={cn("text-[10px] px-1.5 font-medium", ROLE_BADGE_STYLES[admin.role] || ROLE_BADGE_STYLES.user)}>
                          {STAFF_ROLE_LABELS[admin.role] || admin.role}
                        </Badge>
                        <Badge className={cn("text-[10px] px-1.5 font-medium flex items-center gap-1",
                          isActive
                            ? "bg-accent text-accent-foreground border-accent/30"
                            : isRecentlyActive
                            ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                            : "bg-muted text-muted-foreground border-border"
                        )}>
                          <Dot className="h-2 w-2 fill-current" />
                          {statusDisplay}
                        </Badge>
                        {admin.totp_enabled && (
                          <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-1.5 font-medium">2FA</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{admin.email}</p>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5">
                        {admin.current_section && isActive && (
                          <span className="flex items-center gap-1 text-[11px] text-accent-foreground font-medium">
                            <Monitor className="h-3 w-3" />
                            Viewing {admin.current_section}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Monitor className="h-3 w-3" />
                          {admin.active_sessions} active session{admin.active_sessions !== 1 ? "s" : ""}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Activity className="h-3 w-3" />
                          {admin.total_actions} total action{admin.total_actions !== 1 ? "s" : ""}
                          {admin.actions_24h > 0 && <span className="text-primary font-medium">({admin.actions_24h} today)</span>}
                        </span>
                        {admin.recent_actions && admin.recent_actions > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-primary font-medium">
                            <Clock className="h-3 w-3" />
                            {admin.recent_actions} action{admin.recent_actions !== 1 ? "s" : ""} (5 min)
                          </span>
                        )}
                        {admin.last_ip && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
                            <Globe className="h-3 w-3" />
                            {admin.last_ip}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex items-center gap-4 flex-wrap text-[11px] text-muted-foreground">
                        {admin.last_admin_action && (
                          <div>
                            Last action: <ActionBadge action={admin.last_action_type || ""} />
                            <span className="ml-1.5">
                              {new Date(admin.last_admin_action).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        )}
                        {admin.last_heartbeat && admin.seconds_since_heartbeat !== undefined && (
                          <div className="text-muted-foreground/60 text-[10px]">
                            Last seen {admin.seconds_since_heartbeat < 60 ? "just now" : `${Math.floor(admin.seconds_since_heartbeat / 60)}m ago`}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Admin since</p>
                      <p className="text-xs text-foreground mt-0.5">
                        {new Date(admin.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
            
            {pagination.totalPages > 1 && (
              <div className="px-5 py-3 border-t border-border bg-muted/10">
                <PaginationControl
                  currentPage={page}
                  totalPages={pagination.totalPages}
                  onPageChange={onPageChange}
                  pageSize={pageSize}
                  onPageSizeChange={onPageSizeChange}
                  totalItems={admins.length}
                />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
