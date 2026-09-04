"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Inbox,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { InlineAlert } from "@/components/shared/inline-alert";
import { cn } from "@/lib/ui/utils";
import { formatRelativeTime } from "@/lib/ui/relative-time";
import { API } from "@/lib/config/client-constants";
import {
  TICKET_CATEGORY_LABELS,
  TICKET_MESSAGE_MAX,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketStatus,
  STAFF_TICKET_STATUS_LABELS,
} from "@/lib/support/ticket-constants";

interface InboxTicket {
  id: number;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  created_at: string;
  last_message_at: string;
  owner_id: number;
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
    createdAt?: string;
    ownerEmail?: string;
    ownerName?: string | null;
  };
  messages: ThreadMessage[];
}

const FILTERS: { key: string; label: string }[] = [
  { key: "active", label: "Active" },
  // "Needs reply" filters on awaiting_staff, which is set when a user replies
  // to a thread that already has one. A brand new ticket is `open` and is just
  // as unanswered, so it needs a queue of its own or it is only ever visible
  // inside Active. The health row counts both together for the same reason.
  { key: "open", label: "New" },
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

/** Left rail on a list row: colour only where the queue owes someone an answer. */
const STATUS_RAIL: Record<TicketStatus, string> = {
  open: "bg-primary",
  awaiting_staff: "bg-[hsl(var(--warning))]",
  awaiting_user: "bg-transparent",
  resolved: "bg-transparent",
  closed: "bg-transparent",
};

/**
 * TICKET_STATUS_LABELS is written from the requester's point of view, so
 * `awaiting_user` reads "Awaiting your reply" there. In the staff inbox that
 * is backwards: it is the one status where nothing is waiting on us. Staff get
 * their own wording, matching the filter names directly above the list.
 */
function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        STATUS_STYLES[status],
      )}
    >
      {STAFF_TICKET_STATUS_LABELS[status]}
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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The message list scrolls inside the thread pane, so the newest reply is at
  // the bottom of its own scroller and a long thread used to open showing the
  // oldest message. Jump to the end whenever a thread loads or a reply lands.
  const messagesRef = useRef<HTMLDivElement>(null);

  // The list row behind the open thread. The thread endpoint returns only the
  // owner's email, not their id, so the account link comes from here.
  const openTicket = tickets?.find((t) => t.id === openId) ?? null;

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

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);

  async function refresh() {
    setRefreshing(true);
    try {
      await loadInbox();
      if (openId !== null) await openThread(openId);
    } finally {
      setRefreshing(false);
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

  /** Filter counts come from a GROUP BY over every ticket, not the page. */
  function filterCount(key: string): number | null {
    if (Object.keys(counts).length === 0) return null;
    if (key === "all") {
      return Object.values(counts).reduce((sum, n) => sum + n, 0);
    }
    if (key === "active") {
      return (
        (counts.open ?? 0) +
        (counts.awaiting_staff ?? 0) +
        (counts.awaiting_user ?? 0)
      );
    }
    return counts[key] ?? 0;
  }

  // When the filter pins one status, every row in the list has that status and
  // the selected chip already names it, so a per-row badge repeats the same
  // word down the whole column. Active and All are the mixed views, and those
  // are the ones where the badge earns its place.
  const filterPinsStatus = TICKET_STATUSES.includes(filter as TicketStatus);
  // Unanswered means open OR awaiting_staff, the same pair the Overview
  // health row counts. Reading awaiting_staff alone would have this line
  // claim nothing is waiting while brand new tickets sat untouched.
  const needsReply = (counts.open ?? 0) + (counts.awaiting_staff ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Support tickets
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {needsReply > 0
              ? `${needsReply} ${needsReply === 1 ? "ticket is" : "tickets are"} waiting on a staff reply.`
              : "Nothing is waiting on a staff reply right now."}{" "}
            Replying moves a ticket to &ldquo;awaiting user&rdquo;; the
            requester is emailed and notified in-app.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-2 px-3"
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh support inbox"
        >
          <RefreshCw
            className={cn("h-4 w-4", refreshing && "animate-spin")}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* Filters carry their own counts, so the size of each queue is readable
          without selecting it. The two unanswered queues stay amber while they
          are non-empty, even when another filter is selected. */}
      <div className="-mx-1 flex gap-1.5 scroll-x-only px-1 pb-1">
        {FILTERS.map((f) => {
          const selected = filter === f.key;
          const count = filterCount(f.key);
          const urgent =
            (f.key === "awaiting_staff" || f.key === "open") &&
            (count ?? 0) > 0;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setFilter(f.key);
                setOpenId(null);
                setThread(null);
              }}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 ease-out",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : urgent
                    ? "border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] hover:bg-[hsl(var(--warning))]/15"
                    : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              {f.label}
              {count !== null && (
                <span className="font-mono text-[11px] tabular-nums opacity-70">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {/* Two panes of equal height on desktop: the list scrolls on its own and
          the composer sits inside the thread pane, so the reply box is on
          screen without scrolling the admin page past a long conversation.
          On mobile the panes swap rather than stack, the way a mail app does. */}
      <div className="grid gap-4 lg:h-[38rem] lg:grid-cols-[minmax(0,21rem)_1fr]">
        <div
          className={cn(
            "flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card",
            openId !== null && "hidden lg:flex",
          )}
        >
          {/* No title bar on this pane: the selected filter chip immediately
              above it already carries the same label and the same count, so
              the header was that pair written twice, a few pixels apart. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tickets === null ? (
              // Four bands, in the order a real row draws them: subject and
              // time, requester, the clamped last message, then the meta line.
              // A single centred spinner told the reader nothing about the
              // shape of what was coming.
              <div role="status" aria-label="Loading tickets">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-1.5 border-b border-border/40 px-4 py-3 pl-5 last:border-b-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Skeleton className="h-3.5 w-1/2" />
                      <Skeleton className="h-3 w-10 shrink-0" />
                    </div>
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="mt-0.5 h-3 w-1/3" />
                  </div>
                ))}
              </div>
            ) : tickets.length === 0 ? (
              <EmptyState
                variant="inline"
                size="sm"
                icon={Inbox}
                title="Nothing in this view"
                // The awaiting_staff wording used to be "No ticket is waiting
                // on a staff reply", which is the sentence the header above
                // already writes when that queue is clear.
                description="Try another filter to see tickets in other states."
              />
            ) : (
              tickets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openThread(t.id)}
                  aria-current={openId === t.id ? "true" : undefined}
                  className={cn(
                    "relative flex w-full flex-col gap-1 border-b border-border/40 px-4 py-3 pl-5 text-left transition-colors duration-200 ease-out last:border-b-0",
                    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    openId === t.id ? "bg-primary/5" : "hover:bg-muted/30",
                  )}
                >
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 w-0.5",
                      STATUS_RAIL[t.status],
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-sm text-foreground",
                        openId === t.id ? "font-semibold" : "font-medium",
                      )}
                    >
                      {t.subject}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {formatRelativeTime(t.last_message_at)}
                    </span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t.owner_name ? `${t.owner_name} · ` : ""}
                    {t.owner_email}
                  </span>
                  {/* The list query already selects the newest message body.
                      It was fetched and thrown away, so triaging the queue
                      meant opening every thread to find out what it said. */}
                  {t.last_message && (
                    <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground/80">
                      {t.last_message}
                    </span>
                  )}
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {!filterPinsStatus && <StatusBadge status={t.status} />}
                    <span className="text-[11px] text-muted-foreground">
                      {TICKET_CATEGORY_LABELS[t.category]} &middot;{" "}
                      {t.message_count}{" "}
                      {t.message_count === 1 ? "message" : "messages"}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Thread */}
        <div
          className={cn(
            "flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card",
            openId === null && "hidden lg:flex",
          )}
        >
          {!openId ? (
            <EmptyState
              variant="inline"
              icon={MessageSquare}
              title="No ticket selected"
              description="Pick a ticket on the left to read the conversation and reply."
              className="my-auto"
            />
          ) : threadLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading conversation...
            </div>
          ) : thread ? (
            <>
              <div className="shrink-0 border-b border-border/60 px-4 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 mb-1 h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground lg:hidden"
                  onClick={() => {
                    setOpenId(null);
                    setThread(null);
                  }}
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Back to inbox
                </Button>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {thread.ticket.subject}
                      </h3>
                      <StatusBadge status={thread.ticket.status} />
                    </div>
                    {/* The requester's address is a link to their account.
                        It used to be plain text, so cross-referencing a ticket
                        against the account it came from meant copying the email,
                        switching to Users (which discards the open ticket),
                        pasting, and coming back. */}
                    {/* wrap-anywhere, not truncate. The requester's address
                        leads this line and the category and the opened-at
                        stamp follow it, so one clipped line threw away both of
                        the parts we wrote and kept only a fragment of the
                        address. */}
                    <p className="mt-0.5 wrap-anywhere text-xs text-muted-foreground">
                      {openTicket ? (
                        <a
                          href={`/admin?tab=users&user=${openTicket.owner_id}`}
                          className="text-primary hover:underline"
                        >
                          {thread.ticket.ownerName ??
                            thread.ticket.ownerEmail ??
                            openTicket.owner_email}
                        </a>
                      ) : (
                        thread.ticket.ownerEmail
                      )}{" "}
                      &middot; {TICKET_CATEGORY_LABELS[thread.ticket.category]}
                      {thread.ticket.createdAt
                        ? ` · opened ${formatRelativeTime(thread.ticket.createdAt)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {thread.ticket.status !== "resolved" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 px-2.5 text-xs"
                        onClick={() => setStatus("resolved")}
                      >
                        <CheckCircle2
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        Resolve
                      </Button>
                    )}
                    {thread.ticket.status !== "closed" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setStatus("closed")}
                      >
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        Close
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div
                ref={messagesRef}
                // The pane has no fixed height below lg, so the history needs
                // its own cap there or a long thread pushes the reply box off
                // the bottom of the phone screen.
                className="min-h-0 max-h-[60vh] flex-1 space-y-4 overflow-y-auto px-4 py-4 lg:max-h-none"
              >
                {thread.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex flex-col gap-1",
                      m.isStaff ? "items-end" : "items-start",
                    )}
                  >
                    <span className="px-1 text-[11px] text-muted-foreground">
                      {m.isStaff
                        ? (m.authorName ?? "Staff")
                        : (m.authorName ?? "User")}{" "}
                      &middot; {formatRelativeTime(m.createdAt)}
                    </span>
                    {/* Tinted rather than a solid primary block: a saturated
                        fill behind a five-paragraph reply is hard to read, and
                        the alignment plus the author line already say who
                        wrote it. */}
                    <div
                      className={cn(
                        "max-w-[42rem] rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
                        m.isStaff
                          ? "rounded-tr-sm border-primary/25 bg-primary/10 text-foreground"
                          : "rounded-tl-sm border-border/60 bg-muted/40 text-foreground",
                      )}
                    >
                      {m.body}
                    </div>
                  </div>
                ))}
              </div>

              {thread.ticket.status === "closed" ? (
                // Only the consequence, not the state: the Closed badge at the
                // top of this same pane already names it, and this line used
                // to open by repeating the word.
                <p className="shrink-0 border-t border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                  Nobody can add to this ticket. Resolve it to reply again.
                </p>
              ) : (
                <form
                  onSubmit={sendReply}
                  className="shrink-0 border-t border-border/60 bg-muted/10 p-3"
                >
                  <Textarea
                    value={reply}
                    maxLength={TICKET_MESSAGE_MAX}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Reply to the user..."
                    aria-label="Reply"
                    rows={3}
                    required
                    className="resize-none bg-background"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      className="h-8 gap-1.5"
                      disabled={replying || reply.trim().length === 0}
                    >
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />
                      {replying ? "Sending..." : "Send reply"}
                    </Button>
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                      {reply.length > 0
                        ? `${reply.length}/${TICKET_MESSAGE_MAX}`
                        : ""}
                    </span>
                  </div>
                </form>
              )}
            </>
          ) : (
            <EmptyState
              variant="inline"
              icon={XCircle}
              title="Could not load this ticket"
              description="The request failed. Refresh the inbox and try again."
              className="my-auto"
            />
          )}
        </div>
      </div>
    </div>
  );
}
