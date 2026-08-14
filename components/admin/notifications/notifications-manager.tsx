"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SaveConfirmationModal } from "@/components/shared/save-confirmation-modal";
import {
  StatBar,
  StatBarSkeleton,
  EmptyState,
  DataTableSkeleton,
} from "@/components/admin/shared";
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
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { toLocalDatetimeInputValue } from "@/lib/notifications/local-datetime";

interface AdminNotification {
  id: number;
  cookie_id: string;
  title: string;
  message: string;
  type: "banner" | "modal" | "toast" | "bell";
  variant: "info" | "success" | "warning" | "error";
  audience: "all" | "authenticated" | "unauthenticated" | "admin" | "staff";
  path_pattern: string | null;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  is_dismissible: boolean;
  dismiss_duration_hours: number | null;
  action_label: string | null;
  action_url: string | null;
  action_external: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

const VARIANT_CONFIG = {
  info: {
    bg: "bg-primary/10",
    text: "text-primary",
    border: "border-primary/20",
    badgeBg: "bg-primary/10 text-primary border-primary/20",
    icon: Info,
    label: "Info",
  },
  success: {
    bg: "bg-[hsl(var(--success))]/10",
    text: "text-[hsl(var(--success))]",
    border: "border-[hsl(var(--success))]/20",
    badgeBg:
      "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
    icon: CheckCircle,
    label: "Success",
  },
  warning: {
    bg: "bg-[hsl(var(--warning))]/10",
    text: "text-[hsl(var(--warning))]",
    border: "border-[hsl(var(--warning))]/20",
    badgeBg:
      "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20",
    icon: AlertTriangle,
    label: "Warning",
  },
  error: {
    bg: "bg-destructive/10",
    text: "text-destructive",
    border: "border-destructive/20",
    badgeBg: "bg-destructive/10 text-destructive border-destructive/20",
    icon: XCircle,
    label: "Error",
  },
};

const TYPE_CONFIG = {
  banner: { icon: Megaphone, label: "Banner" },
  modal: { icon: Layers, label: "Modal" },
  toast: { icon: Bell, label: "Toast" },
  bell: { icon: Bell, label: "Bell" },
};

const AUDIENCE_LABELS: Record<AdminNotification["audience"], string> = {
  all: "Everyone",
  authenticated: "Logged In",
  unauthenticated: "Guests Only",
  admin: "Admins Only",
  staff: "Staff Only",
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function isExpiringSoon(notif: AdminNotification): boolean {
  if (!notif.ends_at) return false;
  const endsAt = new Date(notif.ends_at).getTime();
  const now = Date.now();
  return endsAt > now && endsAt < now + 7 * 24 * 60 * 60 * 1000;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 sm:px-5 pt-5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 first:pt-0">
      {children}
    </p>
  );
}

function FieldRow({
  htmlFor,
  label,
  help,
  children,
}: {
  htmlFor?: string;
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 sm:px-5 py-3.5 hover:bg-muted/20 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <Label
            htmlFor={htmlFor}
            className="text-sm font-medium text-foreground"
          >
            {label}
          </Label>
          {help && (
            <p className="text-xs text-muted-foreground mt-1 max-w-[48ch]">
              {help}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 sm:pt-0.5">
          {children}
        </div>
      </div>
    </div>
  );
}

export function NotificationsManager() {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingNotification, setEditingNotification] =
    useState<AdminNotification | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AdminNotification | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive" | "expiring"
  >("all");

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
  });

  const set = (patch: Partial<typeof formData>) =>
    setFormData((prev) => ({ ...prev, ...patch }));

  const fetchNotifications = async () => {
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/v3/admin/notifications");
      if (!res.ok) throw new Error("Failed to fetch notifications");
      const data = await res.json();
      setNotifications(data.notifications || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load notifications",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchNotifications();
  }, []);

  const openCreateDialog = () => {
    setFormData({
      title: "",
      message: "",
      type: "bell",
      variant: "info",
      audience: "all",
      path_pattern: "",
      starts_at: toLocalDatetimeInputValue(new Date()),
      ends_at: "",
      is_active: true,
      is_dismissible: true,
      dismiss_duration_hours: "",
      action_label: "",
      action_url: "",
      action_external: false,
      priority: "0",
    });
    setEditingNotification(null);
    setIsCreating(true);
  };

