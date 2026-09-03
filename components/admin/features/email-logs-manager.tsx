"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaginationControl } from "@/components/ui/pagination-control";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Mail,
  Search,
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Eye,
  Image as ImageIcon,
  ImageOff,
} from "lucide-react";
import {
  AdminPanelHeader,
  EmptyState,
  LogListSkeleton,
  StatusPill,
  ConfirmDialog,
  Toast,
  blockRemoteContent,
  hasRemoteContent,
  type AdminStatusTone,
} from "@/components/admin/shared";
import {
  formatTimestamp as formatAdminTimestamp,
  formatRelativeTime,
} from "@/components/admin/utils";
import type { ToastState } from "@/components/admin/types";
import { cn } from "@/lib/ui/utils";

// Log views want second precision; the shared formatter defaults to minutes.
const formatTimestamp = (iso: string) => formatAdminTimestamp(iso, true);

type EmailLogStatus = "sent" | "failed" | "skipped_not_configured";

interface EmailLogEntry {
  id: number;
  recipient: string;
  subject: string;
  status: EmailLogStatus;
  error_message: string | null;
  redacted_preview: string | null;
  created_at: string;
}

/** One row plus the rendered copy, fetched only when a message is opened. */
interface EmailLogDetail extends EmailLogEntry {
  redacted_html: string | null;
}

const DEFAULT_PAGE_SIZE = 20;

const STATUS_FILTERS: { value: EmailLogStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "skipped_not_configured", label: "Not configured" },
];

// Same three rows as before, but the per-status Tailwind string is now a
// shared tone name. Two reasons: skipped_not_configured was painted with
// --severity-medium, which encodes how bad a scan FINDING is and has no
// business describing a delivery outcome (design-language.md D5), and the
// badge that consumed the string passed no variant, so it inherited the solid
// primary fill and then fought it back off with three overrides. StatusPill
// takes the tone directly and is the same vocabulary the rest of /admin uses.
const STATUS_META: Record<
  EmailLogStatus,
  { label: string; icon: typeof CheckCircle2; tone: AdminStatusTone }
> = {
  sent: { label: "Sent", icon: CheckCircle2, tone: "ok" },
  failed: { label: "Failed", icon: XCircle, tone: "crit" },
  skipped_not_configured: {
    label: "Not configured",
    icon: AlertTriangle,
    tone: "warn",
  },
};

/** One label/value pair in the message header block. */
function MetaField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-foreground wrap-break-word">
        {children}
      </dd>
    </div>
  );
}

/**
 * Admin > System > Email Logs (AUDIT-010). Every outbound email attempt
 * this app has made, written by lib/email/email.ts's sendEmail() itself
 * so it's a complete record, not a sample of specific notification types.
 *
 * "Sent" means the configured SMTP server accepted the message for
 * delivery -- plain SMTP has no true inbox-delivery or read-receipt
 * signal, so this can't promise the recipient actually got it, only that
 * sending didn't fail. Everything stored is pre-redacted server side (see
 * redactEmailPreview and redactEmailHtml): any link, numeric code, or long
 * token is replaced with a [REDACTED ...] marker before it is written, so a
 * password reset link or 2FA code is never visible here.
 *
 * Opening a message shows the rendered document sendEmail actually handed to
 * nodemailer. It used to show something else: the 500-character plain-text
 * excerpt, poured into the branded shell and presented as the email. That
 * produced a page that looked like a real message but was not one -- no
 * heading, no button, no detail panel, no severity chips, cut off mid
 * sentence, every URL reading [REDACTED LINK] -- and an admin comparing it
 * against what a user said they received had no way to tell which parts were
 * the message and which were the mock-up. Rows written before
 * email_logs.redacted_html existed have no rendered copy, and those say so
 * rather than reconstructing one.
 */
