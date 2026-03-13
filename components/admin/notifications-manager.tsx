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
  Megaphone,
  Eye,
  EyeOff,
  Clock,
  Users,
  Layers,
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

const VARIANT_CONFIG = {
  info:    { bg: "bg-primary/10",        text: "text-primary",        border: "border-primary/20",       badgeBg: "bg-primary/10 text-primary border-primary/20",         icon: Info,          label: "Info" },
  success: { bg: "bg-emerald-500/10",    text: "text-emerald-500",    border: "border-emerald-500/20",   badgeBg: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", icon: CheckCircle,   label: "Success" },
  warning: { bg: "bg-amber-500/10",      text: "text-amber-500",      border: "border-amber-500/20",     badgeBg: "bg-amber-500/10 text-amber-500 border-amber-500/20",     icon: AlertTriangle, label: "Warning" },
  error:   { bg: "bg-destructive/10",    text: "text-destructive",    border: "border-destructive/20",   badgeBg: "bg-destructive/10 text-destructive border-destructive/20", icon: XCircle,       label: "Error" },
}

const TYPE_CONFIG = {
  banner: { icon: Megaphone, label: "Banner" },
  modal:  { icon: Layers,    label: "Modal" },
  toast:  { icon: Bell,      label: "Toast" },
  bell:   { icon: Bell,      label: "Bell" },
}

const AUDIENCE_LABELS: Record<AdminNotification["audience"], string> = {
  all:             "Everyone",
  authenticated:   "Logged In",
  unauthenticated: "Guests Only",
  admin:           "Admins Only",
  staff:           "Staff Only",
}

function SectionHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="flex items-center justify-center h-6 w-6 rounded bg-primary/10">
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  )
}

