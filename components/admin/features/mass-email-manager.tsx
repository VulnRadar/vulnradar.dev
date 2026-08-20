"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Mail,
  Send,
  Eye,
  Trash2,
  RefreshCw,
  Loader2,
  FileEdit,
  CheckCircle2,
  Clock,
  Users,
  MailOpen,
  UserCog,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { getPaidPlans } from "@/lib/billing/catalog";
import { SaveConfirmationModal } from "@/components/shared/save-confirmation-modal";
import {
  EmptyState,
  DataTableSkeleton,
  StatBar,
  generateEmailPreviewHtml,
} from "@/components/admin/shared";

interface Broadcast {
  id: string;
  title: string;
  status: string;
  created_at: string;
  sent_at?: string;
  created_by_name?: string;
  sent_by_name?: string;
}

const SEGMENT_LABELS: Record<string, string> = {
  all: "All Users",
  premium: "All Premium Users",
  free: "Free Users",
  ...Object.fromEntries(getPaidPlans().map((p) => [p.id, p.name])),
  specific: "Specific Email",
};

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "No filter (everyone in segment)" },
  { value: "email_product_updates", label: "Product Updates" },
  { value: "email_tips_guides", label: "Tips & Guides" },
  { value: "email_scan_complete", label: "Scan Completed" },
  { value: "email_critical_findings", label: "Critical Issues Found" },
  { value: "email_regression_alert", label: "Regression Alerts" },
  { value: "email_schedules", label: "Scheduled Scans" },
  { value: "email_security", label: "Security Alerts" },
  { value: "email_new_login", label: "Login Alerts" },
  { value: "email_team_invite", label: "Team Invites" },
  { value: "email_team_changes", label: "Team Changes" },
];

