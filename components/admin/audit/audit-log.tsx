"use client"

import React, { useState } from "react"
import { Search, RefreshCw, X, History, Shield, User, CreditCard, AlertTriangle, ChevronDown, Globe, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { PaginationControl } from "@/components/ui/pagination-control"
import { cn } from "@/lib/utils"
import { UserAvatar } from "../shared/user-avatar"
import { ActionBadge } from "../shared/action-badge"
import { formatRelativeTime, filterAuditLogs } from "../utils"
import type { AuditEntry } from "../types"

interface AuditLogProps {
  logs: AuditEntry[]
  loading: boolean
  page: number
  totalPages: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  onRefresh: () => void
}

const FILTER_CATEGORIES = [
  { id: "all", label: "All Actions", icon: History },
  { id: "security", label: "Security", icon: Shield },
  { id: "user", label: "User Changes", icon: User },
  { id: "plan", label: "Plan Changes", icon: CreditCard },
  { id: "danger", label: "Destructive", icon: AlertTriangle },
]

export function AuditLog({ logs, loading, page, totalPages, pageSize, onPageChange, onPageSizeChange, onRefresh }: AuditLogProps) {
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [expandedLog, setExpandedLog] = useState<number | null>(null)
  
  const filteredLogs = filterAuditLogs(logs, filter, search)

  return (
    <div className="space-y-4">
      {/* Header Card with Search & Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Audit Log</h2>
                <p className="text-xs text-muted-foreground">Track all administrative actions</p>
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs self-start sm:self-auto" onClick={onRefresh}>
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                Refresh
              </Button>
            </div>
            
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by admin, user, or action..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-10 bg-background"
              />
              {search && (
                <button 
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearch("")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
              {FILTER_CATEGORIES.map(cat => {
                const isActive = filter === cat.id
                const Icon = cat.icon
                return (
                  <button
                    key={cat.id}
                    onClick={() => setFilter(cat.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all shrink-0",
                      isActive 
                        ? "bg-primary text-primary-foreground" 
                        : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {cat.label}
                  </button>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Results Card */}
      <Card className="bg-card border-border overflow-hidden">
        {filteredLogs.length === 0 ? (
          <div className="py-16 px-4 text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-4">
              <History className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-base font-medium text-muted-foreground">
              {search || filter !== "all" ? "No matching entries" : "No audit log entries yet"}
            </p>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-xs mx-auto">
              {search || filter !== "all" 
                ? "Try adjusting your search or filters" 
                : "Admin actions will appear here as they occur"
              }
            </p>
            {(search || filter !== "all") && (
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-4"
                onClick={() => { setSearch(""); setFilter("all") }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="px-4 sm:px-5 py-3 border-b border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-medium text-foreground">{filteredLogs.length}</span> {filteredLogs.length === 1 ? "entry" : "entries"}
                {(search || filter !== "all") && " (filtered)"}
              </p>
            </div>
            
            <div className={cn("transition-opacity duration-200", loading && "opacity-40 pointer-events-none")}>
              <table className="w-full hidden md:table">
                <thead>
                  <tr className="border-b border-border bg-muted/10">
                    <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Admin</th>
                    <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Action</th>
                    <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Target</th>
                    <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Time</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log, i) => {
                    const isExpanded = expandedLog === log.id
                    const logDate = new Date(log.created_at)
                    
                    return (
                      <React.Fragment key={log.id}>
                        <tr 
                          className={cn(
                            "group cursor-pointer transition-colors hover:bg-muted/30",
                            isExpanded && "bg-muted/20",
                            i < filteredLogs.length - 1 && !isExpanded && "border-b border-border/50"
                          )}
                          onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                        >
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <UserAvatar name={log.admin_name} email={log.admin_email} size="sm" avatarUrl={log.admin_avatar_url} />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground truncate max-w-[150px]">
                                  {log.admin_name || log.admin_email.split("@")[0]}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3.5"><ActionBadge action={log.action} /></td>
                          <td className="px-3 py-3.5">
                            {log.target_email ? (
                              <div className="min-w-0">
                                <p className="text-sm text-foreground truncate max-w-[150px]">
                                  {log.target_name || log.target_email.split("@")[0]}
                                </p>
                                <p className="text-[10px] text-muted-foreground truncate max-w-[150px]">{log.target_email}</p>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="px-3 py-3.5">
                            <div className="flex flex-col">
                              <span className="text-xs text-foreground">{formatRelativeTime(logDate)}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {logDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3.5">
                            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                          </td>
                        </tr>
                        
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} className="px-5 pb-4 pt-0 border-b border-border">
                              <div className="rounded-xl bg-gradient-to-br from-muted/40 to-muted/10 border border-border/60 p-4 mt-1">
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                  <div className="flex items-start gap-3">
                                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                      <Shield className="h-4 w-4 text-primary" />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Performed by</p>
                                      <p className="text-sm font-medium text-foreground truncate">{log.admin_name || log.admin_email.split("@")[0]}</p>
                                      <p className="text-xs text-muted-foreground truncate">{log.admin_email}</p>
                                    </div>
                                  </div>
                                  
                                  {log.target_email && (
                                    <div className="flex items-start gap-3">
                                      <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                        <User className="h-4 w-4 text-muted-foreground" />
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Target user</p>
                                        <p className="text-sm font-medium text-foreground truncate">{log.target_name || log.target_email.split("@")[0]}</p>
                                        <p className="text-xs text-muted-foreground truncate">{log.target_email}</p>
                                      </div>
                                    </div>
                                  )}
                                  
                                  <div className="flex items-start gap-3">
                                    <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                      <Clock className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Timestamp</p>
                                      <p className="text-sm font-medium text-foreground">{logDate.toLocaleString()}</p>
                                      {log.ip_address && (
                                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                          <Globe className="h-3 w-3" /> {log.ip_address}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                
                                {log.details && (
                                  <div className="mt-4 pt-3 border-t border-border/50">
                                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Details</p>
                                    <p className="text-sm text-foreground bg-muted/30 px-3 py-2 rounded-lg font-mono">{log.details}</p>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
              
              {/* Mobile view */}
              <div className="md:hidden divide-y divide-border">
                {filteredLogs.map((log) => {
                  const logDate = new Date(log.created_at)
                  return (
                    <div key={log.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <UserAvatar name={log.admin_name} email={log.admin_email} size="sm" avatarUrl={log.admin_avatar_url} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{log.admin_name || log.admin_email.split("@")[0]}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <ActionBadge action={log.action} />
                            {log.target_email && (
                              <span className="text-xs text-muted-foreground truncate">{log.target_name || log.target_email.split("@")[0]}</span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-1">{formatRelativeTime(logDate)}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            
            {totalPages > 1 && (
              <div className="px-4 sm:px-5 py-3 border-t border-border bg-muted/10">
                <PaginationControl
                  currentPage={page}
                  totalPages={totalPages}
                  onPageChange={onPageChange}
                  pageSize={pageSize}
                  onPageSizeChange={onPageSizeChange}
                />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
