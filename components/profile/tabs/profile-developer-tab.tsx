"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/ui/utils"
import {
  Key,
  Plus,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  Clock,
  Webhook,
  Play,
  Trash2,
  Globe,
  CalendarClock,
  Loader2,
} from "lucide-react"
import { API, APP_NAME } from "@/lib/config/constants"
import type { ProfileTabProps, ApiKey, WebhookItem, ScheduleItem } from "../types"

export function ProfileDeveloperTab({
  setError,
  setSuccess,
}: ProfileTabProps) {
  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [newKeyName, setNewKeyName] = useState("")
  const [generatingKey, setGeneratingKey] = useState(false)
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [revokingId, setRevokingId] = useState<number | null>(null)

  // Webhooks state
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([])
  const [webhookUrl, setWebhookUrl] = useState("")
  const [webhookName, setWebhookName] = useState("")
  const [addingWebhook, setAddingWebhook] = useState(false)
  const [testingWebhookId, setTestingWebhookId] = useState<number | null>(null)

  // Schedules state
  const [schedules, setSchedules] = useState<ScheduleItem[]>([])
  const [scheduleUrl, setScheduleUrl] = useState("")
  const [scheduleFreq, setScheduleFreq] = useState("weekly")
  const [addingSchedule, setAddingSchedule] = useState(false)

  const [loading, setLoading] = useState(true)

  // Filter with null safety - ensure k exists and has expected properties
  const activeKeys = apiKeys.filter((k) => k && typeof k === 'object' && !k.revoked_at)
  const revokedKeys = apiKeys.filter((k) => k && typeof k === 'object' && k.revoked_at)

  const fetchData = useCallback(async () => {
    try {
      const [keysRes, webhooksRes, schedulesRes] = await Promise.all([
        fetch(API.KEYS),
        fetch(API.WEBHOOKS),
        fetch(API.SCHEDULES),
      ])

      const keysData = keysRes.ok ? await keysRes.json() : []
      const webhooksData = webhooksRes.ok ? await webhooksRes.json() : []
      const schedulesData = schedulesRes.ok ? await schedulesRes.json() : []

      setApiKeys(Array.isArray(keysData) ? keysData : [])
      setWebhooks(Array.isArray(webhooksData) ? webhooksData : [])
      setSchedules(Array.isArray(schedulesData) ? schedulesData : [])
    } catch {
      setError("Failed to load developer settings.")
    } finally {
      setLoading(false)
    }
  }, [setError])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // API Key handlers
  async function handleGenerateKey() {
    if (activeKeys.length >= 3) {
      setError("Maximum 3 active keys allowed.")
      return
    }
    setGeneratingKey(true)
    setError(null)
    try {
      const res = await fetch(API.KEYS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName || "Unnamed Key" }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to generate key.")
        return
      }
      setNewlyCreatedKey(data.key)
      setApiKeys((prev) => [data.keyRecord, ...prev])
      setNewKeyName("")
      setSuccess("API key generated successfully!")
    } catch {
      setError("Failed to generate key.")
    } finally {
      setGeneratingKey(false)
    }
  }

  async function handleRotateKey(keyId: number) {
    setRevokingId(keyId)
    setError(null)
    try {
      const res = await fetch(API.KEYS, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId, action: "rotate" }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to rotate key.")
        return
      }
      setNewlyCreatedKey(data.key)
      setApiKeys((prev) =>
        prev.map((k) => (k.id === keyId ? { ...k, revoked_at: new Date().toISOString() } : k))
          .concat([data.keyRecord])
      )
      setSuccess("Key rotated successfully! Copy the new key now.")
    } catch {
      setError("Failed to rotate key.")
    } finally {
      setRevokingId(null)
    }
  }

  function handleCopyKey() {
    if (newlyCreatedKey) {
      navigator.clipboard.writeText(newlyCreatedKey)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "Never"
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {/* API Keys Section */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
<div className="p-2 rounded-lg bg-primary/10">
            <Key className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">API Keys</h2>
              <p className="text-sm text-muted-foreground">Rate limit based on your plan, max 3 keys</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" asChild>
            <a href="/docs">View Docs</a>
          </Button>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 flex flex-col gap-4">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Newly created key display */}
                {newlyCreatedKey && (
              <div className="p-4 rounded-lg border border-primary/30 bg-primary/5">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground">New API Key Generated</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Copy this key now. You will not be able to see it again.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-secondary px-3 py-2 rounded-md font-mono text-foreground overflow-x-auto">
                      {showKey ? newlyCreatedKey : (typeof newlyCreatedKey === 'string' ? newlyCreatedKey.slice(0, 12) + "..." + "*".repeat(32) : "...")}
                    </code>
                    <Button variant="ghost" size="icon" onClick={() => setShowKey(!showKey)} className="shrink-0">
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleCopyKey} className="shrink-0">
                      {copiedKey ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Generate new key */}
            <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-secondary/30">
              <Label htmlFor="key-name" className="text-sm font-medium">Generate New Key</Label>
              <div className="flex gap-2">
                <Input
                  id="key-name"
                  placeholder="Key name (e.g. Production, CI/CD)"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="bg-card h-10"
                  maxLength={100}
                  onKeyDown={(e) => { if (e.key === "Enter" && activeKeys.length < 3) handleGenerateKey() }}
                />
                <Button onClick={handleGenerateKey} disabled={generatingKey || activeKeys.length >= 3} className="shrink-0 h-10">
                  <Plus className="mr-2 h-4 w-4" />
                  {generatingKey ? "Generating..." : "Generate"}
                </Button>
              </div>
              {activeKeys.length >= 3 && (
                <p className="text-xs text-muted-foreground">Maximum 3 active keys. Revoke an existing key to create a new one.</p>
              )}
            </div>

            {/* Active keys */}
            {activeKeys.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-foreground">Active Keys ({activeKeys.length}/3)</h3>
                {activeKeys.map((key) => (
                  <div key={key.id} className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-card">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium text-foreground truncate">{key.name}</span>
                        <Badge variant="outline" className="text-xs font-mono text-muted-foreground shrink-0">{key.key_prefix}...</Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRotateKey(key.id)}
                        disabled={revokingId === key.id}
                        className="text-muted-foreground hover:text-foreground h-8 gap-1.5"
                        aria-label="Rotate key"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", revokingId === key.id && "animate-spin")} />
                        <span className="hidden sm:inline">Rotate</span>
                      </Button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Usage today</span>
                        <span>{key.usage_today} / {key.daily_limit} requests</span>
                      </div>
                      <Progress value={(key.usage_today / key.daily_limit) * 100} className="h-2" />
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3 shrink-0" />
                        Created {formatDate(key.created_at)}
                      </span>
                      {key.last_used_at && <span>Last used {formatDate(key.last_used_at)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {activeKeys.length === 0 && !newlyCreatedKey && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <Key className="h-10 w-10 text-muted-foreground/50" />
                <p className="text-sm font-medium text-foreground">No API keys yet</p>
                <p className="text-xs text-muted-foreground">Generate a key above to start using the {APP_NAME} API.</p>
              </div>
            )}

            {/* Revoked keys */}
            {revokedKeys.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-muted-foreground">Revoked Keys ({revokedKeys.length})</h3>
                {revokedKeys.map((key) => (
                  <div key={key.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg border border-border bg-secondary/20 opacity-60">
                    <div className="flex items-center gap-2 min-w-0">
                      <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-muted-foreground line-through truncate">{key.name}</span>
                      <Badge variant="outline" className="text-xs font-mono text-muted-foreground shrink-0">{key.key_prefix}...</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">Revoked {formatDate(key.revoked_at)}</span>
                  </div>
                ))}
              </div>
            )}
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Webhooks Section */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Webhook className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Webhooks</h2>
            <p className="text-sm text-muted-foreground">Discord, Slack, and JSON webhook notifications</p>
          </div>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 space-y-4">
            {/* Add webhook form */}
            <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-secondary/30">
              <Label className="text-sm font-medium">Add Endpoint</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="Name (e.g. Discord Alerts)"
                  value={webhookName}
                  onChange={(e) => setWebhookName(e.target.value)}
                  className="sm:w-44 bg-card h-10"
                />
                <Input
                  placeholder="https://discord.com/api/webhooks/..."
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="flex-1 bg-card h-10"
                />
                <Button
                  disabled={!webhookUrl || addingWebhook}
                  onClick={async () => {
                    setAddingWebhook(true)
                    try {
                      const res = await fetch(API.WEBHOOKS, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ url: webhookUrl, name: webhookName || "Default", type: "auto" }),
                      })
                      const data = await res.json()
                      if (res.ok) {
                        setWebhooks((prev) => [data, ...prev])
                        setWebhookUrl("")
                        setWebhookName("")
                        setSuccess(`Webhook added (detected as ${data.type}).`)
                      } else {
                        setError(data.error || "Failed to add webhook.")
                      }
                    } catch { setError("Failed to add webhook.") }
                    setAddingWebhook(false)
                  }}
                  className="shrink-0"
                >
                  {addingWebhook ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  <span className="ml-1.5">Add</span>
                </Button>
              </div>
            </div>

            {/* Webhook list */}
            {webhooks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No webhooks configured yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {webhooks.map((wh) => (
                  <div key={wh.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary/30 border border-border">
                    {wh.type === "discord" ? (
                      <svg className="h-4 w-4 text-[#5865F2] shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>
                    ) : wh.type === "slack" ? (
                      <svg className="h-4 w-4 text-[#E01E5A] shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z" /></svg>
                    ) : (
                      <Globe className="h-4 w-4 text-primary shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{wh.name}</p>
                        <span className={cn(
                          "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border",
                          wh.type === "discord" ? "bg-[#5865F2]/10 text-[#5865F2] border-[#5865F2]/20" :
                            wh.type === "slack" ? "bg-[#E01E5A]/10 text-[#E01E5A] border-[#E01E5A]/20" :
                              "bg-muted text-muted-foreground border-border"
                        )}>
                          {wh.type}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{wh.url}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
                        disabled={testingWebhookId === wh.id}
                        onClick={async () => {
                          setTestingWebhookId(wh.id)
                          try {
                            const res = await fetch(API.WEBHOOKS, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: wh.id }),
                            })
                            const data = await res.json()
                            if (res.ok) {
                              setSuccess("Test webhook sent successfully!")
                            } else {
                              setError(data.error || "Failed to test webhook")
                            }
                          } catch {
                            setError("Failed to test webhook")
                          }
                          setTestingWebhookId(null)
                        }}
                        title="Send test webhook"
                      >
                        {testingWebhookId === wh.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive dark:text-red-400 hover:text-destructive dark:hover:text-red-400 hover:bg-destructive/10"
                        onClick={async () => {
                          await fetch(API.WEBHOOKS, {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ id: wh.id }),
                          })
                          setWebhooks((prev) => prev.filter((w) => w.id !== wh.id))
                        }}
                        title="Delete webhook"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Scheduled Scans Section */}
      <section>
        <div className="flex items-center gap-3 mb-4">
<div className="p-2 rounded-lg bg-primary/10">
            <CalendarClock className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Scheduled Scans</h2>
            <p className="text-sm text-muted-foreground">Automate recurring vulnerability scans</p>
          </div>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 space-y-4">
            {/* Add schedule form */}
            <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-secondary/30">
              <Label className="text-sm font-medium">Add Schedule</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="https://example.com"
                  value={scheduleUrl}
                  onChange={(e) => setScheduleUrl(e.target.value)}
                  className="flex-1 bg-card h-10"
                />
                <select
                  value={scheduleFreq}
                  onChange={(e) => setScheduleFreq(e.target.value)}
                  className="h-10 px-3 rounded-md border border-border bg-card text-foreground text-sm"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <Button
                  disabled={!scheduleUrl || addingSchedule}
                  onClick={async () => {
                    setAddingSchedule(true)
                    try {
                      const res = await fetch(API.SCHEDULES, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ url: scheduleUrl, frequency: scheduleFreq }),
                      })
                      const data = await res.json()
                      if (res.ok) {
                        setSchedules((prev) => [data, ...prev])
                        setScheduleUrl("")
                        setSuccess("Schedule created successfully.")
                      } else {
                        setError(data.error || "Failed to create schedule.")
                      }
                    } catch { setError("Failed to create schedule.") }
                    setAddingSchedule(false)
                  }}
                  className="shrink-0"
                >
                  {addingSchedule ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  <span className="ml-1.5">Add</span>
                </Button>
              </div>
            </div>

            {/* Schedule list */}
            {schedules.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No scheduled scans configured yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {schedules.map((sch) => (
                  <div key={sch.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary/30 border border-border">
                    <CalendarClock className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{sch.url}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 uppercase font-semibold">
                          {sch.frequency}
                        </Badge>
                        {sch.next_run && (
                          <span>Next: {new Date(sch.next_run).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        )}
                        {sch.last_run && (
                          <span>Last: {new Date(sch.last_run).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive dark:text-red-400 hover:text-destructive dark:hover:text-red-400 hover:bg-destructive/10 shrink-0"
                      onClick={async () => {
                        await fetch(API.SCHEDULES, {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: sch.id }),
                        })
                        setSchedules((prev) => prev.filter((s) => s.id !== sch.id))
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg bg-muted/50 border border-border p-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Scheduled scans run automatically at the configured frequency. Results are saved to your scan history and any active webhooks will be notified. Schedules require an active API key.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
