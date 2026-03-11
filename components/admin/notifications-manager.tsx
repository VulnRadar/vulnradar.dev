"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Bell,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertTriangle,
  Info,
  CheckCircle,
  XCircle,
  ExternalLink,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface AdminNotification {
  id: number
  title: string
  message: string
  type: "banner" | "modal" | "toast" | "bell"
  variant: "info" | "success" | "warning" | "error"
  audience: "all" | "authenticated" | "unauthenticated" | "admin" | "staff"
  path_pattern: string | null
  starts_at: string
  ends_at: string | null
  is_active: boolean
  is_dismissible: boolean
  dismiss_duration_hours: number | null
  action_label: string | null
  action_url: string | null
  action_external: boolean
  priority: number
  created_at: string
  updated_at: string
}

const VARIANT_STYLES = {
  info: { bg: "bg-primary/10", text: "text-primary", icon: Info },
  success: { bg: "bg-emerald-500/10", text: "text-emerald-500", icon: CheckCircle },
  warning: { bg: "bg-amber-500/10", text: "text-amber-500", icon: AlertTriangle },
  error: { bg: "bg-destructive/10", text: "text-destructive", icon: XCircle },
}

const TYPE_LABELS = {
  banner: "Banner",
  modal: "Modal",
  toast: "Toast",
  bell: "Bell Notification",
}

const AUDIENCE_LABELS = {
  all: "Everyone",
  authenticated: "Logged In Users",
  unauthenticated: "Guests Only",
  admin: "Admins Only",
  staff: "Staff Only",
}