export function EmailLogsManager() {
  const [logs, setLogs] = useState<EmailLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<EmailLogStatus | "">("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [viewLog, setViewLog] = useState<EmailLogEntry | null>(null);
  const [detail, setDetail] = useState<EmailLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  // Off for every message that is opened, never remembered: an admin agreeing
  // to fetch one sender's images is not agreeing to fetch the next one's.
  const [loadRemote, setLoadRemote] = useState(false);
  const searchInitRef = useRef(false);

  const fetchLogs = useCallback(
    async (
      p: number,
      s: string,
      st: EmailLogStatus | "",
      limit: number,
      isInitial = false,
    ) => {
      if (isInitial) setLoading(true);
      else setRefreshing(true);
      try {
        const params = new URLSearchParams({
          page: String(p),
          limit: String(limit),
        });
        if (s.trim()) params.set("search", s.trim());
        if (st) params.set("status", st);
        const res = await fetch(`/api/v3/admin/email-logs?${params}`);
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs || []);
          setPage(data.page || 1);
          setTotalPages(data.totalPages || 1);
          setTotal(data.total || 0);
        } else {
          setToast({ message: "Failed to load email logs.", type: "error" });
        }
      } catch {
        setToast({ message: "Failed to load email logs.", type: "error" });
      }
      setLoading(false);
      setRefreshing(false);
    },
    [],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchLogs(1, "", "", pageSize, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search, same 300ms pattern as the main admin users table.
  useEffect(() => {
    if (!searchInitRef.current) {
      searchInitRef.current = true;
      return;
    }
    const timeout = setTimeout(() => {
      fetchLogs(1, search, status, pageSize);
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const openLog = useCallback(async (log: EmailLogEntry) => {
    setViewLog(log);
    setDetail(null);
    setDetailError(false);
    setLoadRemote(false);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/v3/admin/email-logs?id=${log.id}`);
      const data = await res.json();
      if (res.ok && data.log) setDetail(data.log as EmailLogDetail);
      else setDetailError(true);
    } catch {
      setDetailError(true);
    }
    setDetailLoading(false);
  }, []);

  const storedHtml = detail?.redacted_html ?? null;
  // Never interpolated into this document: it is handed to a sandboxed frame
  // as srcdoc, which is the only reason rendering it at all is safe. See the
  // frame below.
  const frameHtml = useMemo(() => {
    if (storedHtml === null) return null;
    return loadRemote ? storedHtml : blockRemoteContent(storedHtml);
  }, [storedHtml, loadRemote]);
  const remoteContentPresent = useMemo(
    () => (storedHtml === null ? false : hasRemoteContent(storedHtml)),
    [storedHtml],
  );
  const viewMeta = viewLog
    ? (STATUS_META[viewLog.status] ?? STATUS_META.failed)
    : null;

  const handleStatusFilter = (next: EmailLogStatus | "") => {
    setStatus(next);
    fetchLogs(1, search, next, pageSize);
  };

  const handleClear = async () => {
    try {
      const res = await fetch("/api/v3/admin/email-logs", {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        setToast({
          message: `Cleared ${data.deletedCount || 0} email log ${
            data.deletedCount === 1 ? "entry" : "entries"
          }.`,
          type: "success",
        });
        await fetchLogs(1, search, status, pageSize);
      } else {
        setToast({
          message: data.error || "Failed to clear email logs.",
          type: "error",
        });
      }
    } catch {
      setToast({ message: "Failed to clear email logs.", type: "error" });
    } finally {
      setConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <AdminPanelHeader
          icon={Mail}
          title="Email Logs"
          subtitle="Every outbound email this app has attempted, most recent first. Links, codes, and tokens are redacted before storage."
          status={
            <StatusPill tone="neutral">
              <span className="tabular-nums">{total.toLocaleString()}</span>
              {total === 1 ? "entry" : "entries"}
            </StatusPill>
          }
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 gap-2 border-border/40"
                onClick={() => fetchLogs(page, search, status, pageSize)}
                disabled={refreshing}
                aria-label="Refresh email logs"
              >
                <RefreshCw
                  className={cn("h-4 w-4", refreshing && "animate-spin")}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              {/* Stepped down from the solid destructive fill, same reasoning
                  as the error log's: emptying a log buffer was the loudest
                  control on a card whose point is the failed sends below. */}
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmOpen(true)}
                disabled={loading || total === 0}
                aria-label="Clear all email logs"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Clear logs</span>
              </Button>
            </>
          }
        >
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <Input
              placeholder="Search recipient or subject..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search email logs"
              className="pl-9 h-9 bg-background/50 border-border/40 focus:border-primary/50"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value || "all"}
                type="button"
                onClick={() => handleStatusFilter(f.value)}
                // a11y (SC 4.1.2): which filter is applied was carried in
                // colour alone.
                aria-pressed={status === f.value}
                className={cn(
                  "text-xs font-medium px-2.5 py-1 rounded-full border transition-colors",
                  status === f.value
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "bg-transparent text-muted-foreground border-border/40 hover:border-border",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </AdminPanelHeader>

        <CardContent className="p-0">
          {loading ? (
            // Matches the divided list below rather than DataTableSkeleton's
            // table header and avatar column, neither of which this panel has.
            <LogListSkeleton rows={6} />
          ) : logs.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="No emails logged"
              description={
                search || status
                  ? "No results for this filter."
                  : "Nothing has been sent yet."
              }
            />
          ) : (
            <div
              className={cn(
                "divide-y divide-border/40 border-t border-border/50 transition-opacity duration-200",
                refreshing && "opacity-40 pointer-events-none",
              )}
            >
              {logs.map((log) => {
                const meta = STATUS_META[log.status] ?? STATUS_META.failed;
                const Icon = meta.icon;
                return (
                  <div
                    key={log.id}
                    // A send that failed was detectable only from a 10px badge
                    // in the right gutter, so scanning a page of twenty rows
                    // for the one that did not go out meant reading the gutter
                    // line by line. The row itself now carries the state: a
                    // left rail plus a tint for a failure, a rail alone for
                    // mail that was never attempted. The rail is a pseudo
                    // element so a coloured row keeps the same text origin as
                    // an uncoloured one.
                    className={cn(
                      // Wraps below sm. The status pill and the View button
                      // are shrink-0 and cost about 140px, so on a 320px
                      // screen the subject had roughly 104px. They take their
                      // own line via w-full further down.
                      "relative px-4 sm:px-5 py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-3 gap-y-2",
                      "before:absolute before:inset-y-0 before:left-0 before:w-0.5",
                      log.status === "failed" &&
                        "bg-destructive/5 before:bg-destructive",
                      log.status === "skipped_not_configured" &&
                        "before:bg-[hsl(var(--warning))]",
                    )}
                  >
                    <div className="min-w-0 flex-1 basis-full sm:basis-0">
                      <p
                        title={log.subject}
                        className="text-sm font-medium text-foreground truncate"
                      >
                        {log.subject}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 min-w-0">
                        <span
                          title={log.recipient}
                          className="font-mono truncate"
                        >
                          {log.recipient}
                        </span>
                        {/* Below sm the absolute stamp in the gutter is
                            hidden, which left the log with no times at all on
                            a phone. The relative age fills that gap and costs
                            no horizontal room. */}
                        <span
                          aria-hidden="true"
                          className="text-muted-foreground/40 sm:hidden"
                        >
                          ·
                        </span>
                        <time
                          dateTime={log.created_at}
                          title={formatTimestamp(log.created_at)}
                          className="tabular-nums shrink-0 sm:hidden"
                        >
                          {formatRelativeTime(log.created_at)}
                        </time>
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums shrink-0 whitespace-nowrap hidden sm:block">
                      {formatTimestamp(log.created_at)}
                    </p>
                    <StatusPill
                      tone={meta.tone}
                      icon={Icon}
                      className="shrink-0"
                    >
                      {meta.label}
                    </StatusPill>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5 gap-1.5 border-border/40 shrink-0"
                      onClick={() => openLog(log)}
                      aria-label={`View ${log.subject}`}
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      View
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {logs.length > 0 && (
            <div className="px-5 py-4 border-t border-border/40 bg-muted/20">
              <PaginationControl
                currentPage={page}
                totalPages={totalPages}
                onPageChange={(p) => fetchLogs(p, search, status, pageSize)}
                pageSize={pageSize}
                totalItems={total}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  fetchLogs(1, search, status, s);
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Clear email logs"
        description={`This permanently deletes all ${total.toLocaleString()} logged email ${
          total === 1 ? "entry" : "entries"
        }. This cannot be undone.`}
        confirmLabel="Clear logs"
        danger
        onConfirm={handleClear}
        onCancel={() => setConfirmOpen(false)}
      />

      <Dialog
        open={viewLog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setViewLog(null);
            setDetail(null);
          }
        }}
      >
        {/* A rendered email is shown at its real width and no size rung
            matches it, so the width stays a bare class. The ladder in
            modal-grammar.ts is unprefixed for exactly this: tailwind-merge only
            drops a conflicting class within the same modifier, so a responsive
            rung could not be overridden by a plain width. */}
        <DialogContent variant="shell" className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{viewLog?.subject}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {viewLog && viewMeta && (
              <>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                  <MetaField label="Recipient">
                    <span className="font-mono text-[13px]">
                      {viewLog.recipient}
                    </span>
                  </MetaField>
                  <MetaField label="Delivery">
                    <StatusPill tone={viewMeta.tone} icon={viewMeta.icon}>
                      {viewMeta.label}
                    </StatusPill>
                  </MetaField>
                  <MetaField label="Attempted">
                    <time
                      dateTime={viewLog.created_at}
                      className="tabular-nums"
                    >
                      {formatTimestamp(viewLog.created_at)}
                    </time>
                    <span className="text-muted-foreground">
                      {" "}
                      ({formatRelativeTime(viewLog.created_at)})
                    </span>
                  </MetaField>
                </dl>

                {viewLog.error_message && (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-destructive/80">
                      What the mail server said
                    </p>
                    <p className="mt-1 font-mono text-xs text-destructive wrap-break-word">
                      {viewLog.error_message}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-xs text-muted-foreground">
                      {frameHtml
                        ? viewLog.status === "skipped_not_configured"
                          ? "This message was never sent, because SMTP is not configured. Below is the document that would have gone out."
                          : "The message as it was handed to the mail server. Links, one-time codes and long tokens are replaced before anything is stored, so nothing below is live."
                        : "Message body"}
                    </p>
                    {frameHtml && remoteContentPresent && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2.5 gap-1.5 border-border/40 shrink-0"
                        onClick={() => setLoadRemote((v) => !v)}
                        aria-pressed={loadRemote}
                      >
                        {loadRemote ? (
                          <ImageOff
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        ) : (
                          <ImageIcon
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        )}
                        {loadRemote ? "Block images" : "Load images"}
                      </Button>
                    )}
                  </div>

                  {detailLoading ? (
                    <div className="h-[600px] rounded-lg border border-border/50 bg-muted/20 animate-pulse" />
                  ) : detailError ? (
                    <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
                      Could not load this message.
                    </div>
                  ) : frameHtml ? (
                    <>
                      {/* The one safe way to show mail an outsider influenced
                          to the account that can do the most damage with it.
                          `sandbox=""` is every restriction at once: no
                          allow-scripts, so an injected <script> in a logged
                          body never runs, and no allow-same-origin, so the
                          frame sits in an opaque origin and cannot read this
                          document, its cookies or its storage even if it
                          could run. Never swap this for
                          dangerouslySetInnerHTML: that puts attacker-shaped
                          markup straight into the admin origin. */}
                      <iframe
                        srcDoc={frameHtml}
                        sandbox=""
                        referrerPolicy="no-referrer"
                        className="w-full h-[600px] rounded-lg border border-border/50"
                        title={`Rendered copy of "${viewLog.subject}"`}
                      />
                      <p className="text-[11px] text-muted-foreground/80">
                        {remoteContentPresent
                          ? loadRemote
                            ? "Remote images are loading, so the addresses in this message can see this browser's IP."
                            : "Remote images are blocked, so nothing in this message can see this browser's IP."
                          : "This message loads nothing from the network."}
                      </p>
                    </>
                  ) : (
                    <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-3">
                      <p className="text-xs text-muted-foreground">
                        No rendered copy of this message was kept, so there is
                        nothing to show the way its recipient saw it. What
                        follows is the plain-text part, redacted and cut to its
                        first 500 characters. Messages sent from this version
                        onwards keep the rendered copy as well.
                      </p>
                      <pre className="font-mono text-xs text-foreground whitespace-pre-wrap wrap-break-word">
                        {viewLog.redacted_preview ||
                          "Nothing was stored for this message beyond the details above."}
                      </pre>
                    </div>
                  )}
                </div>
              </>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
