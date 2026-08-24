"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/ui/utils";
import { API } from "@/lib/config/constants";
import {
  TICKET_CATEGORY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_MESSAGE_MAX,
  type TicketCategory,
  type TicketStatus,
} from "@/lib/support/ticket-constants";

interface InboxTicket {
  id: number;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  created_at: string;
  last_message_at: string;
  owner_email: string;
  owner_name: string | null;
  message_count: number;
  last_message: string | null;
}

interface ThreadMessage {
  id: number;
  isStaff: boolean;
  body: string;
  createdAt: string;
  authorName: string | null;
}

interface Thread {
  ticket: {
    id: number;
    subject: string;
    category: TicketCategory;
    status: TicketStatus;
    ownerEmail?: string;
    ownerName?: string | null;
  };
  messages: ThreadMessage[];
}

const FILTERS: { key: string; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "awaiting_staff", label: "Needs reply" },
  { key: "awaiting_user", label: "Awaiting user" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

const STATUS_STYLES: Record<TicketStatus, string> = {
  open: "bg-primary/10 text-primary border-primary/20",
  awaiting_staff:
    "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20",
  awaiting_user: "bg-primary/10 text-primary border-primary/20",
  resolved:
    "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
  closed: "bg-muted text-muted-foreground border-border",
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        STATUS_STYLES[status],
      )}
    >
      {TICKET_STATUS_LABELS[status]}
    </span>
  );
}

export function SupportInbox() {
  const [filter, setFilter] = useState("active");
  const [tickets, setTickets] = useState<InboxTicket[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState<number | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    setError(null);
    try {
      const qs = filter === "active" ? "" : `?status=${filter}`;
      const res = await fetch(`${API.ADMIN_SUPPORT_TICKETS}${qs}`);
      if (!res.ok) throw new Error("Could not load the support inbox.");
      const data = await res.json();
      setTickets(data.tickets ?? []);
      setCounts(data.counts ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the inbox.");
      setTickets([]);
    }
  }, [filter]);

  const openThread = useCallback(async (id: number) => {
    setOpenId(id);
    setThreadLoading(true);
    setError(null);
    try {
      const res = await fetch(API.SUPPORT_TICKET(id));
      if (!res.ok) throw new Error("Could not open this ticket.");
      setThread(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open this ticket.");
      setThread(null);
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState runs only in loadInbox' async continuation
    void loadInbox();
  }, [loadInbox]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (replying || !thread) return;
    setReplying(true);
    setError(null);
    try {
      const res = await fetch(API.SUPPORT_TICKET(thread.ticket.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not send the reply.");
      setReply("");
      await openThread(thread.ticket.id);
      void loadInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the reply.");
    } finally {
      setReplying(false);
    }
  }

  async function setStatus(status: TicketStatus) {
    if (!thread) return;
    setError(null);
    try {
      const res = await fetch(API.SUPPORT_TICKET(thread.ticket.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Could not update the ticket.");
      }
      await openThread(thread.ticket.id);
      void loadInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the ticket.");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Support tickets
        </h2>
        <p className="text-sm text-muted-foreground">
          User-submitted tickets across every plan. Replying moves a ticket to
          &ldquo;awaiting user&rdquo;; the requester is emailed and notified
          in-app.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setFilter(f.key);
              setOpenId(null);
              setThread(null);
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === f.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/40",
            )}
          >
            {f.label}
            {f.key === "awaiting_staff" && counts.awaiting_staff
              ? ` (${counts.awaiting_staff})`
              : ""}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        {/* Ticket list */}
        <div className="space-y-2">
          {tickets === null ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : tickets.length === 0 ? (
            <p className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
              No tickets in this view.
            </p>
          ) : (
            tickets.map((t) => (
              <button
                key={t.id}
                onClick={() => openThread(t.id)}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-colors",
                  openId === t.id
                    ? "border-primary bg-primary/5"
                    : "border-border/60 bg-card hover:bg-muted/40",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {t.subject}
                  </span>
                  <StatusBadge status={t.status} />
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {t.owner_email} &middot; {TICKET_CATEGORY_LABELS[t.category]}{" "}
                  &middot; {timeAgo(t.last_message_at)}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Thread */}
        <div className="rounded-lg border border-border/60 bg-card">
          {!openId ? (
            <p className="p-6 text-sm text-muted-foreground">
              Select a ticket to read and reply.
            </p>
          ) : threadLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading...</p>
          ) : thread ? (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-border/60 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {thread.ticket.subject}
                    </span>
                    <StatusBadge status={thread.ticket.status} />
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {thread.ticket.ownerEmail} &middot;{" "}
                    {TICKET_CATEGORY_LABELS[thread.ticket.category]}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {thread.ticket.status !== "resolved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setStatus("resolved")}
                    >
                      Resolve
                    </Button>
                  )}
                  {thread.ticket.status !== "closed" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setStatus("closed")}
                    >
                      Close
                    </Button>
                  )}
                </div>
              </div>

              <div className="max-h-[26rem] space-y-3 overflow-y-auto p-4">
                {thread.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex flex-col gap-1",
                      m.isStaff ? "items-end" : "items-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words",
                        m.isStaff
                          ? "rounded-tr-sm bg-primary text-primary-foreground"
                          : "rounded-tl-sm bg-muted text-foreground",
                      )}
                    >
                      {m.body}
                    </div>
                    <span className="px-1 text-[11px] text-muted-foreground">
                      {m.isStaff
                        ? (m.authorName ?? "Staff")
                        : (m.authorName ?? "User")}{" "}
                      &middot; {timeAgo(m.createdAt)}
                    </span>
                  </div>
                ))}
              </div>

              {thread.ticket.status === "closed" ? (
                <p className="border-t border-border/60 p-4 text-sm text-muted-foreground">
                  This ticket is closed.
                </p>
              ) : (
                <form
                  onSubmit={sendReply}
                  className="space-y-2 border-t border-border/60 p-4"
                >
                  <Textarea
                    value={reply}
                    maxLength={TICKET_MESSAGE_MAX}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Reply to the user..."
                    rows={3}
                    required
                  />
                  <Button type="submit" size="sm" disabled={replying}>
                    {replying ? "Sending..." : "Send reply"}
                  </Button>
                </form>
              )}
            </>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">
              Could not load this ticket.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