export function MassEmailManager() {
  const [messages, setMessages] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Broadcast | null>(null);
  const [pendingSend, setPendingSend] = useState<Broadcast | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [segment, setSegment] = useState("all");
  const [specificEmail, setSpecificEmail] = useState("");
  const [category, setCategory] = useState("none");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "draft" | "sent">(
    "all",
  );

  useEffect(() => {
    fetchMessages();
  }, []);

  async function fetchMessages() {
    setLoading(true);
    try {
      const res = await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", section: "broadcast" }),
      });
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (err) {
      console.error("Error fetching messages:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!title || !content) return;
    if (segment === "specific" && !specificEmail) return;
    setLoading(true);
    try {
      const segmentFilter: Record<string, string> =
        segment === "specific"
          ? { segment: `email:${specificEmail}` }
          : { segment };
      if (category !== "none") {
        segmentFilter.preference_col = category;
      }

      const res = await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          section: "broadcast",
          title,
          content,
          message_type: "email",
          segment_filter: segmentFilter,
        }),
      });
      if (res.ok) {
        setTitle("");
        setContent("");
        setSegment("all");
        setSpecificEmail("");
        setCategory("none");
        fetchMessages();
      }
    } catch (err) {
      console.error("Error creating message:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSend(id: string) {
    setSending(id);
    try {
      const res = await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", section: "broadcast", id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || "Failed to send broadcast" };
      }
      fetchMessages();
      return { ok: true };
    } catch (err) {
      console.error("Error sending:", err);
      return { ok: false, error: "Failed to send broadcast" };
    } finally {
      setSending(null);
    }
  }

  async function handleResend(id: string) {
    setSending(id);
    try {
      const res = await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend", section: "broadcast", id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: data.error || "Failed to resend broadcast",
        };
      }
      fetchMessages();
      return { ok: true };
    } catch (err) {
      console.error("Error resending:", err);
      return { ok: false, error: "Failed to resend broadcast" };
    } finally {
      setSending(null);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return { ok: false };
    setDeleting(pendingDelete.id);
    try {
      const res = await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          section: "broadcast",
          id: pendingDelete.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: data.error || "Failed to delete broadcast",
        };
      }
      fetchMessages();
      setPendingDelete(null);
      return { ok: true };
    } catch (err) {
      console.error("Error deleting:", err);
      return { ok: false, error: "Failed to delete broadcast" };
    } finally {
      setDeleting(null);
    }
  }

  const drafts = messages.filter((m) => m.status === "draft");
  const sent = messages.filter((m) => m.status === "sent");
  const isFormValid =
    title && content && (segment !== "specific" || specificEmail);
  const visibleMessages =
    historyFilter === "all"
      ? messages
      : messages.filter((m) => m.status === historyFilter);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <StatBar
        items={[
          {
            label: "Total Broadcasts",
            value: messages.length,
            icon: Mail,
            tone: "primary",
            onClick: () => setHistoryFilter("all"),
            active: historyFilter === "all",
          },
          {
            label: "Drafts",
            value: drafts.length,
            onClick: () => setHistoryFilter("draft"),
            active: historyFilter === "draft",
            icon: FileEdit,
          },
          {
            label: "Sent",
            value: sent.length,
            onClick: () => setHistoryFilter("sent"),
            active: historyFilter === "sent",
            icon: CheckCircle2,
          },
          {
            label: "Contributors",
            value: new Set(messages.map((m) => m.created_by_name)).size,
            icon: UserCog,
          },
        ]}
      />

      {/* Compose card */}
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Compose Broadcast
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Write and send emails to user segments
              </p>
            </div>
          </div>
        </div>
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
              Subject
            </label>
            <Input
              placeholder={`e.g., Important update from ${APP_NAME}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-10 bg-background/50 border-border/40 focus:border-primary/50"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
              Content (HTML supported)
            </label>
            <Textarea
              placeholder="Write your email content here... HTML tags are supported."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-36 bg-background/50 border-border/40 focus:border-primary/50 resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                Recipients
              </label>
              <select
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                className="w-full h-10 rounded-lg border border-border/40 bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20"
              >
                {Object.entries(SEGMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {segment === "specific" && (
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                  Email Address
                </label>
                <Input
                  type="email"
                  placeholder="user@example.com"
                  value={specificEmail}
                  onChange={(e) => setSpecificEmail(e.target.value)}
                  className="h-10 bg-background/50 border-border/40 focus:border-primary/50"
                />
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                Category (opt-in filter)
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-10 rounded-lg border border-border/40 bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20"
              >
                {CATEGORY_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-3">
            <Users
              className="h-4 w-4 text-primary shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">
                Sends to:{" "}
                {segment === "specific"
                  ? specificEmail || "no address entered yet"
                  : SEGMENT_LABELS[segment]}
              </p>
              {category !== "none" && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Only users opted into{" "}
                  {CATEGORY_OPTIONS.find((c) => c.value === category)?.label}
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2 border-border/40"
                  disabled={!title && !content}
                >
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  Preview
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto">
                <DialogHeader className="pb-4">
                  <DialogTitle>Email Preview</DialogTitle>
                </DialogHeader>
                <iframe
                  srcDoc={generateEmailPreviewHtml({
                    title,
                    bodyHtml:
                      content || "<p>Email content will appear here...</p>",
                    appName: APP_NAME,
                    appUrl: APP_URL,
                  })}
                  sandbox=""
                  className="w-full h-[700px] border border-border/50 rounded-lg"
                  title="Email Preview"
                />
              </DialogContent>
            </Dialog>

            <Button
              onClick={handleCreate}
              disabled={loading || !isFormValid}
              className="gap-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileEdit className="h-4 w-4" aria-hidden="true" />
              )}
              Save as Draft
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Broadcasts list card */}
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Send className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Broadcasts
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {messages.length} total, {drafts.length} draft
                {drafts.length !== 1 ? "s" : ""}, {sent.length} sent
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-border/40 shrink-0"
            onClick={fetchMessages}
            disabled={loading}
            aria-label="Refresh broadcasts"
          >
            <RefreshCw
              className={cn("h-4 w-4", loading && "animate-spin")}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

        {loading && messages.length === 0 ? (
          <div className="p-4 sm:p-5">
            <DataTableSkeleton rows={5} />
          </div>
        ) : messages.length === 0 ? (
          <EmptyState
            icon={MailOpen}
            title="No broadcasts yet"
            description="Compose your first broadcast email above"
          />
        ) : visibleMessages.length === 0 ? (
          <EmptyState
            icon={MailOpen}
            title={`No ${historyFilter} broadcasts`}
            description="Try a different filter above."
          />
        ) : (
          <div className="divide-y divide-border/40">
            {visibleMessages.map((msg) => {
              const isDraft = msg.status === "draft";
              const isSending = sending === msg.id;
              const isDeleting = deleting === msg.id;
              return (
                <div
                  key={msg.id}
                  className="group flex items-start gap-4 px-4 sm:px-5 py-4 hover:bg-muted/20 transition-colors"
                >
                  {/* Icon */}
                  <div
                    className={cn(
                      "p-2 rounded-lg shrink-0 mt-0.5",
                      isDraft
                        ? "bg-[hsl(var(--warning))]/10"
                        : "bg-[hsl(var(--success))]/10",
                    )}
                  >
                    {isDraft ? (
                      <FileEdit
                        className="h-4 w-4 text-[hsl(var(--warning))]"
                        aria-hidden="true"
                      />
                    ) : (
                      <CheckCircle2
                        className="h-4 w-4 text-[hsl(var(--success))]"
                        aria-hidden="true"
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground truncate">
                        {msg.title}
                      </p>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-2 py-0.5 font-medium capitalize shrink-0",
                          isDraft
                            ? "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20"
                            : "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
                        )}
                      >
                        {msg.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {new Date(msg.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                      {msg.created_by_name && (
                        <span className="text-xs text-muted-foreground">
                          by{" "}
                          <span className="text-foreground font-medium">
                            {msg.created_by_name}
                          </span>
                        </span>
                      )}
                      {!isDraft && msg.sent_at && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Send className="h-3 w-3" aria-hidden="true" />
                          Sent{" "}
                          {new Date(msg.sent_at).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {msg.sent_by_name && (
                            <span>
                              by{" "}
                              <span className="text-foreground font-medium">
                                {msg.sent_by_name}
                              </span>
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity">
                    {isDraft ? (
                      <>
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => setPendingSend(msg)}
                          disabled={isSending || isDeleting}
                        >
                          {isSending ? (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <Send className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          Send
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0 border-border/40 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setPendingDelete(msg)}
                          disabled={isSending || isDeleting}
                          title="Delete draft"
                          aria-label={`Delete draft: ${msg.title}`}
                        >
                          {isDeleting ? (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <Trash2
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          )}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs border-border/40"
                        onClick={() => setPendingSend(msg)}
                        disabled={isSending}
                      >
                        {isSending ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <RefreshCw
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        )}
                        Resend
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Delete Confirmation Modal */}
      <SaveConfirmationModal
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title="Delete Broadcast"
        description="This will permanently delete this broadcast draft. This action cannot be undone."
        changes={
          pendingDelete
            ? [
                {
                  field: "title",
                  label: "Subject",
                  oldValue: pendingDelete.title,
                  newValue: "Deleted",
                },
                {
                  field: "status",
                  label: "Status",
                  oldValue: pendingDelete.status,
                  newValue: "Deleted",
                },
                {
                  field: "created_at",
                  label: "Created",
                  oldValue: new Date(
                    pendingDelete.created_at,
                  ).toLocaleDateString(),
                  newValue: "Removed",
                },
              ]
            : []
        }
        loading={deleting === pendingDelete?.id}
        confirmText="Delete"
        variant="destructive"
      />

      {/* Send / Resend Confirmation Modal */}
      <SaveConfirmationModal
        isOpen={!!pendingSend}
        onClose={() => setPendingSend(null)}
        onConfirm={async () => {
          if (!pendingSend) return { ok: false };
          const result =
            pendingSend.status === "draft"
              ? await handleSend(pendingSend.id)
              : await handleResend(pendingSend.id);
          if (result.ok) setPendingSend(null);
          return result;
        }}
        title={
          pendingSend?.status === "draft"
            ? "Send Broadcast"
            : "Resend Broadcast"
        }
        description={
          pendingSend
            ? pendingSend.status === "draft"
              ? `This immediately emails everyone in the audience selected when "${pendingSend.title}" was drafted. It cannot be undone once sending starts.`
              : `This emails the audience for "${pendingSend.title}" again, including anyone who already received it. It cannot be undone once sending starts.`
            : undefined
        }
        changes={
          pendingSend
            ? [
                pendingSend.status === "draft"
                  ? {
                      field: "status",
                      label: "Status",
                      oldValue: "Draft",
                      newValue: "Sent",
                    }
                  : {
                      field: "status",
                      label: "Status",
                      oldValue: "Sent",
                      newValue: "Resending",
                    },
              ]
            : []
        }
        loading={sending === pendingSend?.id}
        confirmText={
          pendingSend?.status === "draft" ? "Send Now" : "Resend Now"
        }
        variant="destructive"
      />
    </div>
  );
}
