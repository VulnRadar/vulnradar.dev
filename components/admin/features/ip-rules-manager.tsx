"use client"

import React, { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Plus, Trash2, RefreshCw, Globe, Network } from "lucide-react"
import { cn } from "@/lib/utils"

interface AccessRule {
  id: number
  rule_type: "whitelist" | "blacklist"
  value_type: "ip" | "url"
  ip_address: string // Can be IP or URL
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
  const [newValue, setNewValue] = useState("")
  const [valueType, setValueType] = useState<"ip" | "url">("ip")
  const [ruleType, setRuleType] = useState<"whitelist" | "blacklist">("blacklist")
  const [description, setDescription] = useState("")
  const [reason, setReason] = useState("")

  const fetchRules = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", section: "ip_rules" }),
      })
      const data = await res.json()
      setRules(data.rules || [])
    } catch (error) {
      console.error("Error fetching IP rules:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRules()
  }, [])

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newValue) return

    try {
      const res = await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          section: "ip_rules",
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
    }
  }

  const handleDeleteRule = async (id: number) => {
    try {
      await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          section: "ip_rules",
          id,
        }),
      })
      await fetchRules()
    } catch (error) {
      console.error("Error deleting IP rule:", error)
    }
  }

  return (
    <div className="space-y-6">
      {/* Add Rule Card */}
      <Card>
        <CardHeader>
          <CardTitle>Add Access Rule</CardTitle>
          <CardDescription>Create whitelist or blacklist rules for IP addresses or URLs</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddRule} className="space-y-4">
            {/* Type Toggle */}
            <div>
              <label className="text-sm font-medium mb-2 block">Rule Target</label>
              <Tabs value={valueType} onValueChange={(v) => setValueType(v as "ip" | "url")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="ip" className="gap-2">
                    <Network className="h-4 w-4" />
                    IP Address
                  </TabsTrigger>
                  <TabsTrigger value="url" className="gap-2">
                    <Globe className="h-4 w-4" />
                    URL / Domain
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  {valueType === "ip" ? "IP Address" : "URL / Domain"}
                </label>
                <Input
                  placeholder={valueType === "ip" ? "192.168.1.0/24 or 10.0.0.1" : "example.com or https://example.com/*"}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Rule Type</label>
                <Select value={ruleType} onValueChange={(v) => setRuleType(v as "whitelist" | "blacklist")}>
                  <SelectTrigger>
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
              <label className="text-sm font-medium mb-2 block">Description (optional)</label>
              <Input
                placeholder={valueType === "ip" ? "e.g., Office network" : "e.g., Blocked competitor site"}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Reason (optional)</label>
              <Input
                placeholder="e.g., Security policy"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Add Rule
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Rules List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Access Rules</CardTitle>
              <CardDescription>Active whitelist and blacklist rules for IPs and URLs</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchRules} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No access rules configured</p>
            ) : (
              rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {rule.value_type === "url" ? (
                        <Globe className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Network className="h-4 w-4 text-muted-foreground" />
                      )}
                      <code className="text-sm bg-muted px-2 py-1 rounded font-mono">{rule.ip_address}</code>
                      <Badge variant={rule.rule_type === "whitelist" ? "default" : "destructive"}>
                        {rule.rule_type}
                      </Badge>
                    </div>
                    {rule.description && <p className="text-sm text-muted-foreground">{rule.description}</p>}
                    <p className="text-xs text-muted-foreground mt-1">Hit count: {rule.hit_count}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteRule(rule.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