export function NotificationsManager() {
  const [notifications, setNotifications] = useState<AdminNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingNotification, setEditingNotification] = useState<AdminNotification | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [saving, setSaving] = useState(false)

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

  const set = (patch: Partial<typeof formData>) => setFormData((prev) => ({ ...prev, ...patch }))

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

  useEffect(() => { fetchNotifications() }, [])

  const openCreateDialog = () => {
    setFormData({
      title: "", message: "", type: "bell", variant: "info", audience: "all",
      path_pattern: "", starts_at: new Date().toISOString().slice(0, 16), ends_at: "",
      is_active: true, is_dismissible: true, dismiss_duration_hours: "",
      action_label: "", action_url: "", action_external: false, priority: "0",
    })
    setEditingNotification(null)
    setIsCreating(true)
  }

  const openEditDialog = (notif: AdminNotification) => {
    setFormData({
      title: notif.title, message: notif.message, type: notif.type, variant: notif.variant,
      audience: notif.audience, path_pattern: notif.path_pattern || "",
      starts_at: notif.starts_at ? new Date(notif.starts_at).toISOString().slice(0, 16) : "",
      ends_at: notif.ends_at ? new Date(notif.ends_at).toISOString().slice(0, 16) : "",
      is_active: notif.is_active, is_dismissible: notif.is_dismissible,
      dismiss_duration_hours: notif.dismiss_duration_hours?.toString() || "",
      action_label: notif.action_label || "", action_url: notif.action_url || "",
      action_external: notif.action_external, priority: notif.priority.toString(),
    })
    setEditingNotification(notif)
    setIsCreating(true)
  }

  const closeDialog = () => { setIsCreating(false); setEditingNotification(null) }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        title: formData.title, message: formData.message, type: formData.type,
        variant: formData.variant, audience: formData.audience,
        path_pattern: formData.path_pattern || null,
        starts_at: formData.starts_at ? new Date(formData.starts_at).toISOString() : null,
        ends_at: formData.ends_at ? new Date(formData.ends_at).toISOString() : null,
        is_active: formData.is_active, is_dismissible: formData.is_dismissible,
        dismiss_duration_hours: formData.dismiss_duration_hours ? parseInt(formData.dismiss_duration_hours) : null,
        action_label: formData.action_label || null, action_url: formData.action_url || null,
        action_external: formData.action_external, priority: parseInt(formData.priority) || 0,
      }
      const url = editingNotification ? `/api/v2/admin/notifications/${editingNotification.id}` : "/api/v2/admin/notifications"
      const res = await fetch(url, { method: editingNotification ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
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
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...notif, is_active: !notif.is_active }),
      })
      if (!res.ok) throw new Error("Failed to update")
      await fetchNotifications()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update")
    }
  }

  const activeVariant = VARIANT_CONFIG[formData.variant]

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {notifications.length} notification{notifications.length !== 1 ? "s" : ""} configured
        </p>
        <Button size="sm" onClick={openCreateDialog} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Create
        </Button>
      </div>

      {/* List */}
      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-muted">
            <Bell className="h-7 w-7 opacity-40" />
          </div>
          <div className="text-center">
            <p className="font-medium text-sm">No notifications yet</p>
            <p className="text-xs mt-0.5">Click &quot;Create&quot; to add a site-wide notification.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif) => {
            const v = VARIANT_CONFIG[notif.variant]
            const Icon = v.icon
            const TypeIcon = TYPE_CONFIG[notif.type].icon
            return (
              <div
                key={notif.id}
                className={cn(
                  "group relative p-4 rounded-xl border transition-all cursor-pointer",
                  notif.is_active
                    ? cn("border-l-4 bg-card hover:bg-muted/50", v.border)
                    : "border border-border bg-card/50 opacity-60 hover:opacity-80 hover:bg-muted/30"
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Variant icon */}
                  <div className={cn("flex items-center justify-center h-9 w-9 rounded-lg shrink-0 border", v.bg, v.border)}>
                    <Icon className={cn("h-4 w-4", v.text)} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-sm text-foreground">{notif.title}</span>
                      {/* Type badge */}
                      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 gap-0.5 flex items-center", v.badgeBg)}>
                        <TypeIcon className="h-2.5 w-2.5" />
                        {TYPE_CONFIG[notif.type].label}
                      </Badge>
                      {/* Audience badge */}
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 flex items-center text-muted-foreground">
                        <Users className="h-2.5 w-2.5" />
                        {AUDIENCE_LABELS[notif.audience]}
                      </Badge>
                      {notif.ends_at && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 flex items-center text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" />
                          Expires {new Date(notif.ends_at).toLocaleDateString()}
                        </Badge>
                      )}
                      {!notif.is_active && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Inactive</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{notif.message}</p>
                    {notif.action_url && (
                      <div className="mt-1.5 flex items-center gap-1 text-xs text-primary font-medium">
                        <ExternalLink className="h-3 w-3" />
                        {notif.action_label || notif.action_url}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleToggleActive(notif)}
                      title={notif.is_active ? "Deactivate" : "Activate"}
                      className={cn(
                        "flex items-center justify-center h-8 w-8 rounded-md transition-colors",
                        notif.is_active
                          ? "text-emerald-500 hover:bg-emerald-500/10"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {notif.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => openEditDialog(notif)}
                      className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-accent-foreground hover:bg-accent transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(notif.id)}
                      className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={isCreating} onOpenChange={(open) => !open && closeDialog()} modal={true}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto gap-0 p-0 my-4">
          {/* Dialog header with variant color stripe */}
          <div className={cn("px-6 py-5 border-b border-border rounded-t-lg", activeVariant.bg)}>
            <DialogHeader>
              <DialogTitle className={cn("flex items-center gap-2 text-base", activeVariant.text)}>
                <activeVariant.icon className="h-5 w-5" />
                {editingNotification ? "Edit Notification" : "Create Notification"}
              </DialogTitle>
            </DialogHeader>
          </div>

          <div className="p-6 space-y-6">
            {/* Content */}
            <div>
              <SectionHeader icon={Megaphone} label="Content" />
              <div className="space-y-3 p-4 rounded-xl border border-border bg-muted/20">
                <div className="space-y-1.5">
                  <Label htmlFor="title" className="text-xs font-medium">Title</Label>
                  <Input id="title" value={formData.title} onChange={(e) => set({ title: e.target.value })} placeholder="Notification title" className="bg-background h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="message" className="text-xs font-medium">Message</Label>
                  <Textarea id="message" value={formData.message} onChange={(e) => set({ message: e.target.value })} placeholder="Notification message…" rows={3} className="bg-background resize-none" />
                </div>
              </div>
            </div>

            {/* Display */}
            <div>
              <SectionHeader icon={Layers} label="Display" />
              <div className="grid grid-cols-2 gap-3 p-4 rounded-xl border border-border bg-muted/20">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Type</Label>
                  <Select value={formData.type} onValueChange={(v) => set({ type: v as AdminNotification["type"] })}>
                    <SelectTrigger className="bg-background h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bell">Bell Notification</SelectItem>
                      <SelectItem value="banner">Banner</SelectItem>
                      <SelectItem value="modal">Modal</SelectItem>
                      <SelectItem value="toast">Toast</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Variant</Label>
                  <Select value={formData.variant} onValueChange={(v) => set({ variant: v as AdminNotification["variant"] })}>
                    <SelectTrigger className={cn("h-9 font-medium border", activeVariant.bg, activeVariant.text, activeVariant.border)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(VARIANT_CONFIG) as [AdminNotification["variant"], typeof VARIANT_CONFIG.info][]).map(([key, cfg]) => (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <cfg.icon className={cn("h-3.5 w-3.5", cfg.text)} />
                            {cfg.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Targeting */}
            <div>
              <SectionHeader icon={Users} label="Targeting" />
              <div className="space-y-3 p-4 rounded-xl border border-border bg-muted/20">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Audience</Label>
                    <Select value={formData.audience} onValueChange={(v) => set({ audience: v as AdminNotification["audience"] })}>
                      <SelectTrigger className="bg-background h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Everyone</SelectItem>
                        <SelectItem value="authenticated">Logged In Users</SelectItem>
                        <SelectItem value="unauthenticated">Guests Only</SelectItem>
                        <SelectItem value="admin">Admins Only</SelectItem>
                        <SelectItem value="staff">Staff Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="priority" className="text-xs font-medium">Priority</Label>
                    <Input id="priority" type="number" value={formData.priority} onChange={(e) => set({ priority: e.target.value })} placeholder="0 = default" className="bg-background h-9" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="path_pattern" className="text-xs font-medium">Page Filter <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input id="path_pattern" value={formData.path_pattern} onChange={(e) => set({ path_pattern: e.target.value })} placeholder="/dashboard* — leave empty for all pages" className="bg-background h-9" />
                </div>
              </div>
            </div>

            {/* Scheduling */}
            <div>
              <SectionHeader icon={Clock} label="Scheduling & Behavior" />
              <div className="space-y-4 p-4 rounded-xl border border-border bg-muted/20">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="starts_at" className="text-xs font-medium">Starts At</Label>
                    <Input id="starts_at" type="datetime-local" value={formData.starts_at} onChange={(e) => set({ starts_at: e.target.value })} className="bg-background h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ends_at" className="text-xs font-medium">Ends At <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input id="ends_at" type="datetime-local" value={formData.ends_at} onChange={(e) => set({ ends_at: e.target.value })} className="bg-background h-9" />
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch id="is_active" checked={formData.is_active} onCheckedChange={(v) => set({ is_active: v })} />
                    <Label htmlFor="is_active" className="text-sm cursor-pointer">Active</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="is_dismissible" checked={formData.is_dismissible} onCheckedChange={(v) => set({ is_dismissible: v })} />
                    <Label htmlFor="is_dismissible" className="text-sm cursor-pointer">Dismissible</Label>
                  </div>
                </div>
                {formData.is_dismissible && (
                  <div className="space-y-1.5">
                    <Label htmlFor="dismiss_duration_hours" className="text-xs font-medium">Re-show after dismiss (hours)</Label>
                    <Input id="dismiss_duration_hours" type="number" value={formData.dismiss_duration_hours} onChange={(e) => set({ dismiss_duration_hours: e.target.value })} placeholder="Leave empty for permanent dismiss" className="bg-background h-9" />
                  </div>
                )}
              </div>
            </div>

            {/* Action button */}
            <div>
              <SectionHeader icon={ExternalLink} label="Action Button (optional)" />
              <div className="space-y-3 p-4 rounded-xl border border-border bg-muted/20">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Button Label</Label>
                    <Input value={formData.action_label} onChange={(e) => set({ action_label: e.target.value })} placeholder="e.g. Learn more" className="bg-background h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">URL / Path</Label>
                    <Input value={formData.action_url} onChange={(e) => set({ action_url: e.target.value })} placeholder="https:// or /path" className="bg-background h-9" />
                  </div>
                </div>
                {formData.action_url && (
                  <div className="flex items-center gap-2">
                    <Switch id="action_external" checked={formData.action_external} onCheckedChange={(v) => set({ action_external: v })} />
                    <Label htmlFor="action_external" className="text-sm cursor-pointer">Open in new tab</Label>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-border bg-muted/20 rounded-b-lg">
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !formData.title || !formData.message}
              className={cn(activeVariant.bg, activeVariant.text, activeVariant.border, "border hover:opacity-90")}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingNotification ? "Save Changes" : "Create Notification"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
