"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TranslatableMessage } from "@/components/support/translatable-message";
import { useFocusIntent } from "@/components/support/use-focus-intent";
import {
  AlertCircle,
  ArrowLeft,
  Check,
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
import { focus } from "@/lib/ui/animations";
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
import { LeadingIcon } from "@/components/shared/leading-icon";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EditDialog } from "@/components/shared/edit-dialog";
import {
  EMPTY_TICKET_DRAFT,
  createTicket,
  fetchShares,
  newTicketCanSave,
  newTicketDirty,
  planShareOps,
  remainingStaged,
  runShareOps,
  sendShareOp,
  shareFailureMessage,
  shareLabel,
  type NewTicketDraft,
  type ShareLists,
} from "@/components/contact/support-ticket-dialog-logic";

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
  /** The language it was written in, when the thread crosses languages. */
  bodyLocale?: string | null;
  /** The same message in this reader's language, when it has one. */
  translation?: string | null;
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

/** What a screen reader hears once a status change has gone through. */
const STATUS_ANNOUNCEMENT: Partial<Record<TicketStatus, string>> = {
  resolved: "Ticket marked resolved.",
  closed: "Ticket closed.",
  awaiting_staff: "Ticket reopened.",
};

export function SupportTickets() {
  const { me, isLoading } = useAuth();

  const [tickets, setTickets] = useState<TicketListItem[] | null>(null);
  const [view, setView] = useState<"list" | "thread">("list");
  const [thread, setThread] = useState<Thread | null>(null);
  /** The ticket the thread pane is showing, kept even when the fetch fails so
   *  the failure state can offer a retry rather than only a dead end. */
  const [threadId, setThreadId] = useState<number | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The draft, the captcha token and the busy state live in the dialog itself,
  // so every opening starts empty with a fresh widget.
  const [newOpen, setNewOpen] = useState(false);

  // Reply box
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);

  // Sharing with teammates (owner only). The lists and the staged changes live
  // in the dialog; opening another thread closes it.
  const [shareOpen, setShareOpen] = useState(false);

  // Closing is the one status change a requester cannot walk back (reopening
  // is resolved-only, see canReopen below), so it is the one that asks first.
  const [confirmClose, setConfirmClose] = useState(false);

  // The history scrolls inside its own box, so the newest message is at the
  // bottom of that box. Without this a long thread opens on the message the
  // user sent weeks ago instead of the reply they came here to read.
  const messagesRef = useRef<HTMLDivElement>(null);

  // Switching view unmounts whatever had focus (the New ticket button, the row
  // that was clicked, the whole composer), so each handler says where focus
  // goes next instead of leaving it on <body>.
  const rootRef = useRef<HTMLElement>(null);
  const focusOn = useFocusIntent(rootRef);

  // Spoken, not shown: a reply that went through changes nothing a screen
  // reader would otherwise notice. Cleared when the next attempt starts so
  // that sending a second reply says "Reply sent." a second time.
  const [announcement, setAnnouncement] = useState("");

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

  const openThread = useCallback(
    async (id: number, opts: { moveFocus?: boolean } = {}) => {
      setView("thread");
      setThreadId(id);
      // Drop a previously open thread before fetching a different one. The header
      // renders from `thread`, so holding the old object showed one ticket's
      // subject and status above another ticket's loading spinner. A reload of
      // the SAME ticket (after a reply or a status change) keeps it, so those do
      // not flash the header away, and so the composer under it stays mounted
      // with whatever has focus.
      setThread((prev) => (prev && prev.ticket.id === id ? prev : null));
      setThreadLoading(true);
      setShareOpen(false);
      setError(null);
      // Only when the person chose to open it. A reload after a reply or a
      // status change leaves focus where they put it, and the deep link from
      // an email does not take focus on page load.
      if (opts.moveFocus) focusOn("thread-heading");
      try {
        const res = await fetch(API.SUPPORT_TICKET(id));
        if (!res.ok) throw new Error("Could not open this ticket.");
        setThread(await res.json());
      } catch {
        // No banner: the thread pane's own failure state says this, and carries
        // the retry button. Setting both stated one failure twice on one screen.
        setThread(null);
        focusOn(null);
      } finally {
        setThreadLoading(false);
      }
    },
    [focusOn],
  );

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- fetch-on-mount: setState runs only in loadTickets' async continuation
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
    // oxlint-disable-next-line react/set-state-in-effect -- one-shot deep-link open on mount
    if (id && id > 0) void openThread(id);
    // Only react to the initial deep link, not to every openThread identity change.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
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

  // The dialog has already closed by the time this runs, so the list and the
  // thread load behind a page that is fully interactive again.
  async function afterCreate(id: number) {
    await loadTickets();
    // The dialog's own focus return would land on New ticket; the new ticket's
    // thread is where the person is going.
    await openThread(id, { moveFocus: true });
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (replying || !thread) return;
    setReplying(true);
    setError(null);
    setAnnouncement("");
    try {
      const res = await fetch(API.SUPPORT_TICKET(thread.ticket.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not send your reply.");
      setReply("");
      // The Send button was focused and is about to be disabled for the
      // duration of the reload; the composer is where they go on typing.
      focusOn("reply");
      await openThread(thread.ticket.id);
      setAnnouncement("Reply sent.");
      void loadTickets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your reply.");
    } finally {
      setReplying(false);
    }
  }

  async function setStatus(
    status: TicketStatus,
    opts: { focusHeading?: boolean } = {},
  ) {
    if (!thread) return;
    setError(null);
    setAnnouncement("");
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
      // Resolving, closing and reopening each remove the very button that was
      // pressed (the strip's buttons depend on the status), so focus has to be
      // given somewhere or it falls to <body>.
      if (opts.focusHeading) focusOn("thread-heading");
      setAnnouncement(STATUS_ANNOUNCEMENT[status] ?? "Ticket updated.");
      void loadTickets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the ticket.");
    }
  }

  // setStatus reports its own failures through the shared `error` banner
  // rather than throwing, so this closes the dialog unconditionally -- same
  // as domain-control-panel's confirmed actions, which close on both outcomes
  // and let the page-level error state say what went wrong.
  async function handleCloseTicket() {
    // The button that opened the dialog is gone along with the rest of the
    // strip, so focus goes to the heading. The dialog's focus trap holds it
    // until it has finished closing; the intent waits that out.
    await setStatus("closed", { focusHeading: true });
    setConfirmClose(false);
  }

  // Owner only, resolved only: `closed` is deliberately terminal for the
  // requester and the route 409s on posting to it.
  const canReopen =
    !!thread?.viewerIsOwner && thread.ticket.status === "resolved";

  return (
    <section ref={rootRef} className="mt-10 border-t border-border/50 pt-8">
      {/* Always mounted: a live region that appears already holding its text is
          not announced. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
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
        <Button
          size="sm"
          className="h-9 shrink-0 gap-1.5 px-3"
          data-focus-id="new-ticket"
          aria-haspopup="dialog"
          onClick={() => {
            setError(null);
            setNewOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New ticket
        </Button>
      </div>

      {error && (
        <InlineAlert tone="error" className="mb-4">
          {error}
        </InlineAlert>
      )}

      {view === "list" && (
        <div>
          {tickets === null ? (
            <div
              className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border bg-card"
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
                  <span className="icon-lead text-sm">
                    <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
                  </span>
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
            <div className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border bg-card">
              {tickets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-focus-id={`ticket-row-${t.id}`}
                  onClick={() => openThread(t.id, { moveFocus: true })}
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
                  <LeadingIcon
                    icon={ChevronRight}
                    className="text-muted-foreground/60"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "thread" && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-2 py-1.5 sm:px-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setView("list");
                setThread(null);
                // The row they came from, or the New ticket button when there
                // is no such row (a deep link, a ticket just opened).
                focusOn(
                  threadId !== null
                    ? [`ticket-row-${threadId}`, "new-ticket"]
                    : "new-ticket",
                );
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
                onClick={() => setShareOpen(true)}
                aria-haspopup="dialog"
              >
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                Share
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
                {/* tabIndex -1: focusable by script, not a tab stop. Opening a
                    thread lands here, so the subject is the first thing read. */}
                <h3
                  data-focus-id="thread-heading"
                  tabIndex={-1}
                  className={cn(
                    "rounded-sm text-base font-semibold text-foreground",
                    focus.ring,
                  )}
                >
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
                          onClick={() =>
                            setStatus("resolved", { focusHeading: true })
                          }
                        >
                          Mark resolved
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setConfirmClose(true)}
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
                        onClick={() =>
                          setStatus("awaiting_staff", { focusHeading: true })
                        }
                      >
                        Reopen
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* The thread wins over the spinner. A reload of the ticket that is
              already open (after a reply, a resolve) used to swap the whole
              pane for "Loading conversation...", which unmounted the reply box
              under the person typing in it and dropped focus to <body>. The
              spinner is now only for a thread that has not arrived at all;
              openThread has already discarded a different ticket's. */}
          {thread ? (
            <>
              <div
                ref={messagesRef}
                aria-busy={threadLoading}
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
                      <TranslatableMessage
                        ticketId={thread.ticket.id}
                        messageId={m.id}
                        body={m.body}
                        bodyLocale={m.bodyLocale}
                        translation={m.translation}
                      />
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
                    data-focus-id="reply"
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
          ) : threadLoading ? (
            <div
              role="status"
              className="flex items-center gap-2 p-4 text-sm text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading conversation...
            </div>
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

      {newOpen && (
        <NewTicketDialog
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            void afterCreate(id);
          }}
        />
      )}

      {shareOpen && thread?.viewerIsOwner && (
        <ShareTicketDialog
          ticketId={thread.ticket.id}
          onClose={() => setShareOpen(false)}
        />
      )}

      <ConfirmDialog
        open={confirmClose}
        danger
        title="Close this ticket?"
        description="You won't be able to reopen it. Open a new ticket if you need more help."
        confirmLabel="Close ticket"
        onCancel={() => setConfirmClose(false)}
        onConfirm={handleCloseTicket}
      />
    </section>
  );
}