  const openEditDialog = (notif: AdminNotification) => {
    setFormData({
      title: notif.title,
      message: notif.message,
      type: notif.type,
      variant: notif.variant,
      audience: notif.audience,
      path_pattern: notif.path_pattern || "",
      starts_at: notif.starts_at
        ? toLocalDatetimeInputValue(new Date(notif.starts_at))
        : "",
      ends_at: notif.ends_at
        ? toLocalDatetimeInputValue(new Date(notif.ends_at))
        : "",
      is_active: notif.is_active,
      is_dismissible: notif.is_dismissible,
      dismiss_duration_hours: notif.dismiss_duration_hours?.toString() || "",
      action_label: notif.action_label || "",
      action_url: notif.action_url || "",
      action_external: notif.action_external,
      priority: notif.priority.toString(),
    });
    setEditingNotification(notif);
    setIsCreating(true);
  };

  const closeDialog = () => {
    setIsCreating(false);
    setEditingNotification(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        title: formData.title,
        message: formData.message,
        type: formData.type,
        variant: formData.variant,
        audience: formData.audience,
        path_pattern: formData.path_pattern || null,
        starts_at: formData.starts_at
          ? new Date(formData.starts_at).toISOString()
          : null,
        ends_at: formData.ends_at
          ? new Date(formData.ends_at).toISOString()
          : null,
        is_active: formData.is_active,
        is_dismissible: formData.is_dismissible,
        dismiss_duration_hours: formData.dismiss_duration_hours
          ? parseInt(formData.dismiss_duration_hours)
          : null,
        action_label: formData.action_label || null,
        action_url: formData.action_url || null,
        action_external: formData.action_external,
        priority: parseInt(formData.priority) || 0,
      };
      const url = editingNotification
        ? `/api/v3/admin/notifications/${editingNotification.id}`
        : "/api/v3/admin/notifications";
      const res = await fetch(url, {
        method: editingNotification ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save notification");
      await fetchNotifications();
      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/v3/admin/notifications/${pendingDelete.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete");
      await fetchNotifications();
      setPendingDelete(null);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete";
      setError(message);
      return { ok: false, error: message };
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (notif: AdminNotification) => {
    try {
      const res = await fetch(`/api/v3/admin/notifications/${notif.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...notif, is_active: !notif.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update");
      await fetchNotifications();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const activeVariant = VARIANT_CONFIG[formData.variant];

  // Calculate stats
  const stats = {
    total: notifications.length,
    active: notifications.filter((n) => n.is_active).length,
    inactive: notifications.filter((n) => !n.is_active).length,
    expiring: notifications.filter(isExpiringSoon).length,
  };

  const filteredNotifications = notifications.filter((n) => {
    if (statusFilter === "active") return n.is_active;
    if (statusFilter === "inactive") return !n.is_active;
    if (statusFilter === "expiring") return isExpiringSoon(n);
    return true;
  });

  if (loading) {
    return (
      <div className="space-y-4">
        <StatBarSkeleton segments={4} />
        <Card className="border-border/50 bg-card/50 overflow-hidden">
          <CardContent className="p-4 sm:p-5">
            <DataTableSkeleton rows={5} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Stats */}
      <StatBar
        items={[
          { label: "Total", value: stats.total, icon: Bell, tone: "primary" },
          {
            label: "Active",
            value: stats.active,
            icon: Eye,
            tone: "success",
            onClick: () =>
              setStatusFilter(statusFilter === "active" ? "all" : "active"),
            active: statusFilter === "active",
          },
          {
            label: "Inactive",
            value: stats.inactive,
            icon: EyeOff,
            tone: "muted",
            onClick: () =>
              setStatusFilter(statusFilter === "inactive" ? "all" : "inactive"),
            active: statusFilter === "inactive",
          },
          {
            label: "Expiring Soon",
            value: stats.expiring,
            icon: Clock,
            tone: "orange",
            onClick: () =>
              setStatusFilter(statusFilter === "expiring" ? "all" : "expiring"),
            active: statusFilter === "expiring",
          },
        ]}
      />

      {/* Notifications list card */}
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <CardHeader className="pb-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Bell className="h-4 w-4 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Site Notifications
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Manage banners, modals, toasts, and bell notifications
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-border/40"
                onClick={fetchNotifications}
                aria-label="Refresh notifications"
              >
                <RefreshCw
                  className={cn("h-4 w-4", refreshing && "animate-spin")}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button size="sm" onClick={openCreateDialog} className="gap-1.5">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 mt-4">
          {filteredNotifications.length === 0 ? (
            <EmptyState
              icon={Bell}
              title={
                notifications.length === 0
                  ? "No notifications yet"
                  : "No notifications match this filter"
              }
              description={
                notifications.length === 0
                  ? 'Click "Create" to add a site-wide notification.'
                  : "Try a different status filter above."
              }
            />
          ) : (
            <div className="divide-y divide-border/40">
              {filteredNotifications.map((notif) => {
                const v = VARIANT_CONFIG[notif.variant];
                const Icon = v.icon;
                const TypeIcon = TYPE_CONFIG[notif.type].icon;
                return (
                  <div
                    key={notif.id}
                    className={cn(
                      "group relative flex items-start gap-3 p-4 transition-colors hover:bg-muted/20",
                      !notif.is_active && "opacity-60",
                    )}
                  >
                    {/* Colored accent bar */}
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0 w-1 rounded-r-full",
                        notif.is_active
                          ? v.border
                              .replace("border-", "bg-")
                              .replace("/20", "/60")
                          : "bg-muted",
                      )}
                    />

                    {/* Variant icon */}
                    <div
                      className={cn(
                        "flex items-center justify-center h-10 w-10 rounded-lg shrink-0 ml-1",
                        v.bg,
                      )}
                    >
                      <Icon
                        className={cn("h-5 w-5", v.text)}
                        aria-hidden="true"
                      />
                    </div>

                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Title and status row */}
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground truncate">
                          {notif.title}
                        </span>
                        {!notif.is_active && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 shrink-0"
                          >
                            Inactive
                          </Badge>
                        )}
                      </div>

                      {/* Badges row */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge
                          variant="outline"
                          className="text-[10px] px-2 py-0.5 gap-1 border-border bg-muted/50 text-foreground"
                        >
                          <TypeIcon className="h-3 w-3" aria-hidden="true" />
                          {TYPE_CONFIG[notif.type].label}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-[10px] px-2 py-0.5 gap-1 border-border bg-muted/50 text-foreground"
                        >
                          <Users className="h-3 w-3" aria-hidden="true" />
                          {AUDIENCE_LABELS[notif.audience]}
                        </Badge>
                        {notif.ends_at && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-2 py-0.5 gap-1 border-border bg-muted/50 text-foreground"
                          >
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            Expires{" "}
                            {new Date(notif.ends_at).toLocaleDateString()}
                          </Badge>
                        )}
                      </div>

                      {/* Message */}
                      <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed whitespace-pre-wrap">
                        {notif.message}
                      </p>

                      {/* Footer row */}
                      <div className="flex items-center gap-3 pt-1">
                        <span className="text-[11px] text-muted-foreground/70 font-mono">
                          ID: {notif.cookie_id}
                        </span>
                        {notif.action_url && (
                          <div className="flex items-center gap-1 text-xs text-primary font-medium">
                            <ExternalLink
                              className="h-3 w-3"
                              aria-hidden="true"
                            />
                            {notif.action_label || "Action"}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleToggleActive(notif)}
                        title={notif.is_active ? "Deactivate" : "Activate"}
                        aria-label={
                          notif.is_active
                            ? "Deactivate notification"
                            : "Activate notification"
                        }
                        className={cn(
                          "flex items-center justify-center h-8 w-8 rounded-md transition-colors",
                          focusRing,
                          notif.is_active
                            ? "text-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/10"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {notif.is_active ? (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                      <button
                        onClick={() => openEditDialog(notif)}
                        title={`Edit ${notif.title}`}
                        aria-label={`Edit ${notif.title}`}
                        className={cn(
                          "flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
                          focusRing,
                        )}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => setPendingDelete(notif)}
                        title={`Delete ${notif.title}`}
                        aria-label={`Delete ${notif.title}`}
                        className={cn(
                          "flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors",
                          focusRing,
                        )}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog
        open={isCreating}
        onOpenChange={(open) => !open && closeDialog()}
        modal={true}
      >
        <DialogContent className="w-full max-w-2xl max-h-[95dvh] sm:max-h-[85vh] overflow-y-auto gap-0 p-0 rounded-xl">
          {/* Dialog header with variant color stripe */}
          <div
            className={cn(
              "px-5 py-4 border-b border-border rounded-t-xl",
              activeVariant.bg,
            )}
          >
            <DialogHeader>
              <DialogTitle
                className={cn(
                  "flex items-center gap-2 text-base",
                  activeVariant.text,
                )}
              >
                <activeVariant.icon className="h-5 w-5" aria-hidden="true" />
                {editingNotification
                  ? "Edit Notification"
                  : "Create Notification"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {editingNotification
                  ? "Edit an existing notification"
                  : "Create a new site-wide notification"}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="m-4 sm:m-6 rounded-lg border border-border/40 overflow-hidden divide-y divide-border/40">
            {/* Content */}
            <div>
              <SectionLabel>Content</SectionLabel>
              <div className="divide-y divide-border/40">
                <div className="px-4 sm:px-5 py-3.5 space-y-1.5">
                  <Label
                    htmlFor="title"
                    className="text-sm font-medium text-foreground"
                  >
                    Title
                  </Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => set({ title: e.target.value })}
                    placeholder="Notification title"
                    className="bg-background/50 border-border/40 focus:border-primary/50 h-9"
                  />
                </div>
                <div className="px-4 sm:px-5 py-3.5 space-y-1.5">
                  <Label
                    htmlFor="message"
                    className="text-sm font-medium text-foreground"
                  >
                    Message
                  </Label>
                  <Textarea
                    id="message"
                    value={formData.message}
                    onChange={(e) => set({ message: e.target.value })}
                    placeholder="Notification message…"
                    rows={3}
                    className="bg-background/50 border-border/40 focus:border-primary/50 resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Display */}
            <div>
              <SectionLabel>Display</SectionLabel>
              <div className="divide-y divide-border/40">
                <FieldRow
                  htmlFor="notif-type"
                  label="Type"
                  help="Where this shows up: the bell dropdown, a top-of-page banner, a popup modal, or a corner toast."
                >
                  <select
                    id="notif-type"
                    value={formData.type}
                    onChange={(e) =>
                      set({ type: e.target.value as AdminNotification["type"] })
                    }
                    className="w-40 h-9 rounded-md border border-border/40 bg-background/50 px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/50"
                  >
                    <option value="bell">Bell Notification</option>
                    <option value="banner">Banner</option>
                    <option value="modal">Modal</option>
                    <option value="toast">Toast</option>
                  </select>
                </FieldRow>
                <FieldRow
                  htmlFor="notif-variant"
                  label="Variant"
                  help="Color and icon used for this notification."
                >
                  <select
                    id="notif-variant"
                    value={formData.variant}
                    onChange={(e) =>
                      set({
                        variant: e.target.value as AdminNotification["variant"],
                      })
                    }
                    className={cn(
                      "w-36 h-9 rounded-md border px-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring",
                      activeVariant.bg,
                      activeVariant.text,
                      activeVariant.border,
                    )}
                  >
                    {(
                      Object.entries(VARIANT_CONFIG) as [
                        AdminNotification["variant"],
                        typeof VARIANT_CONFIG.info,
                      ][]
                    ).map(([key, cfg]) => (
                      <option key={key} value={key}>
                        {cfg.label}
                      </option>
                    ))}
                  </select>
                </FieldRow>
              </div>
            </div>

            {/* Targeting */}
            <div>
              <SectionLabel>Targeting</SectionLabel>
              <div className="divide-y divide-border/40">
                <FieldRow
                  htmlFor="notif-audience"
                  label="Audience"
                  help="Who sees this notification."
                >
                  <select
                    id="notif-audience"
                    value={formData.audience}
                    onChange={(e) =>
                      set({
                        audience: e.target
                          .value as AdminNotification["audience"],
                      })
                    }
                    className="w-40 h-9 rounded-md border border-border/40 bg-background/50 px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/50"
                  >
                    <option value="all">Everyone</option>
                    <option value="authenticated">Logged In Users</option>
                    <option value="unauthenticated">Guests Only</option>
                    <option value="admin">Admins Only</option>
                    <option value="staff">Staff Only</option>
                  </select>
                </FieldRow>
                <FieldRow
                  htmlFor="priority"
                  label="Priority"
                  help="Higher numbers are shown first when more than one notification is active."
                >
                  <Input
                    id="priority"
                    type="number"
                    value={formData.priority}
                    onChange={(e) => set({ priority: e.target.value })}
                    placeholder="0"
                    className="w-24 h-9 bg-background/50 border-border/40 focus:border-primary/50"
                  />
                </FieldRow>
                <FieldRow
                  htmlFor="path_pattern"
                  label="Page filter"
                  help="Only shows on matching pages. * is a wildcard, e.g. /dashboard*. Leave empty to show on every page."
                >
                  <Input
                    id="path_pattern"
                    value={formData.path_pattern}
                    onChange={(e) => set({ path_pattern: e.target.value })}
                    placeholder="/dashboard*"
                    className="w-48 sm:w-56 h-9 bg-background/50 border-border/40 focus:border-primary/50"
                  />
                </FieldRow>
              </div>
            </div>

            {/* Scheduling & Behavior */}
            <div>
              <SectionLabel>Scheduling &amp; Behavior</SectionLabel>
              <div className="divide-y divide-border/40">
                <FieldRow
                  htmlFor="starts_at"
                  label="Starts at"
                  help="Won't appear before this time."
                >
                  <Input
                    id="starts_at"
                    type="datetime-local"
                    value={formData.starts_at}
                    onChange={(e) => set({ starts_at: e.target.value })}
                    className="h-9 bg-background/50 border-border/40 focus:border-primary/50"
                  />
                </FieldRow>
                <FieldRow
                  htmlFor="ends_at"
                  label="Ends at"
                  help="Optional. Stops appearing after this time."
                >
                  <Input
                    id="ends_at"
                    type="datetime-local"
                    value={formData.ends_at}
                    onChange={(e) => set({ ends_at: e.target.value })}
                    className="h-9 bg-background/50 border-border/40 focus:border-primary/50"
                  />
                </FieldRow>
                <FieldRow
                  htmlFor="is_active"
                  label="Active"
                  help="Turn off to hide it without deleting it."
                >
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(v) => set({ is_active: v })}
                  />
                </FieldRow>
                <FieldRow
                  htmlFor="is_dismissible"
                  label="Dismissible"
                  help="Whether users can close it themselves."
                >
                  <Switch
                    id="is_dismissible"
                    checked={formData.is_dismissible}
                    onCheckedChange={(v) => set({ is_dismissible: v })}
                  />
                </FieldRow>
                {formData.is_dismissible && (
                  <FieldRow
                    htmlFor="dismiss_duration_hours"
                    label="Re-show after dismiss"
                    help="Hours until a dismissed notification reappears. Leave empty to dismiss it permanently."
                  >
                    <Input
                      id="dismiss_duration_hours"
                      type="number"
                      value={formData.dismiss_duration_hours}
                      onChange={(e) =>
                        set({ dismiss_duration_hours: e.target.value })
                      }
                      placeholder="Permanent"
                      className="w-32 h-9 bg-background/50 border-border/40 focus:border-primary/50"
                    />
                  </FieldRow>
                )}
              </div>
            </div>

            {/* Action button */}
            <div>
              <SectionLabel>Action button (optional)</SectionLabel>
              <div className="divide-y divide-border/40">
                <FieldRow htmlFor="action_label" label="Button label">
                  <Input
                    id="action_label"
                    value={formData.action_label}
                    onChange={(e) => set({ action_label: e.target.value })}
                    placeholder="Learn more"
                    className="w-40 sm:w-48 h-9 bg-background/50 border-border/40 focus:border-primary/50"
                  />
                </FieldRow>
                <FieldRow htmlFor="action_url" label="URL / path">
                  <Input
                    id="action_url"
                    value={formData.action_url}
                    onChange={(e) => set({ action_url: e.target.value })}
                    placeholder="https:// or /path"
                    className="w-40 sm:w-56 h-9 bg-background/50 border-border/40 focus:border-primary/50"
                  />
                </FieldRow>
                {formData.action_url && (
                  <FieldRow htmlFor="action_external" label="Open in new tab">
                    <Switch
                      id="action_external"
                      checked={formData.action_external}
                      onCheckedChange={(v) => set({ action_external: v })}
                    />
                  </FieldRow>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="flex-row px-4 sm:px-6 py-4 border-t border-border bg-muted/20 rounded-b-xl gap-2">
            <Button
              variant="outline"
              onClick={closeDialog}
              className="flex-1 sm:flex-none"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !formData.title || !formData.message}
              className={cn(
                activeVariant.bg,
                activeVariant.text,
                activeVariant.border,
                "border hover:opacity-90 flex-1 sm:flex-none",
              )}
            >
              {saving && (
                <Loader2
                  className="h-4 w-4 animate-spin mr-2"
                  aria-hidden="true"
                />
              )}
              {editingNotification ? "Save Changes" : "Create Notification"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <SaveConfirmationModal
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title="Delete Notification"
        description="This will permanently delete this notification. This action cannot be undone."
        changes={
          pendingDelete
            ? [
                {
                  field: "title",
                  label: "Title",
                  oldValue: pendingDelete.title,
                  newValue: "Deleted",
                },
                {
                  field: "type",
                  label: "Type",
                  oldValue: pendingDelete.type,
                  newValue: null,
                },
                {
                  field: "audience",
                  label: "Audience",
                  oldValue: AUDIENCE_LABELS[pendingDelete.audience],
                  newValue: null,
                },
              ]
            : []
        }
        loading={deleting}
        confirmText="Delete"
        variant="destructive"
      />
    </div>
  );
}
