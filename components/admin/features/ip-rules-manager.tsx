"use client"

import React, { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Plus, Trash2, RefreshCw, Network, Globe, Loader2, AlertTriangle, CheckCircle2, Eye } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SaveConfirmationModal, type ChangeItem } from "@/components/shared/save-confirmation-modal"
import { cn } from "@/lib/utils"

interface AccessRule {
  id: number
  rule_type: "whitelist" | "blacklist"
  value_type: "ip" | "url"
  ip_address: string
  description?: string
  reason?: string
  is_active: boolean
  hit_count: number
  created_at: string
  expires_at?: string
}

export function IPRulesManager() {
  const [rules, setRules] = useState<AccessRule[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newValue, setNewValue] = useState("")
  const [valueType, setValueType] = useState<"ip" | "url">("ip")
  const [ruleType, setRuleType] = useState<"whitelist" | "blacklist">("blacklist")
  const [description, setDescription] = useState("")
  const [reason, setReason] = useState("")
  const [showAddModal, setShowAddModal] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<AccessRule | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selectedRule, setSelectedRule] = useState<AccessRule | null>(null)

  const fetchRules = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", section: "access_rules" }),
      })
      const data = await res.json()
      setRules(data.rules || [])
    } catch (error) {
      console.error("Error fetching access rules:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRules()
  }, [])

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newValue) return
    setShowAddModal(true)
  }

  const handleAddRule = async () => {
    setAdding(true)
    try {
      const res = await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          section: "access_rules",
          rule_type: ruleType,
          value_type: valueType,
          ip_address: newValue,
          description: description || (valueType === "url" ? "URL Rule" : "IP Rule"),
          reason,
        }),
      })

      if (res.ok) {
        setNewValue("")
        setDescription("")
        setReason("")
        await fetchRules()
      }
    } catch (error) {
      console.error("Error adding rule:", error)
    } finally {
      setAdding(false)
    }
  }

  const handleDeleteRule = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const res = await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          section: "access_rules",
          id: pendingDelete.id,
        }),
      })

      if (res.ok) {
        setPendingDelete(null)
        await fetchRules()
      }
    } catch (error) {
      console.error("Error deleting rule:", error)
    } finally {
      setDeleting(false)
    }
  }

  const addChangeItems: ChangeItem[] = newValue ? [
    { field: "value", label: valueType === "ip" ? "IP Address" : "URL/Domain", oldValue: "—", newValue },
    { field: "rule_type", label: "Action", oldValue: "—", newValue: ruleType === "whitelist" ? "Allow (Whitelist)" : "Block (Blacklist)" },
    ...(description ? [{ field: "description", label: "Description", oldValue: "—", newValue: description }] : []),
  ] : []

  const whitelistCount = rules.filter(r => r.rule_type === "whitelist" && r.is_active).length
  const blacklistCount = rules.filter(r => r.rule_type === "blacklist" && r.is_active).length
  const totalHits = rules.reduce((sum, r) => sum + r.hit_count, 0)

  return (
    <>
      {/* Detail Modal */}
      {selectedRule && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setSelectedRule(null)}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-lg", selectedRule.rule_type === "whitelist" ? "bg-emerald-500/10" : "bg-destructive/10")}>
                  {selectedRule.value_type === "url" ? (
                    <Globe className={cn("h-4 w-4", selectedRule.rule_type === "whitelist" ? "text-emerald-500" : "text-destructive")} />
                  ) : (
                    <Network className={cn("h-4 w-4", selectedRule.rule_type === "whitelist" ? "text-emerald-500" : "text-destructive")} />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">Rule Details</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selectedRule.rule_type === "whitelist" ? "Whitelist" : "Blacklist"} {selectedRule.value_type === "ip" ? "IP" : "URL"}
                  </p>
                </div>
              </div>
              <button onClick={() => setSelectedRule(null)} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <span className="text-lg">×</span>
              </button>
            </div>

            {/* Rule value */}
            <div className="mb-4 p-3 rounded-lg bg-muted/30 border border-border/50">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                {selectedRule.value_type === "ip" ? "IP Address" : "URL / Domain"}
              </p>
              <p className="text-sm font-mono text-foreground break-all">{selectedRule.ip_address}</p>
            </div>

            {/* Details grid */}
            <div className="space-y-3 mb-4">
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Rule Type</p>
                <Badge className={cn(
                  "text-xs px-2 py-0.5 font-medium",
                  selectedRule.rule_type === "whitelist"
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                    : "bg-destructive/10 text-destructive border-destructive/20"
                )}>
                  {selectedRule.rule_type === "whitelist" ? "Allow (Whitelist)" : "Block (Blacklist)"}
                </Badge>
              </div>

              {selectedRule.description && (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm text-foreground">{selectedRule.description}</p>
                </div>
              )}

              {selectedRule.reason && (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Reason</p>
                  <p className="text-sm text-foreground">{selectedRule.reason}</p>
                </div>
              )}

              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Activity</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg bg-muted/30 border border-border/50">
                    <p className="text-2xl font-bold text-foreground">{selectedRule.hit_count}</p>
                    <p className="text-[10px] text-muted-foreground">Total Hits</p>
                  </div>
                  <div className="p-2 rounded-lg bg-muted/30 border border-border/50">
                    <p className="text-xs text-muted-foreground">
                      {new Date(selectedRule.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Created</p>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Status</p>
                <Badge variant="outline" className={cn("text-xs px-2 py-0.5 font-medium", selectedRule.is_active ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-muted text-muted-foreground border-border")}>
                  {selectedRule.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>

              {selectedRule.expires_at && (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Expires</p>
                  <p className="text-sm text-foreground">{new Date(selectedRule.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { icon: AlertTriangle, value: blacklistCount, label: "Blocked Rules", color: "destructive" },
            { icon: CheckCircle2, value: whitelistCount, label: "Allowed Rules", color: "emerald" },
            { icon: Network, value: totalHits, label: "Total Hits", color: "primary" },
          ].map((stat, i) => (
            <div key={i} className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-colors">
              <div className={cn("p-2.5 rounded-lg shrink-0", stat.color === "primary" ? "bg-primary/10" : stat.color === "emerald" ? "bg-emerald-500/10" : "bg-destructive/10")}>
                <stat.icon className={cn("h-4 w-4", stat.color === "primary" ? "text-primary" : stat.color === "emerald" ? "text-emerald-500" : "text-destructive")} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
                <p className="text-[11px] text-muted-foreground truncate">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Add Rule Card */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Plus className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold">Add Access Rule</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Create whitelist or blacklist rules for IP addresses or URLs</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleFormSubmit} className="space-y-4">
              {/* Type Toggle */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Rule Target</label>
                <Tabs value={valueType} onValueChange={(v) => setValueType(v as "ip" | "url")}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="ip" className="gap-2">
                      <Network className="h-4 w-4" />
                      <span className="hidden sm:inline">IP Address</span>
                      <span className="sm:hidden">IP</span>
                    </TabsTrigger>
                    <TabsTrigger value="url" className="gap-2">
                      <Globe className="h-4 w-4" />
                      <span className="hidden sm:inline">URL / Domain</span>
                      <span className="sm:hidden">URL</span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                    {valueType === "ip" ? "IP Address / CIDR" : "URL / Domain"}
                  </label>
                  <Input
                    placeholder={valueType === "ip" ? "192.168.1.0/24 or 10.0.0.1" : "example.com or https://example.com/*"}
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    className="bg-background/50 border-border/40"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Rule Type</label>
                  <Select value={ruleType} onValueChange={(v) => setRuleType(v as "whitelist" | "blacklist")}>
                    <SelectTrigger className="bg-background/50 border-border/40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="whitelist">Whitelist (Allow)</SelectItem>
                      <SelectItem value="blacklist">Blacklist (Block)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Description (optional)</label>
                <Input
                  placeholder={valueType === "ip" ? "e.g., Office network" : "e.g., Blocked competitor site"}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="bg-background/50 border-border/40"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Reason (optional)</label>
                <Input
                  placeholder="e.g., Security policy"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="bg-background/50 border-border/40"
                />
              </div>

              <Button type="submit" className="w-full" disabled={!newValue}>
                <Plus className="h-4 w-4 mr-2" />
                Add Rule
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Rules List */}
        <Card className="border-border/50 bg-card/50 overflow-hidden">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Globe className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Access Rules</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Manage whitelist and blacklist rules for IPs and URLs</p>
                </div>
              </div>
              <Badge variant="secondary" className="text-xs font-medium h-6 px-2.5">
                {rules.filter(r => r.is_active).length} active
              </Badge>
            </div>

            {/* Search row */}
            <div className="flex items-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                className="h-10 px-3 gap-2 border-border/40 shrink-0"
                onClick={() => fetchRules()}
                disabled={loading}
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-y border-border/50 bg-muted/30">
                    <th className="px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Rule</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Type</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Hits</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Created</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className={cn("transition-opacity duration-200", loading && "opacity-40 pointer-events-none")}>
                  {rules.map((rule) => (
                    <tr key={rule.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors group cursor-pointer" onClick={() => setSelectedRule(rule)}>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-muted/50">
                            {rule.value_type === "url" ? (
                              <Globe className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Network className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-mono text-foreground truncate">{rule.ip_address}</p>
                            {rule.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{rule.description}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <Badge className={cn(
                          "text-[10px] px-2 py-0.5 font-medium",
                          rule.rule_type === "whitelist"
                            ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                            : "bg-destructive/10 text-destructive border-destructive/20"
                        )}>
                          {rule.rule_type === "whitelist" ? "Allow" : "Block"}
                        </Badge>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-sm font-medium text-foreground">{rule.hit_count}</span>
                      </td>
                      <td className="px-4 py-4 text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(rule.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-8 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setSelectedRule(rule) }}>
                            <Eye className="h-3.5 w-3.5" />
                            <span className="text-xs">View</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setPendingDelete(rule) }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rules.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-20 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <div className="p-4 rounded-full bg-muted/50 mb-4">
                            <Network className="h-8 w-8 text-muted-foreground/40" />
                          </div>
                          <p className="text-sm font-medium text-foreground mb-1">No rules configured</p>
                          <p className="text-xs text-muted-foreground">Add your first IP or URL rule above</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div className={cn("md:hidden flex flex-col transition-opacity duration-200", loading && "opacity-40 pointer-events-none")}>
              {rules.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <div className="p-4 rounded-full bg-muted/50 mb-4">
                    <Network className="h-8 w-8 text-muted-foreground/40" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">No rules configured</p>
                  <p className="text-xs text-muted-foreground text-center">Add your first IP or URL rule above</p>
                </div>
              )}
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center gap-3 px-5 py-4 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() => setSelectedRule(rule)}
                >
                    <div className="p-2 rounded-lg bg-muted/50 shrink-0">
                      {rule.value_type === "url" ? (
                        <Globe className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Network className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-mono text-foreground truncate">{rule.ip_address}</p>
                      <Badge className={cn(
                        "text-[10px] px-1.5 py-0 font-medium shrink-0",
                        rule.rule_type === "whitelist"
                          ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                          : "bg-destructive/10 text-destructive border-destructive/20"
                      )}>
                        {rule.rule_type === "whitelist" ? "Allow" : "Block"}
                      </Badge>
                    </div>
                    {rule.description && <p className="text-xs text-muted-foreground truncate mb-1">{rule.description}</p>}
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span>{rule.hit_count} hits</span>
                      <span className="text-border">|</span>
                      <span>{new Date(rule.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive h-8"
                    onClick={(e) => { e.stopPropagation(); setPendingDelete(rule) }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Add Rule Confirmation Modal */}
        <SaveConfirmationModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onConfirm={async () => {
            await handleAddRule()
            setShowAddModal(false)
          }}
          title="Add Access Rule"
          description={`Create a new ${ruleType} rule for ${valueType === "ip" ? "IP address" : "URL/domain"}.`}
          changes={addChangeItems}
          loading={adding}
          confirmText="Add Rule"
        />

        {/* Delete Confirmation Modal */}
        <SaveConfirmationModal
          isOpen={!!pendingDelete}
          onClose={() => setPendingDelete(null)}
          onConfirm={handleDeleteRule}
          title="Delete Access Rule"
          description="This action cannot be undone."
          changes={pendingDelete ? [
            { field: "value", label: pendingDelete.value_type === "url" ? "URL/Domain" : "IP Address", oldValue: pendingDelete.ip_address, newValue: "Removed" },
            { field: "rule_type", label: "Rule Type", oldValue: pendingDelete.rule_type, newValue: "Deleted" },
          ] : []}
          loading={deleting}
          confirmText="Delete Rule"
          variant="destructive"
        />
      </div>
    </>
  )
}