/**
 * Opening a ticket. Mounted only while it is open, so every opening starts
 * with empty fields and a fresh captcha widget.
 */
export function NewTicketDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [draft, setDraft] = useState<NewTicketDraft>(EMPTY_TICKET_DRAFT);
  const patch = (next: Partial<NewTicketDraft>) =>
    setDraft((prev) => ({ ...prev, ...next }));

  return (
    <EditDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="md"
      title="New ticket"
      saveLabel="Open ticket"
      savingLabel="Opening..."
      dirty={newTicketDirty(draft)}
      canSave={newTicketCanSave(draft, TURNSTILE_ENABLED)}
      onSave={async () => {
        const result = await createTicket(draft, TURNSTILE_ENABLED);
        if (!result.ok) return result.error;
        onCreated(result.id);
      }}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ticket-subject">Subject</Label>
          <Input
            id="ticket-subject"
            value={draft.subject}
            maxLength={TICKET_SUBJECT_MAX}
            onChange={(e) => patch({ subject: e.target.value })}
            placeholder="Short summary of the issue"
            autoFocus
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ticket-category">Category</Label>
          <select
            id="ticket-category"
            value={draft.category}
            onChange={(e) =>
              patch({ category: e.target.value as TicketCategory })
            }
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-1 text-base shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
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
            value={draft.message}
            maxLength={TICKET_MESSAGE_MAX}
            onChange={(e) => patch({ message: e.target.value })}
            placeholder="Tell us what's going on. Include the URL you scanned or the invoice, if relevant."
            rows={5}
            required
          />
        </div>
        {/* The widget is 300px wide and the body is narrower than that on the
            smallest phones; scrolling beats cutting it off. Plain
            justify-center would push half the overflow past the left edge,
            where no scroll reaches it, so the centring is the safe kind. */}
        <div className="flex max-w-full justify-center-safe overflow-x-auto sm:justify-start">
          <TurnstileWidget
            onVerify={(token) => patch({ turnstileToken: token })}
            onExpire={() => patch({ turnstileToken: null })}
            className="cf-turnstile"
          />
        </div>
      </div>
    </EditDialog>
  );
}

type ShareLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & ShareLists);

/**
 * Who can see a ticket. Add and Remove are staged here and sent together by
 * Save, which is also the confirmation that taking someone's access away
 * asks for: nothing happens until it is pressed.
 */
export function ShareTicketDialog({
  ticketId,
  onClose,
}: {
  ticketId: number;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<ShareLoad>({ status: "loading" });
  const [added, setAdded] = useState<ReadonlySet<number>>(new Set());
  const [removed, setRemoved] = useState<ReadonlySet<number>>(new Set());

  const loadLists = useCallback(async () => {
    const result = await fetchShares(ticketId);
    setLoad(
      result.ok
        ? { status: "ready", shares: result.shares, eligible: result.eligible }
        : { status: "error", message: result.error },
    );
  }, [ticketId]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- fetch-on-open: setState runs only in loadLists' async continuation
    void loadLists();
  }, [loadLists]);

  const toggle = (
    set: ReadonlySet<number>,
    setter: (next: ReadonlySet<number>) => void,
    userId: number,
  ) => {
    const next = new Set(set);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setter(next);
  };

  const staged = added.size + removed.size;

  return (
    <EditDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="md"
      title="Who can see this ticket"
      saveLabel="Save sharing"
      dirty={staged > 0}
      canSave={load.status === "ready" && staged > 0}
      onSave={async () => {
        if (load.status !== "ready") return;
        const ops = planShareOps(load, added, removed);
        const run = await runShareOps(ops, (op) => sendShareOp(ticketId, op));
        const message = shareFailureMessage(run);
        if (message === null) return;
        const left = remainingStaged(run);
        setAdded(left.added);
        setRemoved(left.removed);
        await loadLists();
        return message;
      }}
    >
      {load.status === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading...
        </p>
      )}
      {load.status === "error" && (
        <div className="space-y-3">
          <InlineAlert tone="error">{load.message}</InlineAlert>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={() => {
              setLoad({ status: "loading" });
              void loadLists();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </Button>
        </div>
      )}
      {load.status === "ready" && (
        <ShareTicketFields
          lists={load}
          added={added}
          removed={removed}
          onToggleAdd={(id) => toggle(added, setAdded, id)}
          onToggleRemove={(id) => toggle(removed, setRemoved, id)}
        />
      )}
    </EditDialog>
  );
}

export function ShareTicketFields({
  lists,
  added,
  removed,
  onToggleAdd,
  onToggleRemove,
}: {
  lists: ShareLists;
  added: ReadonlySet<number>;
  removed: ReadonlySet<number>;
  onToggleAdd: (userId: number) => void;
  onToggleRemove: (userId: number) => void;
}) {
  const { shares, eligible } = lists;
  return (
    <div className="space-y-5">
      {shares.length > 0 && (
        <section aria-labelledby="share-current">
          <h3
            id="share-current"
            className="mb-1 text-xs font-medium text-muted-foreground"
          >
            Can see this ticket
          </h3>
          <ul className="divide-y divide-border/40">
            {shares.map((s) => {
              const pressed = removed.has(s.userId);
              return (
                <li
                  key={s.userId}
                  className="flex min-h-8 items-center justify-between gap-3 py-1.5"
                >
                  <span
                    className={cn(
                      "min-w-0 truncate text-sm",
                      pressed
                        ? "text-muted-foreground line-through"
                        : "text-foreground",
                    )}
                  >
                    {shareLabel(s)}
                  </span>
                  <Button
                    type="button"
                    variant={pressed ? "destructive" : "outline"}
                    size="sm"
                    className="h-8 shrink-0 px-2.5 text-xs"
                    aria-pressed={pressed}
                    aria-label={`Remove ${shareLabel(s)}`}
                    onClick={() => onToggleRemove(s.userId)}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            A teammate you remove can no longer see or reply to this ticket.
          </p>
        </section>
      )}
      {eligible.length > 0 ? (
        <section aria-labelledby="share-eligible">
          <h3
            id="share-eligible"
            className="mb-1 text-xs font-medium text-muted-foreground"
          >
            Share with a teammate
          </h3>
          <ul className="divide-y divide-border/40">
            {eligible.map((u) => {
              const pressed = added.has(u.userId);
              return (
                <li
                  key={u.userId}
                  className="flex min-h-8 items-center justify-between gap-3 py-1.5"
                >
                  <span className="min-w-0 truncate text-sm text-foreground">
                    {shareLabel(u)}
                  </span>
                  <Button
                    type="button"
                    variant={pressed ? "default" : "outline"}
                    size="sm"
                    className="h-8 shrink-0 gap-1 px-2.5 text-xs"
                    aria-pressed={pressed}
                    aria-label={`Add ${shareLabel(u)}`}
                    onClick={() => onToggleAdd(u.userId)}
                  >
                    {pressed && (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Add
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          {shares.length > 0
            ? "Everyone on your team already has access."
            : "No teammates to share with yet. Add people to a team first."}
        </p>
      )}
    </div>
  );
}
