"use client"

import React, { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { 
  Trash2, 
  RefreshCw, 
  Globe, 
  Network, 
  Loader2, 
  AlertTriangle, 
  Search,
  Database,
  FileWarning,
  CheckCircle2,
  ChevronDown,
  ChevronUp
} from "lucide-react"
import { SaveConfirmationModal, type ChangeItem } from "@/components/shared/save-confirmation-modal"
import { cn } from "@/lib/ui/utils"

interface BlockedRule {
  id: number
  rule_type: "blacklist"
  value_type: "ip" | "url"
  value: string
  description?: string
  reason?: string
  is_active: boolean
  hit_count: number
  created_at: string
}

interface MatchingScan {
  id: number
  url: string
  scan_type: string
  created_at: string
  user_email?: string
  user_id: number
}

export function BlockedDataManager() {
  const [blockedRules, setBlockedRules] = useState<BlockedRule[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [expandedRule, setExpandedRule] = useState<number | null>(null)
  const [matchingScans, setMatchingScans] = useState<Record<number, MatchingScan[]>>({})
  const [loadingScans, setLoadingScans] = useState<number | null>(null)
  const [deletingScans, setDeletingScans] = useState<number | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ ruleId: number; scanCount: number; value: string } | null>(null)
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null)

  const fetchBlockedRules = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", section: "access_rules" }),
      })
      const data = await res.json()
      // Filter to only show blacklist rules
      const blacklistRules = (data.rules || []).filter((r: BlockedRule) => r.rule_type === "blacklist" && r.is_active)
      setBlockedRules(blacklistRules)
    } catch (error) {
      console.error("Error fetching blocked rules:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBlockedRules()
  }, [])

  const fetchMatchingScans = async (ruleId: number, value: string) => {
    setLoadingScans(ruleId)
    try {
      const res = await fetch("/api/v2/admin/blocked-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "find_scans", value }),
      })
      const data = await res.json()
      setMatchingScans(prev => ({ ...prev, [ruleId]: data.scans || [] }))
    } catch (error) {
      console.error("Error fetching matching scans:", error)
      setToast({ message: "Failed to fetch matching scans", type: "error" })
    } finally {
      setLoadingScans(null)
    }
  }

  const handleToggleExpand = async (ruleId: number, value: string) => {
    if (expandedRule === ruleId) {
      setExpandedRule(null)
    } else {
      setExpandedRule(ruleId)
      if (!matchingScans[ruleId]) {
        await fetchMatchingScans(ruleId, value)
      }
    }
  }

  const handleDeleteScans = async () => {
    if (!pendingDelete) return
    setDeletingScans(pendingDelete.ruleId)
    try {
      const res = await fetch("/api/v2/admin/blocked-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_scans", value: pendingDelete.value }),
      })
      const data = await res.json()
      if (res.ok) {
        setToast({ message: `Deleted ${data.deletedCount || 0} scan(s) for ${pendingDelete.value}`, type: "success" })
        // Clear cached scans and refresh
        setMatchingScans(prev => {
          const newScans = { ...prev }
          delete newScans[pendingDelete.ruleId]
          return newScans
        })
        // Refetch to show updated state
        await fetchMatchingScans(pendingDelete.ruleId, pendingDelete.value)
      } else {
        setToast({ message: data.error || "Failed to delete scans", type: "error" })
      }
    } catch (error) {
      console.error("Error deleting scans:", error)
      setToast({ message: "Failed to delete scans", type: "error" })
    } finally {
      setDeletingScans(null)
      setPendingDelete(null)
    }
  }

  const filteredRules = blockedRules.filter(rule => 
    rule.value.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (rule.description?.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const totalScansFound = Object.values(matchingScans).reduce((sum, scans) => sum + scans.length, 0)

  const deleteChangeItems: ChangeItem[] = pendingDelete ? [
    { field: "target", label: "Blocked URL/IP", oldValue: pendingDelete.value, newValue: "All data will be deleted" },
    { field: "scans", label: "Scans to Delete", oldValue: `${pendingDelete.scanCount} scan(s)`, newValue: "0" },
  ] : []

  return (
    <>
      {/* Delete confirmation modal */}
      <SaveConfirmationModal
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDeleteScans}
        title="Delete Blocked Data"
        description={`This will permanently delete all scan history for "${pendingDelete?.value}". This action cannot be undone.`}
        confirmLabel="Delete All Data"
        changes={deleteChangeItems}
        isLoading={deletingScans !== null}
        variant="destructive"
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2">
          <div className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg",
            toast.type === "success" 
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" 
              : "bg-destructive/10 border-destructive/20 text-destructive"
          )}>
            {toast.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <span className="text-sm font-medium">{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-2 text-current/60 hover:text-current">×</button>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { icon: AlertTriangle, value: blockedRules.length, label: "Blocked Rules", color: "destructive" },
            { icon: Database, value: totalScansFound, label: "Scans Found", color: "amber" },
            { icon: FileWarning, value: blockedRules.reduce((sum, r) => sum + r.hit_count, 0), label: "Block Attempts", color: "primary" },
          ].map((stat, i) => (
            <div key={i} className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-colors">
              <div className={cn(
                "p-2.5 rounded-lg shrink-0", 
                stat.color === "primary" ? "bg-primary/10" : 
                stat.color === "amber" ? "bg-amber-500/10" : 
                "bg-destructive/10"
              )}>
                <stat.icon className={cn(
                  "h-4 w-4", 
                  stat.color === "primary" ? "text-primary" : 
                  stat.color === "amber" ? "text-amber-500" : 
                  "text-destructive"
                )} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
                <p className="text-[11px] text-muted-foreground truncate">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Info Card */}
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 shrink-0">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Blocked Data Management</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This page shows all blocked URLs and IPs. You can find and delete any scan history that matches 
                  these blocked entries. Use this when a URL owner requests their data to be removed, or to clean up 
                  scans that should not have been performed.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Blocked Rules List */}
        <Card className="border-border/50 bg-card/50 overflow-hidden">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-destructive/10">
                  <Globe className="h-4 w-4 text-destructive" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Blocked URLs & IPs</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Find and delete scan data for blocked entries</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 gap-2 border-border/40 shrink-0"
                onClick={() => fetchBlockedRules()}
                disabled={loading}
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>

            {/* Search */}
            <div className="mt-4 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search blocked URLs or IPs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-background/50 border-border/40"
              />
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-primary mb-3" />
                <p className="text-sm text-muted-foreground">Loading blocked rules...</p>
              </div>
            ) : filteredRules.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="p-4 rounded-full bg-muted/50 mb-4">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500/60" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">No blocked rules</p>
                <p className="text-xs text-muted-foreground text-center max-w-sm">
                  {searchQuery ? `No results for "${searchQuery}".` : "Add blacklist rules in Access Rules to see them here."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {filteredRules.map((rule) => {
                  const isExpanded = expandedRule === rule.id
                  const scans = matchingScans[rule.id] || []
                  const isLoadingThisRule = loadingScans === rule.id

                  return (
                    <div key={rule.id} className="group">
                      {/* Rule header */}
                      <button
                        onClick={() => handleToggleExpand(rule.id, rule.value)}
                        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/20 transition-colors text-left"
                      >
                        <div className="p-2 rounded-lg bg-muted/50 shrink-0">
                          {rule.value_type === "url" ? (
                            <Globe className="h-4 w-4 text-destructive" />
                          ) : (
                            <Network className="h-4 w-4 text-destructive" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-mono text-foreground truncate">{rule.value}</p>
                          {rule.description && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{rule.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-medium bg-muted/30">
                            {rule.hit_count} hits
                          </Badge>
                          {matchingScans[rule.id] && (
                            <Badge className={cn(
                              "text-[10px] px-2 py-0.5 font-medium",
                              scans.length > 0 
                                ? "bg-amber-500/10 text-amber-500 border-amber-500/20" 
                                : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                            )}>
                              {scans.length} scan{scans.length !== 1 ? "s" : ""}
                            </Badge>
                          )}
                          {isLoadingThisRule ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </button>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="px-5 pb-4 bg-muted/10 border-t border-border/30">
                          {isLoadingThisRule ? (
                            <div className="flex items-center justify-center py-8">
                              <Loader2 className="h-5 w-5 animate-spin text-primary mr-2" />
                              <span className="text-sm text-muted-foreground">Searching scan history...</span>
                            </div>
                          ) : scans.length === 0 ? (
                            <div className="flex items-center gap-3 py-6 justify-center">
                              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                              <span className="text-sm text-muted-foreground">No scan data found for this blocked entry</span>
                            </div>
                          ) : (
                            <div className="pt-4">
                              {/* Delete all button */}
                              <div className="flex items-center justify-between mb-4">
                                <p className="text-xs text-muted-foreground">
                                  Found <span className="font-medium text-foreground">{scans.length}</span> scan{scans.length !== 1 ? "s" : ""} matching this blocked entry
                                </p>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="h-8 gap-1.5"
                                  onClick={() => setPendingDelete({ ruleId: rule.id, scanCount: scans.length, value: rule.value })}
                                  disabled={deletingScans !== null}
                                >
                                  {deletingScans === rule.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                  Delete All
                                </Button>
                              </div>

                              {/* Scans list */}
                              <div className="border border-border/40 rounded-lg overflow-hidden">
                                <table className="w-full">
                                  <thead>
                                    <tr className="border-b border-border/40 bg-muted/30">
                                      <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">URL</th>
                                      <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">User</th>
                                      <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Type</th>
                                      <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Date</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {scans.slice(0, 10).map((scan) => (
                                      <tr key={scan.id} className="border-b border-border/30 last:border-0">
                                        <td className="px-4 py-2.5">
                                          <p className="text-xs font-mono text-foreground truncate max-w-[200px]" title={scan.url}>
                                            {scan.url}
                                          </p>
                                        </td>
                                        <td className="px-4 py-2.5">
                                          <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                                            {scan.user_email || `User #${scan.user_id}`}
                                          </p>
                                        </td>
                                        <td className="px-4 py-2.5">
                                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                            {scan.scan_type}
                                          </Badge>
                                        </td>
                                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                                          {new Date(scan.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {scans.length > 10 && (
                                  <div className="px-4 py-2 bg-muted/20 border-t border-border/30 text-center">
                                    <p className="text-xs text-muted-foreground">
                                      Showing 10 of {scans.length} scans. Delete all to remove remaining.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
