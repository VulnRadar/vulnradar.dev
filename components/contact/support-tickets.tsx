"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/ui/utils";
import { getQueryParamInt } from "@/lib/ui/url-state";
import { API, ROUTES } from "@/lib/config/constants";
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_SUBJECT_MAX,
  TICKET_MESSAGE_MAX,
  OPEN_TICKET_STATUSES,
  type TicketCategory,
  type TicketStatus,
} from "@/lib/support/ticket-constants";

interface TicketListItem {
  id: number;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  created_at: string;
  last_message_at: string;
  message_count: number;
  /** True when this ticket was shared with the viewer by a teammate. */
  shared: boolean;
  shared_owner_name: string | null;
}

interface ThreadMessage {
  id: number;
  isStaff: boolean;
  body: string;
  createdAt: string;
  authorName: string | null;
  /** The viewer authored this message. */
  mine: boolean;
}

interface Thread {
  ticket: {
    id: number;
    subject: string;
    category: TicketCategory;
    status: TicketStatus;
  };
  messages: ThreadMessage[];
  viewerIsStaff: boolean;
  viewerIsOwner: boolean;
}

interface ShareEntry {
  userId: number;
  email: string;
  name: string | null;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const STATUS_STYLES: Record<TicketStatus, string> = {
  open: "bg-primary/10 text-primary border-primary/20",
  awaiting_staff: "bg-primary/10 text-primary border-primary/20",
  awaiting_user:
    "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20",
  resolved:
    "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
  closed: "bg-muted text-muted-foreground border-border",
};

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

export function SupportTickets() {
  const { me, isLoading } = useAuth();

  const [tickets, setTickets] = useState<TicketListItem[] | null>(null);
  const [view, setView] = useState<"list" | "new" | "thread">("list");
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-ticket form
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("other");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reply box
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);

  // Sharing with teammates (owner only)
  const [showShare, setShowShare] = useState(false);
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [eligible, setEligible] = useState<ShareEntry[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);

  const loadTickets = useCallback(async () => {
    try {
      const res = await fetch(API.SUPPORT_TICKETS);
      if (!res.ok) throw new Error("Could not load your tickets.");
      const data = await res.json();
      setTickets(data.tickets ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your tickets.");
      setTickets([]);
    }
  }, []);

  const openThread = useCallback(async (id: number) => {
    setView("thread");
    setThreadLoading(true);
    setShowShare(false);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState runs only in loadTickets' async continuation
    if (me) void loadTickets();
  }, [me, loadTickets]);

  // Deep link from the notification email / bell (?ticket=N). Read from the URL
  // on mount (window-based, like the rest of the contact page) rather than via
  // useSearchParams, which would force a Suspense boundary at build time.
  useEffect(() => {
    if (!me) return;
    const id = getQueryParamInt("ticket");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot deep-link open on mount
    if (id && id > 0) void openThread(id);
    // Only react to the initial deep link, not to every openThread identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  if (isLoading) return null;
  if (!me) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
        <a href={ROUTES.LOGIN} className="text-primary hover:underline">
          Sign in
        </a>{" "}
        to open a tracked support ticket and talk to our team directly. Every
        plan, including the free tier, can open tickets.
      </div>
    );
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(API.SUPPORT_TICKETS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, category, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not open the ticket.");
      setSubject("");
      setMessage("");
      setCategory("other");
      await loadTickets();
      await openThread(data.ticket.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the ticket.");
    } finally {
      setSubmitting(false);
    }
  }

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
      if (!res.ok) throw new Error(data?.error || "Could not send your reply.");
      setReply("");
      await openThread(thread.ticket.id);
      void loadTickets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your reply.");
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
      void loadTickets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the ticket.");
    }
  }

