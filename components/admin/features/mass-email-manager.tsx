"use client";

import { useState, useEffect, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogBody,
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
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import {
  APP_NAME,
  APP_URL,
  LOGO_URL,
  SUPPORT_EMAIL,
} from "@/lib/config/client-constants";
import { getPaidPlans } from "@/lib/billing/catalog";
import { SaveConfirmationModal } from "@/components/shared/save-confirmation-modal";
import {
  AdminPanelHeader,
  EmptyState,
  DataTableSkeleton,
  StatBar,
  StatusPill,
  Toast,
  generateEmailPreviewHtml,
} from "@/components/admin/shared";
import { formatTimestamp } from "@/components/admin/utils";
import type { ToastState } from "@/components/admin/types";

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

/** The DB enum was rendered straight into the row with `capitalize`, so the
 *  column showed the column value rather than a label anyone chose. */
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
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
  const [toast, setToast] = useState<ToastState | null>(null);

  // Stable ids so each <label htmlFor> actually names its control. Without
  // them a screen reader reads four unnamed fields in a row, one of which
  // decides whether the blast goes to one person or every registered user.
  const subjectId = useId();
  const contentId = useId();
  const segmentId = useId();
  const specificEmailId = useId();
  const categoryId = useId();

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
      if (!res.ok) {
        // Never clear the composer on failure: the draft body is the only
        // copy of what the admin just wrote, and a silent no-op here used
        // to lose it with no warning at all.
        const data = await res.json().catch(() => ({}));
        setToast({
          message: data.error || "Failed to save draft. Your text is intact.",
          type: "error",
        });
        return;
      }
      setTitle("");
      setContent("");
      setSegment("all");
      setSpecificEmail("");
      setCategory("none");
      setToast({ message: "Draft saved.", type: "success" });
      fetchMessages();
    } catch (err) {
      console.error("Error creating message:", err);
      setToast({
        message: "Failed to save draft. Your text is intact.",
        type: "error",
      });
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
          // A "Contributors" segment used to sit here: a new Set(...).size over
          // created_by_name, with no tone, nothing filtering on it and no
          // decision it could inform. Every other segment in this strip filters
          // the list below it.
        ]}
      />

      {/* Compose */}
      <div className="overflow-hidden rounded-xl border border-border/50 bg-card/50">
        <AdminPanelHeader
          icon={Mail}
          title="Compose Broadcast"
          subtitle="Saving only stores a draft. Nothing reaches an inbox until you send it from the list below."
        />
        <div className="p-4 sm:p-5 space-y-4">
          <div>
            <label
              htmlFor={subjectId}
              className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block"
            >
              Subject
            </label>
            <Input
              id={subjectId}
              placeholder={`e.g., Important update from ${APP_NAME}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-10 bg-background/50 border-border/40 focus:border-primary/50"
            />
          </div>

          <div>
            <label
              htmlFor={contentId}
              className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block"
            >
              Content (HTML supported)
            </label>
            <Textarea
              id={contentId}
              placeholder="Write your email content here... HTML tags are supported."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-36 bg-background/50 border-border/40 focus:border-primary/50 resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={segmentId}
                className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block"
              >
                Recipients
              </label>
              <select
                id={segmentId}
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                // rounded-md: a select is a control, and every other one in
                // the admin panel is drawn on that rung of the radius ladder.
                className="w-full h-10 rounded-md border border-border/40 bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20"
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
                <label
                  htmlFor={specificEmailId}
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block"
                >
                  Email Address
                </label>
                <Input
                  id={specificEmailId}
                  type="email"
                  placeholder="user@example.com"
                  value={specificEmail}
                  onChange={(e) => setSpecificEmail(e.target.value)}
                  className="h-10 bg-background/50 border-border/40 focus:border-primary/50"
                />
              </div>
            )}
            <div>
              <label
                htmlFor={categoryId}
                className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block"
              >
                Category (opt-in filter)
              </label>
              <select
                id={categoryId}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                // rounded-md: a select is a control, and every other one in
                // the admin panel is drawn on that rung of the radius ladder.
                className="w-full h-10 rounded-md border border-border/40 bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20"
              >
                {CATEGORY_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* The recipient readout escalates with the blast radius. It was
              the calm brand tint at every setting, so "All Users", which is
              every registered account and the one selection that cannot be
              taken back, was drawn exactly like sending to one address. */}
          <div
            className={cn(
              "flex items-start gap-2.5 rounded-lg border px-3.5 py-3",
              segment === "all"
                ? "border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10"
                : "border-primary/20 bg-primary/5",
            )}
          >
            {segment === "all" ? (
              <AlertTriangle
                className="h-4 w-4 text-[hsl(var(--warning))] shrink-0 mt-0.5"
                aria-hidden="true"
              />
            ) : (
              <Users
                className="h-4 w-4 text-primary shrink-0 mt-0.5"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">
                Sends to:{" "}
                {segment === "specific"
                  ? specificEmail || "no address entered yet"
                  : SEGMENT_LABELS[segment]}
              </p>
              {segment === "all" && (
                <p className="text-xs text-[hsl(var(--warning))] mt-0.5">
                  Every registered account, free and paid.
                </p>
              )}
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
              {/* An email body is rendered at its real width and no size rung
                  matches it, so the width stays a bare class. The ladder in
                  modal-grammar.ts is unprefixed for exactly this: tailwind-merge
                  only drops a conflicting class within the same modifier, so a
                  responsive rung could not be overridden by a plain width. */}
              <DialogContent variant="shell" className="max-w-5xl">
                <DialogHeader>
                  <DialogTitle>Email Preview</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <iframe
                    srcDoc={generateEmailPreviewHtml({
                      title,
                      bodyHtml:
                        content || "<p>Email content will appear here...</p>",
                      appName: APP_NAME,
                      appUrl: APP_URL,
                      logoSrc: LOGO_URL,
                      supportEmail: SUPPORT_EMAIL,
                      // Every broadcast recipient has an unsubscribe token, so
                      // the real message always carries this button. The preview
                      // used to omit it entirely, which is how an admin could
                      // sign off on a footer the recipient never sees. The href
                      // is the real page, unresolvable without a token, and the
                      // iframe is sandboxed so it is not clickable anyway.
                      unsubscribeUrl: `${APP_URL}/unsubscribe`,
                    })}
                    sandbox=""
                    // rounded-xl: a 700px full-bleed content surface is a panel,
                    // not a small card.
                    className="w-full h-[700px] border border-border/50 rounded-xl"
                    title="Email Preview"
                  />
                </DialogBody>
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
        </div>
      </div>

      {/* Broadcasts list */}
      <div className="overflow-hidden rounded-xl border border-border/50 bg-card/50">
        <AdminPanelHeader
          icon={Send}
          title="Broadcasts"
          // The subtitle used to reprint the strip 200px above it ("N total,
          // N drafts, N sent"), so the same three numbers appeared twice on
          // one screen. It says what the list does instead.
          subtitle="Sending is immediate and cannot be undone. A resend goes to the whole audience again, including everyone who already received it."
          actions={
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 gap-2 border-border/40 shrink-0"
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
          }
        />

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
                      <StatusPill tone={isDraft ? "warn" : "ok"}>
                        {STATUS_LABELS[msg.status] ?? msg.status}
                      </StatusPill>
                    </div>
                    {/* One timestamp format, from formatTimestamp. This row
                        used to print three: a date-only created stamp, a
                        date-plus-time sent stamp, and the delete modal's
                        locale-dependent toLocaleDateString, none of them
                        tabular. */}
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground flex items-center gap-1 tabular-nums">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {formatTimestamp(msg.created_at)}
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
                        <span className="text-xs text-muted-foreground flex items-center gap-1 tabular-nums">
                          <Send className="h-3 w-3" aria-hidden="true" />
                          Sent {formatTimestamp(msg.sent_at)}
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

                  {/* Actions. The row's primary action stays visible at rest,
                      the way the support inbox's Resolve and Close do: the
                      whole cluster used to fade in on hover, so on a desktop
                      the only way to find out a draft could be sent was to
                      point at its row. Only Delete keeps the fade, and it
                      keeps the md: prefix because touch devices have no
                      hover, where an unprefixed opacity-0 would leave it
                      permanently invisible but still hit-testable. */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isDraft ? (
                      <>
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 px-3 text-xs"
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
                          Send now
                        </Button>
                        {/* Deleting a draft is reversible in the sense that
                            nothing left the building; sending is not. This
                            button used to be the heavier of the two, an
                            outlined destructive control beside a plain filled
                            Send, which had the hierarchy exactly backwards. */}
                        <Button
                          size="sm"
                          variant="ghost"
                          className={cn(
                            "h-11 w-11 sm:h-8 sm:w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10",
                            "md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100 transition",
                          )}
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
                      // Resend emails the whole audience a second time. With a
                      // RefreshCw glyph on a neutral outline it read as a
                      // reload button, which is the one thing it is not.
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 px-3 text-xs border-[hsl(var(--warning))]/30 text-[hsl(var(--warning))] hover:bg-[hsl(var(--warning))]/10 hover:text-[hsl(var(--warning))]"
                        onClick={() => setPendingSend(msg)}
                        disabled={isSending}
                      >
                        {isSending ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Send again
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
                  oldValue:
                    STATUS_LABELS[pendingDelete.status] ?? pendingDelete.status,
                  newValue: "Deleted",
                },
                {
                  field: "created_at",
                  label: "Created",
                  // Was toLocaleDateString() with no locale, so this one date
                  // followed the browser while the row above it is pinned.
                  oldValue: formatTimestamp(pendingDelete.created_at),
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

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
