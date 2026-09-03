"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  LifeBuoy,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Users,
} from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/ui/utils";
import { formatRelativeTime } from "@/lib/ui/relative-time";
import { getQueryParamInt } from "@/lib/ui/url-state";
import { API, ROUTES, TURNSTILE_ENABLED } from "@/lib/config/client-constants";
import { TurnstileWidget } from "@/components/shared/turnstile-widget";
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_NEXT,
  TICKET_SUBJECT_MAX,
  TICKET_MESSAGE_MAX,
  OPEN_TICKET_STATUSES,
  type TicketCategory,
  type TicketStatus,
} from "@/lib/support/ticket-constants";
import { InlineAlert } from "@/components/shared/inline-alert";

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
    createdAt?: string;
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

// This file used to carry its own timeAgo, whose date fallback rendered
// "8/12/2026" -- verbatim one of the two defects lib/ui/relative-time.ts says
// it was written to remove. The staff view of the same ticket
// (components/admin/features/support-inbox.tsx) carried the other one, so a
// single ticket's last activity read differently to the user and to the staff
// member answering it.

const STATUS_STYLES: Record<TicketStatus, string> = {
  open: "bg-primary/10 text-primary border-primary/20",
  awaiting_staff: "bg-primary/10 text-primary border-primary/20",
  awaiting_user:
    "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20",
  resolved:
    "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
  closed: "bg-muted text-muted-foreground border-border",
};

// The badge says what state the ticket is in and TICKET_STATUS_NEXT says what
// happens next; the strip below pairs the sentence with the button that
// changes that state, above the conversation so neither is below the fold.
//
// Box and copy are tinted separately: the tone belongs on the sentence, not
// on the container, or it would also repaint the buttons sitting next to it
// (the outline and ghost variants both inherit their text colour).
const STATUS_STRIP: Record<TicketStatus, { box: string; text: string }> = {
  open: { box: "border-border/60 bg-muted/30", text: "text-muted-foreground" },
  awaiting_staff: {
    box: "border-border/60 bg-muted/30",
    text: "text-muted-foreground",
  },
  awaiting_user: {
    box: "border-[hsl(var(--warning))]/25 bg-[hsl(var(--warning))]/10",
    text: "text-[hsl(var(--warning))]",
  },
  resolved: {
    box: "border-[hsl(var(--success))]/25 bg-[hsl(var(--success))]/10",
    text: "text-[hsl(var(--success))]",
  },
  closed: {
    box: "border-border/60 bg-muted/30",
    text: "text-muted-foreground",
  },
};