  async function loadShares(ticketId: number) {
    setSharesLoading(true);
    try {
      const res = await fetch(API.SUPPORT_TICKET_SHARES(ticketId));
      if (!res.ok) throw new Error("Could not load sharing.");
      const data = await res.json();
      setShares(data.shares ?? []);
      setEligible(data.eligible ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sharing.");
    } finally {
      setSharesLoading(false);
    }
  }

  async function toggleShare() {
    if (!thread) return;
    const next = !showShare;
    setShowShare(next);
    if (next) await loadShares(thread.ticket.id);
  }

  async function addShare(userId: number) {
    if (!thread) return;
    setError(null);
    try {
      const res = await fetch(API.SUPPORT_TICKET_SHARES(thread.ticket.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Could not share the ticket.");
      }
      await loadShares(thread.ticket.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not share the ticket.");
    }
  }

  async function removeShare(userId: number) {
    if (!thread) return;
    setError(null);
    try {
      const res = await fetch(
        `${API.SUPPORT_TICKET_SHARES(thread.ticket.id)}?userId=${userId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Could not update sharing.");
      await loadShares(thread.ticket.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update sharing.");
    }
  }

  return (
    <section className="mt-10 border-t border-border/50 pt-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Your support tickets
          </h2>
          <p className="text-sm text-muted-foreground">
            Talk to our team directly. We reply by email and in your
            notifications.
          </p>
        </div>
        {view !== "new" && (
          <Button
            size="sm"
            onClick={() => {
              setView("new");
              setError(null);
            }}
          >
            New ticket
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {view === "new" && (
        <form
          onSubmit={submitNew}
          className="space-y-4 rounded-lg border border-border/60 bg-card p-4 sm:p-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="ticket-subject">Subject</Label>
            <Input
              id="ticket-subject"
              value={subject}
              maxLength={TICKET_SUBJECT_MAX}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary of the issue"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ticket-category">Category</Label>
            <select
              id="ticket-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as TicketCategory)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {TICKET_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ticket-message">Message</Label>
            <Textarea
              id="ticket-message"
              value={message}
              maxLength={TICKET_MESSAGE_MAX}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what's going on. Include the URL you scanned or the invoice, if relevant."
              rows={5}
              required
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Opening..." : "Open ticket"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setView("list");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {view === "list" && (
        <div className="space-y-2">
          {tickets === null ? (
            <p className="text-sm text-muted-foreground">
              Loading your tickets...
            </p>
          ) : tickets.length === 0 ? (
            <p className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
              You have no tickets yet. Open one and we'll get back to you.
            </p>
          ) : (
            tickets.map((t) => (
              <button
                key={t.id}
                onClick={() => openThread(t.id)}
                className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {t.subject}
                    </span>
                    <StatusBadge status={t.status} />
                    {t.shared && (
                      <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Shared with you
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t.shared && t.shared_owner_name
                      ? `From ${t.shared_owner_name} · `
                      : ""}
                    {TICKET_CATEGORY_LABELS[t.category]} &middot;{" "}
                    {t.message_count}{" "}
                    {t.message_count === 1 ? "message" : "messages"} &middot;{" "}
                    {timeAgo(t.last_message_at)}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {view === "thread" && (
        <div className="rounded-lg border border-border/60 bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 p-3 sm:p-4">
            <div className="min-w-0">
              <button
                onClick={() => {
                  setView("list");
                  setThread(null);
                }}
                className="text-xs text-primary hover:underline"
              >
                &larr; All tickets
              </button>
              {thread && (
                <div className="mt-1 flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {thread.ticket.subject}
                  </span>
                  <StatusBadge status={thread.ticket.status} />
                </div>
              )}
            </div>
            {thread && (
              <div className="flex shrink-0 items-center gap-1.5">
                {thread.viewerIsOwner && (
                  <Button size="sm" variant="ghost" onClick={toggleShare}>
                    {showShare ? "Done" : "Share"}
                  </Button>
                )}
                {OPEN_TICKET_STATUSES.includes(thread.ticket.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setStatus("resolved")}
                  >
                    Mark resolved
                  </Button>
                )}
              </div>
            )}
          </div>

          {thread && thread.viewerIsOwner && showShare && (
            <div className="border-b border-border/60 bg-muted/20 p-3 sm:p-4">
              <p className="mb-2 text-xs font-medium text-foreground">
                Share this ticket with a teammate
              </p>
              {sharesLoading ? (
                <p className="text-xs text-muted-foreground">Loading...</p>
              ) : (
                <div className="space-y-3">
                  {shares.length > 0 && (
                    <div className="space-y-1.5">
                      {shares.map((s) => (
                        <div
                          key={s.userId}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="truncate text-foreground">
                            {s.name ? `${s.name} (${s.email})` : s.email}
                          </span>
                          <button
                            onClick={() => removeShare(s.userId)}
                            className="shrink-0 text-xs text-destructive hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {eligible.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {eligible.map((u) => (
                        <button
                          key={u.userId}
                          onClick={() => addShare(u.userId)}
                          className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                        >
                          + {u.name ?? u.email}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {shares.length > 0
                        ? "Everyone on your team already has access."
                        : "No teammates to share with yet. Add people to a team first."}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {threadLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading...</p>
          ) : thread ? (
            <>
              <div className="max-h-[26rem] space-y-3 overflow-y-auto p-3 sm:p-4">
                {thread.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex flex-col gap-1",
                      m.mine ? "items-end" : "items-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words",
                        m.mine
                          ? "rounded-tr-sm bg-primary text-primary-foreground"
                          : "rounded-tl-sm bg-muted text-foreground",
                      )}
                    >
                      {m.body}
                    </div>
                    <span className="px-1 text-[11px] text-muted-foreground">
                      {m.mine
                        ? "You"
                        : m.isStaff
                          ? (m.authorName ?? "Support")
                          : (m.authorName ?? "Teammate")}{" "}
                      &middot; {timeAgo(m.createdAt)}
                    </span>
                  </div>
                ))}
              </div>

              {thread.ticket.status === "closed" ? (
                <p className="border-t border-border/60 p-4 text-sm text-muted-foreground">
                  This ticket is closed. Open a new ticket to continue.
                </p>
              ) : (
                <form
                  onSubmit={sendReply}
                  className="space-y-2 border-t border-border/60 p-3 sm:p-4"
                >
                  <Textarea
                    value={reply}
                    maxLength={TICKET_MESSAGE_MAX}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Write a reply..."
                    rows={3}
                    required
                  />
                  <div className="flex items-center gap-2">
                    <Button type="submit" size="sm" disabled={replying}>
                      {replying ? "Sending..." : "Send reply"}
                    </Button>
                    {thread.ticket.status !== "resolved" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setStatus("closed")}
                      >
                        Close ticket
                      </Button>
                    )}
                  </div>
                </form>
              )}
            </>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              Could not load this ticket.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