export function NotificationsManager() {
  const [notifications, setNotifications] = useState<AdminNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingNotification, setEditingNotification] = useState<AdminNotification | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    title: "",
    message: "",
    type: "bell" as AdminNotification["type"],
    variant: "info" as AdminNotification["variant"],
    audience: "all" as AdminNotification["audience"],
    path_pattern: "",
    starts_at: "",
    ends_at: "",
    is_active: true,
    is_dismissible: true,
    dismiss_duration_hours: "",
    action_label: "",
    action_url: "",
    action_external: false,
    priority: "0",
  })

  const fetchNotifications = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/v2/admin/notifications")
      if (!res.ok) throw new Error("Failed to fetch notifications")
      const data = await res.json()
      setNotifications(data.notifications || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notifications")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchNotifications()
  }, [])

  const openCreateDialog = () => {
    setFormData({
      title: "",
      message: "",
      type: "bell",
      variant: "info",
      audience: "all",
      path_pattern: "",
      starts_at: new Date().toISOString().slice(0, 16),
      ends_at: "",
      is_active: true,
      is_dismissible: true,
      dismiss_duration_hours: "",
      action_label: "",
      action_url: "",
      action_external: false,
      priority: "0",
    })
    setEditingNotification(null)
    setIsCreating(true)
  }

  const openEditDialog = (notif: AdminNotification) => {
    setFormData({
      title: notif.title,
      message: notif.message,
      type: notif.type,
      variant: notif.variant,
      audience: notif.audience,
      path_pattern: notif.path_pattern || "",
      starts_at: notif.starts_at ? new Date(notif.starts_at).toISOString().slice(0, 16) : "",
      ends_at: notif.ends_at ? new Date(notif.ends_at).toISOString().slice(0, 16) : "",
      is_active: notif.is_active,
      is_dismissible: notif.is_dismissible,
      dismiss_duration_hours: notif.dismiss_duration_hours?.toString() || "",
      action_label: notif.action_label || "",
      action_url: notif.action_url || "",
      action_external: notif.action_external,
      priority: notif.priority.toString(),
    })
    setEditingNotification(notif)
    setIsCreating(true)
  }

  const closeDialog = () => {
    setIsCreating(false)
    setEditingNotification(null)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        title: formData.title,
        message: formData.message,
        type: formData.type,
        variant: formData.variant,
        audience: formData.audience,
        path_pattern: formData.path_pattern || null,
        starts_at: formData.starts_at ? new Date(formData.starts_at).toISOString() : null,
        ends_at: formData.ends_at ? new Date(formData.ends_at).toISOString() : null,
        is_active: formData.is_active,
        is_dismissible: formData.is_dismissible,
        dismiss_duration_hours: formData.dismiss_duration_hours ? parseInt(formData.dismiss_duration_hours) : null,
        action_label: formData.action_label || null,
        action_url: formData.action_url || null,
        action_external: formData.action_external,
        priority: parseInt(formData.priority) || 0,
      }

      const url = editingNotification
        ? `/api/v2/admin/notifications/${editingNotification.id}`
        : "/api/v2/admin/notifications"
      const method = editingNotification ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) throw new Error("Failed to save notification")

      await fetchNotifications()
      closeDialog()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this notification?")) return
    try {
      const res = await fetch(`/api/v2/admin/notifications/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete")
      await fetchNotifications()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete")
    }
  }

  const handleToggleActive = async (notif: AdminNotification) => {
    try {
      const res = await fetch(`/api/v2/admin/notifications/${notif.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...notif, is_active: !notif.is_active }),
      })
      if (!res.ok) throw new Error("Failed to update")
      await fetchNotifications()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Manage site-wide notifications, banners, and alerts.
        </p>
        <Button size="sm" onClick={openCreateDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          Create Notification
        </Button>
      </div>

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Bell className="h-12 w-12 mx-auto mb-4 opacity-20" />
          <p>No notifications created yet.</p>
          <p className="text-sm">Click &quot;Create Notification&quot; to add one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif) => {
            const variantStyle = VARIANT_STYLES[notif.variant]
            const Icon = variantStyle.icon
            return (
              <div
                key={notif.id}
                className={cn(
                  "group p-4 rounded-xl border border-border bg-card hover:border-primary/20 hover:bg-muted/30 transition-all",
                  !notif.is_active && "opacity-60"
                )}
              >
                <div className="flex items-start gap-4">
                  <div className={cn("p-2.5 rounded-lg shrink-0 transition-colors", variantStyle.bg, "group-hover:scale-105")}>
                    <Icon className={cn("h-4 w-4", variantStyle.text)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h4 className="font-semibold text-sm text-foreground">{notif.title}</h4>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {TYPE_LABELS[notif.type]}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {AUDIENCE_LABELS[notif.audience]}
                      </Badge>
                      {!notif.is_active && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-muted">
                          Inactive
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{notif.message}</p>
                    {notif.action_url && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-primary font-medium">
                        <span>{notif.action_label || "Action"}</span>
                        {notif.action_external && <ExternalLink className="h-3 w-3" />}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch
                      checked={notif.is_active}
                      onCheckedChange={() => handleToggleActive(notif)}
                      aria-label="Toggle active"
                    />
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => openEditDialog(notif)}
                      className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => handleDelete(notif.id)}
                      className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isCreating} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingNotification ? "Edit Notification" : "Create Notification"}
            </DialogTitle>
            <DialogDescription>
              Configure the notification settings below.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            {/* Content Section */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Content</h4>
              <div className="grid gap-4 p-4 rounded-lg border border-border bg-muted/30">
                <div className="grid gap-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Notification title"
                    className="bg-background"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    placeholder="Notification message content"
                    rows={3}
                    className="bg-background"
                  />
                </div>
              </div>
            </div>

            {/* Display Settings Section */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Display Settings</h4>
              <div className="grid gap-4 p-4 rounded-lg border border-border bg-muted/30">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Type</Label>
                    <Select
                      value={formData.type}
                      onValueChange={(v) => setFormData({ ...formData, type: v as AdminNotification["type"] })}
                    >
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bell">Bell Notification</SelectItem>
                        <SelectItem value="banner">Banner</SelectItem>
                        <SelectItem value="modal">Modal</SelectItem>
                        <SelectItem value="toast">Toast</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Variant</Label>
                    <Select
                      value={formData.variant}
                      onValueChange={(v) => setFormData({ ...formData, variant: v as AdminNotification["variant"] })}
                    >
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="success">Success</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            {/* Targeting Section */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Targeting</h4>
              <div className="grid gap-4 p-4 rounded-lg border border-border bg-muted/30">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Audience</Label>
                    <Select
                      value={formData.audience}
                      onValueChange={(v) => setFormData({ ...formData, audience: v as AdminNotification["audience"] })}
                    >
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Everyone</SelectItem>
                        <SelectItem value="authenticated">Logged In Users</SelectItem>
                        <SelectItem value="unauthenticated">Guests Only</SelectItem>
                        <SelectItem value="admin">Admins Only</SelectItem>
                        <SelectItem value="staff">Staff Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="priority">Priority (higher = shown first)</Label>
                    <Input
                      id="priority"
                      type="number"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                      placeholder="0"
                      className="bg-background"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="path_pattern">Page Filter (optional)</Label>
                  <Input
                    id="path_pattern"
                    value={formData.path_pattern}
                    onChange={(e) => setFormData({ ...formData, path_pattern: e.target.value })}
                    placeholder="/dashboard* or leave empty for all pages"
                    className="bg-background"
                  />
                </div>
              </div>
            </div>

            {/* Scheduling Section */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Scheduling & Behavior</h4>
              <div className="grid gap-4 p-4 rounded-lg border border-border bg-muted/30">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="starts_at">Starts At</Label>
                    <Input
                      id="starts_at"
                      type="datetime-local"
                      value={formData.starts_at}
                      onChange={(e) => setFormData({ ...formData, starts_at: e.target.value })}
                      className="bg-background"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ends_at">Ends At (optional)</Label>
                    <Input
                      id="ends_at"
                      type="datetime-local"
                      value={formData.ends_at}
                      onChange={(e) => setFormData({ ...formData, ends_at: e.target.value })}
                      className="bg-background"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-6 pt-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="is_active"
                      checked={formData.is_active}
                      onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                    />
                    <Label htmlFor="is_active" className="cursor-pointer">Active</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="is_dismissible"
                      checked={formData.is_dismissible}
                      onCheckedChange={(checked) => setFormData({ ...formData, is_dismissible: checked })}
                    />
                    <Label htmlFor="is_dismissible" className="cursor-pointer">Dismissible</Label>
                  </div>
                </div>
                {formData.is_dismissible && (
                  <div className="grid gap-2">
                    <Label htmlFor="dismiss_duration_hours">Re-show after dismiss (hours)</Label>
                    <Input
                      id="dismiss_duration_hours"
                      type="number"
                      value={formData.dismiss_duration_hours}
                      onChange={(e) => setFormData({ ...formData, dismiss_duration_hours: e.target.value })}
                      placeholder="Leave empty for permanent dismiss"
                      className="bg-background"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Action Button Section */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Action Button (optional)</h4>
              <div className="grid gap-4 p-4 rounded-lg border border-border bg-muted/30">
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    value={formData.action_label}
                    onChange={(e) => setFormData({ ...formData, action_label: e.target.value })}
                    placeholder="Button label"
                    className="bg-background"
                  />
                  <Input
                    value={formData.action_url}
                    onChange={(e) => setFormData({ ...formData, action_url: e.target.value })}
                    placeholder="URL or path"
                    className="bg-background"
                  />
                </div>
                {formData.action_url && (
                  <div className="flex items-center gap-2">
                    <Switch
                      id="action_external"
                      checked={formData.action_external}
                      onCheckedChange={(checked) => setFormData({ ...formData, action_external: checked })}
                    />
                    <Label htmlFor="action_external" className="cursor-pointer">Open in new tab</Label>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !formData.title || !formData.message}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingNotification ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
