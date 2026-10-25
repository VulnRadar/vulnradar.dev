"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, MailQuestion, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";
import { EmptyState } from "@/components/shared/empty-state";
import { InlineAlert } from "@/components/shared/inline-alert";
import { EmailLink } from "@/components/shared/email-link";
import { StatusPill, type AdminStatusTone } from "@/components/admin/shared";
import { CATEGORIES } from "@/components/contact/contact-types";
import { cn } from "@/lib/ui/utils";
import { focus } from "@/lib/ui/animations";
import { formatRelativeTime } from "@/lib/ui/relative-time";
import { API } from "@/lib/config/client-constants";
import {
  contactEmailState,
  type ContactEmailTone,
} from "@/lib/support/contact-display";
import type {
  ContactEmailStatus,
  ContactSubmissionRow,
} from "@/lib/support/contact-submissions";

type Filter = "all" | ContactEmailStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  // The reason this view exists: the staff email is only a pointer, so one
  // that never arrived is a message nobody knows to come and read.
  { key: "failed", label: "Email failed" },
  { key: "pending", label: "Sending" },
  { key: "sent", label: "Emailed" },
];

const TONE: Record<ContactEmailTone, AdminStatusTone> = {
  ok: "ok",
  crit: "crit",
  warn: "warn",
  info: "info",
};

const CATEGORY_LABELS = new Map(CATEGORIES.map((c) => [c.id, c.label]));

function categoryLabel(row: ContactSubmissionRow): string {
  // Rows from the marketing-page form that no longer exists.
  if (row.source === "landing") return "Landing form";
  return CATEGORY_LABELS.get(row.category) ?? row.category;
}

/**
 * The contact form's messages, read in the admin panel.
 *
 * Every message from /contact is stored before anything is emailed, and the
 * email to staff carries no message text (it says "New contact submission
 * #123" and links here), so this is where the content is. It also answers the
 * question the pointer email cannot: whether the pointer itself was delivered.
 */
export function ContactSubmissionsView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<ContactSubmissionRow[] | null>(null);
  const [counts, setCounts] = useState<Record<
    ContactEmailStatus,
    number
  > | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = filter === "all" ? "" : `?status=${filter}`;
      const res = await fetch(`${API.ADMIN_CONTACT_SUBMISSIONS}${qs}`);
      if (!res.ok) throw new Error("Could not load contact messages.");
      const data = await res.json();
      setRows(data.submissions ?? []);
      setNextBefore(data.nextBefore ?? null);
      if (data.counts) setCounts(data.counts);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load contact messages.",
      );
      setRows([]);
    }
  }, [filter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState runs only in load's async continuation
    void load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function loadMore() {
    if (nextBefore === null || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const params = new URLSearchParams({ before: String(nextBefore) });
      if (filter !== "all") params.set("status", filter);
      const res = await fetch(`${API.ADMIN_CONTACT_SUBMISSIONS}?${params}`);
      if (!res.ok) throw new Error("Could not load more messages.");
      const data = await res.json();
      setRows((prev) => [...(prev ?? []), ...(data.submissions ?? [])]);
      setNextBefore(data.nextBefore ?? null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load more messages.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  function filterCount(key: Filter): number | null {
    if (!counts) return null;
    if (key === "all") {
      return counts.pending + counts.sent + counts.failed;
    }
    return counts[key];
  }

  const failed = counts?.failed ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Contact form
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {failed > 0
              ? `${failed} ${failed === 1 ? "message" : "messages"} arrived without its staff email going out. `
              : ""}
            The email to staff only says a message came in. Read it here, and
            reply from your own mail client.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-2 px-3"
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh contact messages"
        >
          <RefreshCw
            className={cn("h-4 w-4", refreshing && "animate-spin")}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      <div className="-mx-1 flex gap-1.5 scroll-x-only px-1 pb-1">
        {FILTERS.map((f) => {
          const selected = filter === f.key;
          const count = filterCount(f.key);
          const urgent = f.key === "failed" && (count ?? 0) > 0;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setFilter(f.key);
                setOpenId(null);
                setRows(null);
              }}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 ease-out",
                focus.ring,
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

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {rows === null ? (
          <SkeletonRegion label="Loading contact messages" className="gap-0">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex flex-col gap-1 border-b border-border/40 px-4 py-3 last:border-b-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-16 shrink-0" />
                </div>
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </SkeletonRegion>
        ) : rows.length === 0 ? (
          <EmptyState
            variant="inline"
            size="sm"
            icon={MailQuestion}
            title="No messages in this view"
            description={
              filter === "failed"
                ? "Every contact message so far has reached the staff inbox."
                : "Messages from the contact form show up here."
            }
          />
        ) : (
          <ul>
            {rows.map((row) => {
              const open = openId === row.id;
              const state = contactEmailState(row);
              return (
                <li
                  key={row.id}
                  className="border-b border-border/40 last:border-b-0"
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`contact-message-${row.id}`}
                    onClick={() => setOpenId(open ? null : row.id)}
                    className={cn(
                      "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors duration-200 ease-out hover:bg-muted/30",
                      "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      open && "bg-primary/5",
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-sm text-foreground",
                          open ? "font-semibold" : "font-medium",
                        )}
                      >
                        {row.subject || "(no subject)"}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                        #{row.id} &middot; {formatRelativeTime(row.created_at)}
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform duration-200",
                            open && "rotate-180",
                          )}
                          aria-hidden="true"
                        />
                      </span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {row.name} &middot; {row.email}
                    </span>
                    {!open && (
                      <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground/80">
                        {row.message}
                      </span>
                    )}
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusPill tone={TONE[state.tone]}>
                        {state.label}
                      </StatusPill>
                      <span className="text-[11px] text-muted-foreground">
                        {categoryLabel(row)}
                      </span>
                    </span>
                  </button>
                  {open && (
                    <div
                      id={`contact-message-${row.id}`}
                      className="space-y-3 border-t border-border/40 bg-muted/10 px-4 py-3"
                    >
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                        {row.message}
                      </p>
                      {row.email_error && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                          <p className="text-[11px] font-medium text-destructive">
                            Why the staff email failed
                          </p>
                          <p className="mt-0.5 wrap-anywhere font-mono text-[11px] leading-relaxed text-foreground">
                            {row.email_error}
                          </p>
                        </div>
                      )}
                      <EmailLink
                        address={row.email}
                        subject={`Re: ${row.subject || "your message"}`}
                        className={cn(
                          "-my-1 inline-flex h-8 items-center rounded-sm text-sm text-primary hover:underline",
                          focus.ring,
                        )}
                      >
                        Reply by email
                      </EmailLink>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {nextBefore !== null && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-4"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : "Load older messages"}
          </Button>
        </div>
      )}
    </div>
  );
}
