"use client"

import React, { useState } from "react"
import {
  Search,
  History,
  Loader2,
  ChevronDown,
  X,
  Shield,
  Clock,
  Globe,
  User,
  Activity,
  Ban,
  CheckCircle2,
  Key,
  LogOut,
  Crown,
  ShieldOff,
  Trash2,
  Award,
  Gift,
  Bell,
  Mail,
  CreditCard,
  Eye,
  Download,
  StickyNote,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PaginationControl } from "@/components/ui/pagination-control"
import { UserAvatar, ActionBadge } from "@/components/admin/shared"
import { formatRelativeTime, getActionSentence, AUDIT_FILTER_CATEGORIES } from "@/components/admin/utils"
import type { AuditEntry } from "@/components/admin/types"

interface AuditLogProps {
  auditLogs: AuditEntry[]
  auditLoading: boolean
  auditPaging: boolean
  auditPage: number
  auditTotalPages: number
  auditPageSize: number
  setAuditPageSize: (size: number) => void
  fetchAudit: (page?: number, pageSize?: number) => void
}

export function AuditLog({
  auditLogs,
  auditLoading,
  auditPaging,
  auditPage,
  auditTotalPages,
  auditPageSize,
  setAuditPageSize,
  fetchAudit,
}: AuditLogProps) {
  const [auditFilter, setAuditFilter] = useState("all")
  const [auditSearch, setAuditSearch] = useState("")
  const [expandedLog, setExpandedLog] = useState<number | null>(null)

  const filteredLogs = auditLogs.filter((log) => {
    const matchesCategory = auditFilter === "all" || AUDIT_FILTER_CATEGORIES.find(c => c.id === auditFilter)?.actions?.includes(log.action)
    const matchesSearch = !auditSearch || 
      log.admin_email.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.admin_name?.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.target_email?.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.target_name?.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.action.toLowerCase().includes(auditSearch.toLowerCase())
    return matchesCategory && matchesSearch
  })

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold">Audit Log</h2>
              <p className="text-xs text-muted-foreground">All admin actions across the platform.</p>
            </div>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => fetchAudit(1)}>
              <Activity className={cn("h-3.5 w-3.5", auditPaging && "animate-spin")} />
              Refresh
            </Button>
          </div>
          
          <div className="flex flex-wrap gap-2">
            {AUDIT_FILTER_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setAuditFilter(cat.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                  auditFilter === cat.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <cat.icon className="h-3 w-3" />
                {cat.label}
              </button>
            ))}
          </div>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by admin, user, or action..."
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              className="pl-9 h-10 bg-background"
            />
            {auditSearch && (
              <button 
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setAuditSearch("")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </CardContent>
      </Card>
      
      {/* Log entries */}
      <Card className="bg-card border-border overflow-hidden">
        {auditPaging && !auditLogs.length ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Loading audit logs...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-16 text-center px-4">
            <div className="h-16 w-16 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-4">
              <History className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-base font-medium text-muted-foreground">
              {auditSearch || auditFilter !== "all" ? "No matching logs found" : "No audit logs yet"}
            </p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {auditSearch || auditFilter !== "all" ? "Try adjusting your filters" : "Admin actions will appear here"}
            </p>
          </div>
        ) : (
          <>
            <div className="px-4 sm:px-5 py-3 border-b border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-medium text-foreground">{filteredLogs.length}</span> of {auditLogs.length} actions
              </p>
            </div>
            
            {/* Desktop table */}
            <div className="hidden md:block">
              <div className={cn("overflow-x-auto transition-opacity duration-200", auditPaging && "opacity-40 pointer-events-none")}>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/10">
                      <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Action</th>
                      <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Admin</th>
                      <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Target</th>
                      <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Time</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map((log) => {
                      const isExpanded = expandedLog === log.id
                      const logDate = new Date(log.created_at)
                      
                      return (
                        <React.Fragment key={log.id}>
                          <tr 
                            className={cn(
                              "border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer",
                              isExpanded && "bg-muted/20"
                            )}
                            onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                          >
                            <td className="px-5 py-3">
                              <ActionBadge action={log.action} />
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <UserAvatar name={log.admin_name} email={log.admin_email} size="sm" avatarUrl={log.admin_avatar_url} />
                                <span className="text-sm text-foreground truncate max-w-[120px]">
                                  {log.admin_name || log.admin_email.split("@")[0]}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              {log.target_email ? (
                                <div className="flex items-center gap-2">
                                  <UserAvatar name={log.target_name} email={log.target_email} size="sm" avatarUrl={log.target_avatar_url} />
                                  <span className="text-sm text-muted-foreground truncate max-w-[120px]">
                                    {log.target_name || log.target_email.split("@")[0]}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground/50">—</span>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {formatRelativeTime(logDate)}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <ChevronDown className={cn(
                                "h-4 w-4 text-muted-foreground transition-transform",
                                isExpanded && "rotate-180"
                              )} />
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-muted/10 border-b border-border">
                              <td colSpan={5} className="px-5 py-4">
                                <div className="animate-in slide-in-from-top-1 space-y-4">
                                  <p className="text-sm text-foreground leading-relaxed">
                                    {getActionSentence(log)}
                                  </p>
                                  
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div className="flex items-start gap-3">
                                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                        <Shield className="h-4 w-4 text-primary" />
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Admin</p>
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
                                        <p className="text-sm font-medium text-foreground">
                                          {logDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          {logDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                                          {log.ip_address && <span className="ml-2 font-mono">IP: {log.ip_address}</span>}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                  
                                  {log.details && (
                                    <div className="mt-4 pt-4 border-t border-border/50">
                                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Details</p>
                                      <div className="bg-card/60 rounded-lg p-3 border border-border/50">
                                        <p className="text-sm text-foreground leading-relaxed">{log.details}</p>
                                      </div>
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
              </div>
            </div>
            
            {/* Mobile view */}
            <div className="md:hidden">
              <div className={cn("divide-y divide-border transition-opacity duration-200", auditPaging && "opacity-40 pointer-events-none")}>
                {filteredLogs.map((log) => {
                  const isExpanded = expandedLog === log.id
                  const logDate = new Date(log.created_at)
                  
                  return (
                    <div key={log.id} className="p-4">
                      <button
                        className="w-full text-left"
                        onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                      >
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-2.5">
                            <UserAvatar name={log.admin_name} email={log.admin_email} size="sm" avatarUrl={log.admin_avatar_url} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">
                                {log.admin_name || log.admin_email.split("@")[0]}
                              </p>
                              <p className="text-[10px] text-muted-foreground">{formatRelativeTime(logDate)}</p>
                            </div>
                          </div>
                          <ChevronDown className={cn(
                            "h-4 w-4 text-muted-foreground shrink-0 transition-transform mt-1",
                            isExpanded && "rotate-180"
                          )} />
                        </div>
                        
                        <div className="flex items-center gap-2 flex-wrap">
                          <ActionBadge action={log.action} />
                          {log.target_email && (
                            <>
                              <span className="text-muted-foreground">→</span>
                              <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                                {log.target_name || log.target_email.split("@")[0]}
                              </span>
                            </>
                          )}
                        </div>
                      </button>
                      
                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t border-border/50 space-y-3 animate-in slide-in-from-top-1">
                          <p className="text-sm text-foreground leading-relaxed">
                            {getActionSentence(log)}
                          </p>
                          
                          {log.details && (
                            <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                              <p className="text-xs text-muted-foreground mb-1 font-medium">Details</p>
                              <p className="text-sm text-foreground">{log.details}</p>
                            </div>
                          )}
                          
                          <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {logDate.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                            </span>
                            {log.ip_address && (
                              <span className="flex items-center gap-1 font-mono">
                                <Globe className="h-3 w-3" />
                                {log.ip_address}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            
            {auditTotalPages > 1 && (
              <div className="px-4 sm:px-5 py-3 border-t border-border bg-muted/10">
                <PaginationControl
                  currentPage={auditPage}
                  totalPages={auditTotalPages}
                  onPageChange={(p) => fetchAudit(p)}
                  pageSize={auditPageSize}
                  onPageSizeChange={(s) => { setAuditPageSize(s); fetchAudit(1, s) }}
                />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