function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
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
  /** The ticket the thread pane is showing, kept even when the fetch fails so
   *  the failure state can offer a retry rather than only a dead end. */
  const [threadId, setThreadId] = useState<number | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-ticket form
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("other");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  // Reply box
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);

  // Sharing with teammates (owner only)
  const [showShare, setShowShare] = useState(false);
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [eligible, setEligible] = useState<ShareEntry[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);

  // The history scrolls inside its own box, so the newest message is at the
  // bottom of that box. Without this a long thread opens on the message the
  // user sent weeks ago instead of the reply they came here to read.
  const messagesRef = useRef<HTMLDivElement>(null);

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
    setThreadId(id);
    // Drop a previously open thread before fetching a different one. The header
    // renders from `thread`, so holding the old object showed one ticket's
    // subject and status above another ticket's loading spinner. A reload of
    // the SAME ticket (after a reply or a status change) keeps it, so those do
    // not flash the header away.
    setThread((prev) => (prev && prev.ticket.id === id ? prev : null));
    setThreadLoading(true);
    setShowShare(false);
    setError(null);
    try {
      const res = await fetch(API.SUPPORT_TICKET(id));
      if (!res.ok) throw new Error("Could not open this ticket.");
      setThread(await res.json());
    } catch {
      // No banner: the thread pane's own failure state says this, and carries
      // the retry button. Setting both stated one failure twice on one screen.
      setThread(null);
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState runs only in loadTickets' async continuation
    if (me) void loadTickets();
  }, [me, loadTickets]);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);

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

  // Returning null here left the first and most prominent category on /contact
  // as a gap in the page, so the whole ticketing feature read as missing while
  // the auth check was in flight. Reserve the space instead.
  if (isLoading) {
    return (
      <div
        className="rounded-xl border border-border/60 bg-muted/20 p-4"
        role="status"
        aria-label="Loading support tickets"
      >
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-full max-w-md mt-2.5" />
        <Skeleton className="h-3 w-2/3 max-w-sm mt-1.5" />
      </div>
    );
  }
  if (!me) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
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
    if (TURNSTILE_ENABLED && !turnstileToken) {
      setError("Please complete the captcha verification.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(API.SUPPORT_TICKETS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          category,
          message,
          turnstileToken: TURNSTILE_ENABLED ? turnstileToken : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not open the ticket.");
      setSubject("");
      setMessage("");
      setCategory("other");
      setTurnstileToken(null);
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

  // Owner only, resolved only: `closed` is deliberately terminal for the
  // requester and the route 409s on posting to it.
  const canReopen =
    !!thread?.viewerIsOwner && thread.ticket.status === "resolved";

  return (
    <section className="mt-10 border-t border-border/50 pt-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Your support tickets
          </h2>
          {/* Where a reply turns up is said by whichever block is on screen
              below (the status strip on an open thread, the empty state on an
              empty list). Repeating it here put the same promise twice in
              every view. */}
          <p className="text-sm text-muted-foreground">
            Talk to our team directly.
          </p>
        </div>
        {view !== "new" && (
          <Button
            size="sm"
            className="h-9 shrink-0 gap-1.5 px-3"
            onClick={() => {
              setView("new");
              setError(null);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New ticket
          </Button>
        )}
      </div>

      {error && (
        <InlineAlert tone="error" className="mb-4">
          {error}
        </InlineAlert>
      )}

      {view === "new" && (
        <form
          onSubmit={submitNew}
          className="overflow-hidden rounded-xl border border-border/60 bg-card"
        >
          <div className="border-b border-border/60 bg-muted/20 px-4 py-2.5 sm:px-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              New ticket
            </p>
          </div>
          <div className="space-y-4 p-4 sm:p-5">
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
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
            <div className="flex justify-center sm:justify-start">
              <TurnstileWidget
                onVerify={setTurnstileToken}
                onExpire={() => setTurnstileToken(null)}
                className="cf-turnstile"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="submit"
                disabled={submitting || (TURNSTILE_ENABLED && !turnstileToken)}
              >
                {submitting ? "Opening..." : "Open ticket"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setView("list");
                  setError(null);
                  setTurnstileToken(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </form>
      )}

      {view === "list" && (
        <div>
          {tickets === null ? (
            <div
              className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60 bg-card"
              role="status"
              aria-label="Loading your tickets"
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-3 py-3 sm:px-4"
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded-sm" />
                </div>
              ))}
            </div>
          ) : tickets.length === 0 ? (
            // No action button here: the section header's New ticket button is
            // already on screen, a few lines up, with the same label, icon and
            // handler. The description names it instead of repeating it.
            <EmptyState
              icon={LifeBuoy}
              title="No tickets yet"
              description="New ticket starts a thread with our team. A person picks it up, and the reply comes back here, by email and in your notifications."
            />
          ) : (
            // A divided list, not a stack of separate cards: these rows are one
            // column of the same thing, and floating each one made the list
            // read as several unrelated panels.
            <div className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60 bg-card">
              {tickets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openThread(t.id)}
                  className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors duration-200 ease-out hover:bg-muted/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-4"
                >
                  {/* The coloured status dot that used to lead this row said
                      exactly what the badge beside the subject says, in the
                      same hue and with none of the wording. The badge is the
                      one that carries the label, so it is the one that stays.
                      Same for the old "Shared with you" pill: the meta line
                      below names who shared it, which is strictly more. */}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {t.subject}
                      </span>
                      <StatusBadge status={t.status} />
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t.shared
                        ? `Shared by ${t.shared_owner_name ?? "a teammate"} · `
                        : ""}
                      {TICKET_CATEGORY_LABELS[t.category]} &middot;{" "}
                      {t.message_count}{" "}
                      {t.message_count === 1 ? "message" : "messages"} &middot;{" "}
                      {formatRelativeTime(t.last_message_at)}
                    </span>
                  </span>
                  <ChevronRight
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "thread" && (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-2 py-1.5 sm:px-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setView("list");
                setThread(null);
              }}
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              All tickets
            </Button>
            {thread?.viewerIsOwner && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={toggleShare}
                aria-expanded={showShare}
              >
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                {showShare ? "Done sharing" : "Share"}
              </Button>
            )}
          </div>

          {thread && (
            // Subject, state, and what happens next, with the buttons that
            // change that state. All of it above the conversation: these used
            // to be a row of three small buttons in the header, and on a phone
            // they wrapped into the subject line.
            <div className="border-b border-border/60 px-3 py-3.5 sm:px-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">
                  {thread.ticket.subject}
                </h3>
                <StatusBadge status={thread.ticket.status} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {TICKET_CATEGORY_LABELS[thread.ticket.category]}
                {thread.ticket.createdAt
                  ? ` · opened ${formatRelativeTime(thread.ticket.createdAt)}`
                  : ""}
              </p>
              <div
                className={cn(
                  "mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2",
                  STATUS_STRIP[thread.ticket.status].box,
                )}
              >
                <p
                  className={cn(
                    "text-xs leading-relaxed",
                    STATUS_STRIP[thread.ticket.status].text,
                  )}
                >
                  {TICKET_STATUS_NEXT[thread.ticket.status]}
                </p>
                {/* Closed is terminal for the requester, so the strip has no
                    buttons in that state. Rendering the container anyway left
                    an empty box that justify-between pushed the sentence away
                    from. */}
                {(OPEN_TICKET_STATUSES.includes(thread.ticket.status) ||
                  canReopen) && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {OPEN_TICKET_STATUSES.includes(thread.ticket.status) && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2.5 text-xs"
                          onClick={() => setStatus("resolved")}
                        >
                          Mark resolved
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setStatus("closed")}
                        >
                          Close ticket
                        </Button>
                      </>
                    )}
                    {/* Saying "this is not fixed" used to require writing
                        another message: replying to a resolved ticket is what
                        put it back in the support queue, and there was no
                        button for the case where there is nothing more to add
                        (AUDIT-011#drift-21). Owner only, and resolved only:
                        `closed` stays terminal. */}
                    {canReopen && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2.5 text-xs"
                        onClick={() => setStatus("awaiting_staff")}
                      >
                        Reopen
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

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
                            className="shrink-0 rounded-sm text-xs text-destructive hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
                          className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground transition-colors duration-200 ease-out hover:bg-primary/10 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading conversation...
            </div>
          ) : thread ? (
            <>
              <div
                ref={messagesRef}
                className="max-h-[26rem] space-y-4 overflow-y-auto px-3 py-4 sm:px-4"
              >
                {thread.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex flex-col gap-1",
                      m.mine ? "items-end" : "items-start",
                    )}
                  >
                    <span className="px-1 text-[11px] text-muted-foreground">
                      {m.mine
                        ? "You"
                        : m.isStaff
                          ? (m.authorName ?? "Support")
                          : (m.authorName ?? "Teammate")}{" "}
                      &middot; {formatRelativeTime(m.createdAt)}
                    </span>
                    {/* Tinted rather than a solid primary block: a saturated
                        fill behind a long message is hard to read, and the
                        alignment plus the author line already say who wrote
                        it. Matches the staff view of the same thread. */}
                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
                        m.mine
                          ? "rounded-tr-sm border-primary/25 bg-primary/10 text-foreground"
                          : "rounded-tl-sm border-border/60 bg-muted/40 text-foreground",
                      )}
                    >
                      {m.body}
                    </div>
                  </div>
                ))}
              </div>

              {/* A closed ticket gets no reply box and no notice in its place:
                  the status strip above the conversation already says the
                  ticket is closed and what to do instead, and this used to say
                  it a second time in the same card. */}
              {thread.ticket.status !== "closed" && (
                <form
                  onSubmit={sendReply}
                  className="border-t border-border/60 bg-muted/10 p-3 sm:p-4"
                >
                  <Textarea
                    value={reply}
                    maxLength={TICKET_MESSAGE_MAX}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Write a reply..."
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
              icon={AlertCircle}
              title="Could not load this ticket"
              description="The request did not come back. Try again, or go back to all tickets."
              action={
                threadId !== null ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 px-3 text-xs"
                    onClick={() => openThread(threadId)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Try again
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      )}
    </section>
  );
}
