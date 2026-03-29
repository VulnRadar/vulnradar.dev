"use client"

import React, { useState } from "react"
import {
  Shield,
  Loader2,
  RefreshCw,
  Monitor,
  Activity,
  Clock,
  Globe,
  Dot,
  Eye,
  X,
  User,
  Key,
  Calendar,
  ShieldCheck,
  Zap,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { PaginationControl, usePagination } from "@/components/ui/pagination-control"
import { UserAvatar, ActionBadge } from "@/components/admin/shared"
import { STAFF_ROLE_LABELS, ROLE_BADGE_STYLES } from "@/lib/constants"
import type { ActiveAdmin } from "@/components/admin/types"

interface StaffListProps {
  activeAdmins: ActiveAdmin[]
  adminsLoading: boolean
  fetchActiveAdmins: () => void
}

export function StaffList({
  activeAdmins,
  adminsLoading,
  fetchActiveAdmins,
}: StaffListProps) {
  const [staffPage, setStaffPage] = useState(1)
  const [staffPageSize, setStaffPageSize] = useState(10)
  const [selectedAdmin, setSelectedAdmin] = useState<ActiveAdmin | null>(null)
  
  const { totalPages, getPage } = usePagination(activeAdmins, staffPageSize)
  const pagedStaff = getPage(staffPage)

  // Compute stats
  const activeNow = activeAdmins.filter(a => a.is_active).length
  const recentlyActive = activeAdmins.filter(a => !a.is_active && a.seconds_since_heartbeat != null && a.seconds_since_heartbeat < 600).length
  const with2FA = activeAdmins.filter(a => a.totp_enabled).length

  const getStatusInfo = (admin: ActiveAdmin) => {
    const isActive = admin.is_active === true
    const isRecentlyActive = !isActive && admin.seconds_since_heartbeat != null && admin.seconds_since_heartbeat < 600
    const statusDisplay = isActive ? "Active Now" : isRecentlyActive ? "Recently Active" : "Offline"
    return { isActive, isRecentlyActive, statusDisplay }
  }

  return (
    <>
      {/* Staff detail modal */}
      {selectedAdmin && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setSelectedAdmin(null)}
        >
          <div 
            className="bg-card border border-border rounded-xl w-full max-w-2xl mx-4 shadow-2xl max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="p-6 border-b border-border/50">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <UserAvatar name={selectedAdmin.name} email={selectedAdmin.email} avatarUrl={selectedAdmin.avatar_url} size="lg" />
                    {(() => {
                      const { isActive, isRecentlyActive } = getStatusInfo(selectedAdmin)
                      return (
                        <div className={cn(
                          "absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-card",
                          isActive ? "bg-primary animate-pulse" : isRecentlyActive ? "bg-emerald-500" : "bg-muted-foreground/40"
                        )} />
                      )
                    })()}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{selectedAdmin.name || selectedAdmin.email.split("@")[0]}</h3>
                    <p className="text-sm text-muted-foreground font-mono">{selectedAdmin.email}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge className={cn("text-[10px] px-2 py-0.5 font-medium", ROLE_BADGE_STYLES[selectedAdmin.role] || ROLE_BADGE_STYLES.user)}>
                        {STAFF_ROLE_LABELS[selectedAdmin.role] || selectedAdmin.role}
                      </Badge>
                      {(() => {
                        const { isActive, isRecentlyActive, statusDisplay } = getStatusInfo(selectedAdmin)
                        return (
                          <Badge className={cn("text-[10px] px-2 py-0.5 font-medium flex items-center gap-1",
                            isActive
                              ? "bg-accent text-accent-foreground border-accent/30"
                              : isRecentlyActive
                              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                              : "bg-muted text-muted-foreground border-border"
                          )}>
                            <Dot className="h-2 w-2 fill-current" />
                            {statusDisplay}
                          </Badge>
                        )
                      })()}
                      {selectedAdmin.totp_enabled && (
                        <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-2 py-0.5 font-medium">2FA</Badge>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={() => setSelectedAdmin(null)} className="p-2 rounded-lg hover:bg-muted transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Modal content */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Quick stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Monitor className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Sessions</span>
                  </div>
                  <p className="text-xl font-bold">{selectedAdmin.active_sessions}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total Actions</span>
                  </div>
                  <p className="text-xl font-bold">{selectedAdmin.total_actions}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Today</span>
                  </div>
                  <p className="text-xl font-bold">{selectedAdmin.actions_24h}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Last 5 min</span>
                  </div>
                  <p className="text-xl font-bold">{selectedAdmin.recent_actions || 0}</p>
                </div>
              </div>

              {/* Current Activity */}
              {selectedAdmin.is_active && selectedAdmin.current_section && (
                <div className="p-4 rounded-lg bg-accent/10 border border-accent/30">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-accent-foreground" />
                    <span className="text-sm font-medium text-accent-foreground">Currently viewing: {selectedAdmin.current_section}</span>
                  </div>
                </div>
              )}

              {/* Details grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Account Details</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">User ID</p>
                        <p className="text-sm font-mono">{selectedAdmin.id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Admin Since</p>
                        <p className="text-sm">{new Date(selectedAdmin.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                      <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">2FA Status</p>
                        <p className="text-sm">{selectedAdmin.totp_enabled ? "Enabled" : "Not enabled"}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Session & Activity</h4>
                  <div className="space-y-2">
                    {selectedAdmin.last_ip && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Last IP</p>
                          <p className="text-sm font-mono">{selectedAdmin.last_ip}</p>
                        </div>
                      </div>
                    )}
                    {selectedAdmin.last_session_created && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                        <Key className="h-4 w-4 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Last Session Created</p>
                          <p className="text-sm">{new Date(selectedAdmin.last_session_created).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                        </div>
                      </div>
                    )}
                    {selectedAdmin.last_heartbeat && selectedAdmin.seconds_since_heartbeat !== undefined && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Last Seen</p>
                          <p className="text-sm">{selectedAdmin.seconds_since_heartbeat < 60 ? "Just now" : `${Math.floor(selectedAdmin.seconds_since_heartbeat / 60)} minutes ago`}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Last action */}
              {selectedAdmin.last_admin_action && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Last Admin Action</h4>
                  <div className="p-4 rounded-lg bg-muted/20 border border-border/40">
                    <div className="flex items-center gap-3">
                      <ActionBadge action={selectedAdmin.last_action_type || ""} />
                      <span className="text-sm text-muted-foreground">
                        {new Date(selectedAdmin.last_admin_action).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: Shield, value: activeAdmins.length, label: "Total Staff", color: "primary" },
            { icon: Zap, value: activeNow, label: "Active Now", color: "accent" },
            { icon: Clock, value: recentlyActive, label: "Recently Active", color: "emerald" },
            { icon: ShieldCheck, value: with2FA, label: "2FA Enabled", color: "emerald" },
          ].map((stat, i) => (
            <div key={i} className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-colors">
              <div className={cn("p-2.5 rounded-lg shrink-0", 
                stat.color === "primary" ? "bg-primary/10" : 
                stat.color === "accent" ? "bg-accent/20" : 
                "bg-emerald-500/10"
              )}>
                <stat.icon className={cn("h-4 w-4", 
                  stat.color === "primary" ? "text-primary" : 
                  stat.color === "accent" ? "text-accent-foreground" : 
                  "text-emerald-500"
                )} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
                <p className="text-[11px] text-muted-foreground truncate">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Staff table */}
        <Card className="border-border/50 bg-card/50 overflow-hidden">
          <CardHeader className="pb-4 pt-5 px-5">
            <div className="flex flex-col gap-4">
              {/* Title row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Shield className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-semibold">Staff Directory</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">All staff members and their current activity</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs font-medium h-6 px-2.5">
                    {activeAdmins.length} members
                  </Badge>
                  <Button variant="outline" size="sm" className="h-9 gap-2 border-border/40" onClick={fetchActiveAdmins}>
                    <RefreshCw className={cn("h-4 w-4", adminsLoading && "animate-spin")} />
                    <span className="hidden sm:inline">Refresh</span>
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {adminsLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading staff data...</p>
              </div>
            ) : activeAdmins.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="p-4 rounded-full bg-muted/50 mb-4">
                  <Shield className="h-8 w-8 text-muted-foreground/40" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">No staff members found</p>
                <p className="text-xs text-muted-foreground">Staff will appear here once assigned.</p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-y border-border/50 bg-muted/30">
                        <th className="px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Staff Member</th>
                        <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Status</th>
                        <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Activity</th>
                        <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Admin Since</th>
                        <th className="px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedStaff.map((admin) => {
                        const { isActive, isRecentlyActive, statusDisplay } = getStatusInfo(admin)
                        const displayName = admin.name || admin.email.split("@")[0]
                        return (
                          <tr key={admin.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors group cursor-pointer" onClick={() => setSelectedAdmin(admin)}>
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                <div className="relative shrink-0">
                                  <UserAvatar name={admin.name} email={admin.email} avatarUrl={admin.avatar_url} />
                                  <div className={cn(
                                    "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
                                    isActive ? "bg-primary animate-pulse" : isRecentlyActive ? "bg-emerald-500" : "bg-muted-foreground/40"
                                  )} />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium truncate">{displayName}</p>
                                    <Badge className={cn("text-[10px] px-1.5 py-0 font-medium", ROLE_BADGE_STYLES[admin.role] || ROLE_BADGE_STYLES.user)}>
                                      {STAFF_ROLE_LABELS[admin.role] || admin.role}
                                    </Badge>
                                  </div>
                                  <p className="text-xs text-muted-foreground truncate font-mono">{admin.email}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex flex-col gap-1">
                                <Badge className={cn("text-[10px] px-2 py-0.5 font-medium flex items-center gap-1 w-fit",
                                  isActive
                                    ? "bg-accent text-accent-foreground border-accent/30"
                                    : isRecentlyActive
                                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                    : "bg-muted text-muted-foreground border-border"
                                )}>
                                  <Dot className="h-2 w-2 fill-current" />
                                  {statusDisplay}
                                </Badge>
                                {isActive && admin.current_section && (
                                  <span className="text-[10px] text-accent-foreground flex items-center gap-1">
                                    <Monitor className="h-3 w-3" />
                                    {admin.current_section}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium">{admin.total_actions} <span className="text-muted-foreground font-normal">actions</span></span>
                                <span className="text-xs text-muted-foreground">{admin.actions_24h} today{admin.recent_actions ? `, ${admin.recent_actions} recent` : ""}</span>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-sm text-muted-foreground whitespace-nowrap">
                              {new Date(admin.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex items-center justify-end">
                                <Button variant="ghost" size="sm" className="h-8 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setSelectedAdmin(admin) }}>
                                  <Eye className="h-3.5 w-3.5" />
                                  <span className="text-xs">View</span>
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile list */}
                <div className="md:hidden flex flex-col">
                  {pagedStaff.map((admin) => {
                    const { isActive, isRecentlyActive, statusDisplay } = getStatusInfo(admin)
                    const displayName = admin.name || admin.email.split("@")[0]
                    return (
                      <div
                        key={admin.id}
                        onClick={() => setSelectedAdmin(admin)}
                        className="flex items-center gap-3 px-5 py-4 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
                      >
                        <div className="relative shrink-0">
                          <UserAvatar name={admin.name} email={admin.email} size="sm" avatarUrl={admin.avatar_url} />
                          <div className={cn(
                            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                            isActive ? "bg-primary animate-pulse" : isRecentlyActive ? "bg-emerald-500" : "bg-muted-foreground/40"
                          )} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-medium truncate">{displayName}</p>
                            <Badge className={cn(ROLE_BADGE_STYLES[admin.role], "text-[10px] px-1.5 shrink-0")}>
                              {STAFF_ROLE_LABELS[admin.role] || admin.role}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate font-mono">{admin.email}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <Badge className={cn("text-[10px] px-1.5 py-0 font-medium flex items-center gap-1",
                              isActive
                                ? "bg-accent text-accent-foreground border-accent/30"
                                : isRecentlyActive
                                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                : "bg-muted text-muted-foreground border-border"
                            )}>
                              <Dot className="h-2 w-2 fill-current" />
                              {statusDisplay}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">{admin.total_actions} actions</span>
                          </div>
                        </div>
                        <Eye className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                      </div>
                    )
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="px-5 py-4 border-t border-border/40 bg-muted/20">
                    <PaginationControl
                      currentPage={staffPage}
                      totalPages={totalPages}
                      onPageChange={setStaffPage}
                      pageSize={staffPageSize}
                      onPageSizeChange={(s) => { setStaffPageSize(s); setStaffPage(1) }}
                      totalItems={activeAdmins.length}
                    />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
