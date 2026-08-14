"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PaginationControl } from "@/components/ui/pagination-control";
import {
  Mail,
  Search,
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import {
  EmptyState,
  DataTableSkeleton,
  ConfirmDialog,
  Toast,
} from "@/components/admin/shared";
import type { ToastState } from "@/components/admin/types";
import { cn } from "@/lib/ui/utils";

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

const DEFAULT_PAGE_SIZE = 20;

const STATUS_FILTERS: { value: EmailLogStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "skipped_not_configured", label: "Not configured" },
];

const STATUS_META: Record<
  EmailLogStatus,
  { label: string; icon: typeof CheckCircle2; cls: string }
> = {
  sent: {
    label: "Sent",
    icon: CheckCircle2,
    cls: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    cls: "bg-destructive/10 text-destructive border-destructive/20",
  },
  skipped_not_configured: {
    label: "Not configured",
    icon: AlertTriangle,
    cls: "bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))] border-[hsl(var(--severity-medium))]/20",
  },
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Admin > System > Email Logs (AUDIT-010). Every outbound email attempt
 * this app has made, written by lib/email/email.ts's sendEmail() itself
 * so it's a complete record, not a sample of specific notification types.
 *
 * "Sent" means the configured SMTP server accepted the message for
 * delivery -- plain SMTP has no true inbox-delivery or read-receipt
 * signal, so this can't promise the recipient actually got it, only that
 * sending didn't fail. The preview column is always pre-redacted server
 * side (see redactEmailPreview): any link, numeric code, or long token is
 * replaced with a [REDACTED ...] marker before it's ever stored, so a
 * password reset link or 2FA code is never visible here.
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
        <CardHeader className="pb-4 pt-5 px-5">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base font-semibold truncate">
                    Email Logs
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    Every outbound email this app has attempted, most recent
                    first. Links, codes, and tokens are redacted before storage.
                  </p>
                </div>
              </div>
              <Badge
                variant="secondary"
                className="text-xs font-medium h-6 px-2.5 shrink-0"
              >
                {total.toLocaleString()} {total === 1 ? "entry" : "entries"}
              </Badge>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative flex-1">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                  aria-hidden="true"
                />
                <Input
                  placeholder="Search recipient or subject..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search email logs"
                  className="pl-9 h-10 bg-background/50 border-border/40 focus:border-primary/50"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 px-3 gap-2 border-border/40"
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
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-10 px-3 gap-2"
                  onClick={() => setConfirmOpen(true)}
                  disabled={loading || total === 0}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Clear logs</span>
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value || "all"}
                  type="button"
                  onClick={() => handleStatusFilter(f.value)}
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
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <DataTableSkeleton rows={6} />
            </div>
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
                "divide-y divide-border/40 transition-opacity duration-200",
                refreshing && "opacity-40 pointer-events-none",
              )}
            >
              {logs.map((log) => {
                const meta = STATUS_META[log.status] ?? STATUS_META.failed;
                const Icon = meta.icon;
                return (
                  <div key={log.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground truncate">
                            {log.subject}
                          </p>
                          <Badge
                            className={cn(
                              "text-[10px] px-1.5 py-0 gap-1 font-medium shrink-0",
                              meta.cls,
                            )}
                          >
                            <Icon className="h-3 w-3" aria-hidden="true" />
                            {meta.label}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                          {log.recipient}
                        </p>
                        {log.redacted_preview && (
                          <p className="text-xs text-muted-foreground/80 mt-1.5 line-clamp-2">
                            {log.redacted_preview}
                          </p>
                        )}
                        {log.error_message && (
                          <p className="text-xs text-destructive mt-1.5 break-words">
                            {log.error_message}
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                        {formatTimestamp(log.created_at)}
                      </p>
                    </div>
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

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
