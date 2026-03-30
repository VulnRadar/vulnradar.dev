"use client"

import { useState, useEffect } from "react"
import {
  Code,
  Key,
  Webhook,
  Plus,
  Loader2,
  Copy,
  Check,
  Trash2,
  Eye,
  EyeOff,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { API } from "@/lib/config/constants"
import { useProfile } from "../profile-context"
import { getRelativeTime, maskApiKey, formatDate } from "../profile-types"
import type { ApiKey, Webhook as WebhookType } from "../profile-types"

const WEBHOOK_EVENTS = [
  { id: "scan.complete", label: "Scan Complete" },
  { id: "scan.failed", label: "Scan Failed" },
  { id: "vulnerability.found", label: "Vulnerability Found" },
  { id: "vulnerability.critical", label: "Critical Vulnerability" },
]

const API_SCOPES = [
  { id: "scan:read", label: "Read Scans" },
  { id: "scan:write", label: "Create Scans" },
  { id: "history:read", label: "Read History" },
  { id: "share:write", label: "Create Shares" },
]

export function ProfileDeveloperTab() {
  const { apiKeys, setApiKeys, webhooks, setWebhooks } = useProfile()

  const [isLoadingKeys, setIsLoadingKeys] = useState(true)
  const [isLoadingWebhooks, setIsLoadingWebhooks] = useState(true)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [showNewWebhookDialog, setShowNewWebhookDialog] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["scan:read", "scan:write"])
  const [newKeyExpiry, setNewKeyExpiry] = useState("never")
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [isCreatingKey, setIsCreatingKey] = useState(false)
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const [newWebhookUrl, setNewWebhookUrl] = useState("")
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>(["scan.complete"])
  const [isCreatingWebhook, setIsCreatingWebhook] = useState(false)

  useEffect(() => {
    fetchApiKeys()
    fetchWebhooks()
  }, [])

  const fetchApiKeys = async () => {
    try {
      setIsLoadingKeys(true)
      const res = await fetch(`${API.ME}/api-keys`, { credentials: "include" })
      if (res.ok) {
        const data = await res.json()
        setApiKeys(data.keys || [])
      }
    } catch (error) {
      console.error("Failed to fetch API keys:", error)
    } finally {
      setIsLoadingKeys(false)
    }
  }

  const fetchWebhooks = async () => {
    try {
      setIsLoadingWebhooks(true)
      const res = await fetch(`${API.ME}/webhooks`, { credentials: "include" })
      if (res.ok) {
        const data = await res.json()
        setWebhooks(data.webhooks || [])
      }
    } catch (error) {
      console.error("Failed to fetch webhooks:", error)
    } finally {
      setIsLoadingWebhooks(false)
    }
  }

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) {
      toast.error("Please enter a name for the API key")
      return
    }

    setIsCreatingKey(true)
    try {
      const res = await fetch(`${API.ME}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: newKeyName,
          scopes: newKeyScopes,
          expiresIn: newKeyExpiry === "never" ? null : newKeyExpiry,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setCreatedKey(data.key)
        setApiKeys([...apiKeys, data.apiKey])
        toast.success("API key created")
      } else {
        toast.error("Failed to create API key")
      }
    } catch (error) {
      toast.error("Failed to create API key")
    } finally {
      setIsCreatingKey(false)
    }
  }

  const handleDeleteKey = async (keyId: string) => {
    try {
      const res = await fetch(`${API.ME}/api-keys/${keyId}`, {
        method: "DELETE",
        credentials: "include",
      })

      if (res.ok) {
        setApiKeys(apiKeys.filter((k) => k.id !== keyId))
        toast.success("API key deleted")
      } else {
        toast.error("Failed to delete API key")
      }
    } catch (error) {
      toast.error("Failed to delete API key")
    }
  }

  const handleCreateWebhook = async () => {
    if (!newWebhookUrl.trim()) {
      toast.error("Please enter a webhook URL")
      return
    }

    try {
      new URL(newWebhookUrl)
    } catch {
      toast.error("Please enter a valid URL")
      return
    }

    setIsCreatingWebhook(true)
    try {
      const res = await fetch(`${API.ME}/webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          url: newWebhookUrl,
          events: newWebhookEvents,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setWebhooks([...webhooks, data.webhook])
        setShowNewWebhookDialog(false)
        setNewWebhookUrl("")
        setNewWebhookEvents(["scan.complete"])
        toast.success("Webhook created")
      } else {
        toast.error("Failed to create webhook")
      }
    } catch (error) {
      toast.error("Failed to create webhook")
    } finally {
      setIsCreatingWebhook(false)
    }
  }

  const handleToggleWebhook = async (webhookId: string, enabled: boolean) => {
    try {
      const res = await fetch(`${API.ME}/webhooks/${webhookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled }),
      })

      if (res.ok) {
        setWebhooks(webhooks.map((w) => (w.id === webhookId ? { ...w, enabled } : w)))
        toast.success(enabled ? "Webhook enabled" : "Webhook disabled")
      } else {
        toast.error("Failed to update webhook")
      }
    } catch (error) {
      toast.error("Failed to update webhook")
    }
  }

  const handleDeleteWebhook = async (webhookId: string) => {
    try {
      const res = await fetch(`${API.ME}/webhooks/${webhookId}`, {
        method: "DELETE",
        credentials: "include",
      })

      if (res.ok) {
        setWebhooks(webhooks.filter((w) => w.id !== webhookId))
        toast.success("Webhook deleted")
      } else {
        toast.error("Failed to delete webhook")
      }
    } catch (error) {
      toast.error("Failed to delete webhook")
    }
  }

  const handleTestWebhook = async (webhookId: string) => {
    try {
      const res = await fetch(`${API.ME}/webhooks/${webhookId}/test`, {
        method: "POST",
        credentials: "include",
      })

      if (res.ok) {
        toast.success("Test webhook sent")
      } else {
        toast.error("Failed to send test webhook")
      }
    } catch (error) {
      toast.error("Failed to send test webhook")
    }
  }

  const copyToClipboard = (text: string, keyId: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(keyId)
    toast.success("Copied to clipboard")
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const toggleKeyVisibility = (keyId: string) => {
    const newRevealed = new Set(revealedKeys)
    if (newRevealed.has(keyId)) {
      newRevealed.delete(keyId)
    } else {
      newRevealed.add(keyId)
    }
    setRevealedKeys(newRevealed)
  }

  return (
    <div className="space-y-6">
      {/* API Keys */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Key className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground">API Keys</h3>
              <p className="text-xs text-muted-foreground">Manage your API keys for programmatic access</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowNewKeyDialog(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Key
          </Button>
        </div>

        {isLoadingKeys ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="text-center py-8">
            <Key className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No API keys yet</p>
            <p className="text-xs text-muted-foreground">Create one to access the API programmatically</p>
          </div>
        ) : (
          <div className="space-y-3">
            {apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-foreground">{key.name}</p>
                    {key.expiresAt && new Date(key.expiresAt) < new Date() && (
                      <Badge variant="outline" className="text-destructive border-destructive/30 bg-destructive/10 text-[10px]">
                        Expired
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {revealedKeys.has(key.id) ? key.key : maskApiKey(key.key)}
                    </code>
                    <button
                      onClick={() => toggleKeyVisibility(key.id)}
                      className="p-1 hover:bg-muted rounded"
                    >
                      {revealedKeys.has(key.id) ? (
                        <EyeOff className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <Eye className="h-3 w-3 text-muted-foreground" />
                      )}
                    </button>
                    <button
                      onClick={() => copyToClipboard(key.key, key.id)}
                      className="p-1 hover:bg-muted rounded"
                    >
                      {copiedKey === key.id ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Created {formatDate(key.createdAt)} · Last used {getRelativeTime(key.lastUsed)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteKey(key.id)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Webhooks */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Webhook className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground">Webhooks</h3>
              <p className="text-xs text-muted-foreground">Receive notifications for scan events</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowNewWebhookDialog(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Webhook
          </Button>
        </div>

        {isLoadingWebhooks ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : webhooks.length === 0 ? (
          <div className="text-center py-8">
            <Webhook className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No webhooks yet</p>
            <p className="text-xs text-muted-foreground">Create one to receive real-time notifications</p>
          </div>
        ) : (
          <div className="space-y-3">
            {webhooks.map((webhook) => (
              <div
                key={webhook.id}
                className="p-3 rounded-lg bg-muted/30 border border-border/50"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Switch
                      checked={webhook.enabled}
                      onCheckedChange={(enabled) => handleToggleWebhook(webhook.id, enabled)}
                    />
                    <code className="text-xs font-mono text-muted-foreground truncate">
                      {webhook.url}
                    </code>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleTestWebhook(webhook.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteWebhook(webhook.id)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {webhook.events.map((event) => (
                    <Badge key={event} variant="outline" className="text-[10px]">
                      {event}
                    </Badge>
                  ))}
                </div>
                {webhook.failureCount > 0 && (
                  <p className="text-[10px] text-amber-500 mt-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {webhook.failureCount} recent failures
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* API Documentation Link */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Code className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground">API Documentation</h3>
              <p className="text-xs text-muted-foreground">Learn how to integrate with the VulnRadar API</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href="/docs/api" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              View Docs
            </a>
          </Button>
        </div>
      </Card>

      {/* New API Key Dialog */}
      <Dialog open={showNewKeyDialog} onOpenChange={(open) => {
        setShowNewKeyDialog(open)
        if (!open) {
          setNewKeyName("")
          setNewKeyScopes(["scan:read", "scan:write"])
          setNewKeyExpiry("never")
          setCreatedKey(null)
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createdKey ? "API Key Created" : "Create API Key"}</DialogTitle>
            <DialogDescription>
              {createdKey
                ? "Copy your API key now. You won't be able to see it again."
                : "Create a new API key for programmatic access."}
            </DialogDescription>
          </DialogHeader>

          {createdKey ? (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-sm font-mono break-all">{createdKey}</code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(createdKey, "new")}
                  >
                    {copiedKey === "new" ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Make sure to copy your API key now. You won&apos;t be able to see it again!
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="key-name" className="text-xs">Name</Label>
                <Input
                  id="key-name"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="My API Key"
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Expiration</Label>
                <Select value={newKeyExpiry} onValueChange={setNewKeyExpiry}>
                  <SelectTrigger className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never</SelectItem>
                    <SelectItem value="30d">30 days</SelectItem>
                    <SelectItem value="90d">90 days</SelectItem>
                    <SelectItem value="1y">1 year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Scopes</Label>
                <div className="grid grid-cols-2 gap-2">
                  {API_SCOPES.map((scope) => (
                    <label
                      key={scope.id}
                      className="flex items-center gap-2 p-2 rounded-lg border border-border/50 cursor-pointer hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={newKeyScopes.includes(scope.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewKeyScopes([...newKeyScopes, scope.id])
                          } else {
                            setNewKeyScopes(newKeyScopes.filter((s) => s !== scope.id))
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-xs">{scope.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {createdKey ? (
              <Button onClick={() => setShowNewKeyDialog(false)}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setShowNewKeyDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateKey} disabled={isCreatingKey}>
                  {isCreatingKey ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-1.5" />
                  )}
                  Create Key
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Webhook Dialog */}
      <Dialog open={showNewWebhookDialog} onOpenChange={setShowNewWebhookDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Webhook</DialogTitle>
            <DialogDescription>
              Configure a webhook to receive notifications for scan events.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-url" className="text-xs">URL</Label>
              <Input
                id="webhook-url"
                value={newWebhookUrl}
                onChange={(e) => setNewWebhookUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Events</Label>
              <div className="grid grid-cols-2 gap-2">
                {WEBHOOK_EVENTS.map((event) => (
                  <label
                    key={event.id}
                    className="flex items-center gap-2 p-2 rounded-lg border border-border/50 cursor-pointer hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={newWebhookEvents.includes(event.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setNewWebhookEvents([...newWebhookEvents, event.id])
                        } else {
                          setNewWebhookEvents(newWebhookEvents.filter((ev) => ev !== event.id))
                        }
                      }}
                      className="rounded"
                    />
                    <span className="text-xs">{event.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewWebhookDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateWebhook} disabled={isCreatingWebhook}>
              {isCreatingWebhook ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-1.5" />
              )}
              Create Webhook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
