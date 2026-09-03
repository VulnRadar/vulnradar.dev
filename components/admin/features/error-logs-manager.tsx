"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PaginationControl } from "@/components/ui/pagination-control";
import {
  Bug,
  Search,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  AdminPanelHeader,
  EmptyState,
  LogListSkeleton,
  StatusPill,
  ConfirmDialog,
  Toast,
} from "@/components/admin/shared";
import {
  formatTimestamp as formatAdminTimestamp,
  formatRelativeTime,
} from "@/components/admin/utils";

// Log views want second precision; the shared formatter defaults to minutes.
const formatTimestamp = (iso: string) => formatAdminTimestamp(iso, true);
import type { ToastState } from "@/components/admin/types";
import { cn } from "@/lib/ui/utils";

interface ErrorLogEntry {
  id: number;
  message: string;
  detail: string | null;
  created_at: string;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Admin > System > Error Logs. Shows console.error calls captured by
 * lib/database/error-log-capture.ts's console.error interception, so
 * staff can see real application errors without shell/SSH access to the
 * server instead of relying on raw stdout (which routine console.log
 * status lines like lib/database/cleanup.ts's periodic run summary
 * drown out).
 */
export function ErrorLogsManager() {
  const [logs, setLogs] = useState<ErrorLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const searchInitRef = useRef(false);

  const fetchLogs = useCallback(
    async (p: number, s: string, limit: number, isInitial = false) => {
      if (isInitial) setLoading(true);
      else setRefreshing(true);
      try {
        const params = new URLSearchParams({
          page: String(p),
          limit: String(limit),
        });
        if (s.trim()) params.set("search", s.trim());
        const res = await fetch(`/api/v3/admin/error-logs?${params}`);
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs || []);
          setPage(data.page || 1);
          setTotalPages(data.totalPages || 1);
          setTotal(data.total || 0);
        } else {
          setToast({ message: "Failed to load error logs.", type: "error" });
        }
      } catch {
        setToast({ message: "Failed to load error logs.", type: "error" });
      }
      setLoading(false);
      setRefreshing(false);
    },
    [],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchLogs(1, "", pageSize, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search, same 300ms pattern as the main admin users table.
  useEffect(() => {
    if (!searchInitRef.current) {
      searchInitRef.current = true;
      return;
    }
    const timeout = setTimeout(() => {
      fetchLogs(1, search, pageSize);
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleClear = async () => {
    try {
      const res = await fetch("/api/v3/admin/error-logs", {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        setToast({
          message: `Cleared ${data.deletedCount || 0} error log ${
            data.deletedCount === 1 ? "entry" : "entries"
          }.`,
          type: "success",
        });
        setExpandedId(null);
        await fetchLogs(1, search, pageSize);
      } else {
        setToast({
          message: data.error || "Failed to clear error logs.",
          type: "error",
        });
      }
    } catch {
      setToast({ message: "Failed to clear error logs.", type: "error" });
    } finally {
      setConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <AdminPanelHeader
          icon={Bug}
          // Amber rather than the permanent red tile this panel used to
          // carry: a captured error is worth a look, but a tile that is red
          // on every visit is texture, not signal. Whether the CURRENT volume
          // is critical is the health list's call (it grades the last hour),
          // and this endpoint only knows the all-time total.
          tone={total > 0 ? "warn" : "ok"}
          title="Error Logs"
          subtitle="Every console.error call from the running server, most recent first."
          status={
            <StatusPill tone={total > 0 ? "warn" : "ok"}>
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
                onClick={() => fetchLogs(page, search, pageSize)}
                disabled={refreshing}
                aria-label="Refresh error logs"
              >
                <RefreshCw
                  className={cn("h-4 w-4", refreshing && "animate-spin")}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              {/* Outline, not the solid destructive fill this used to have.
                  Purging a capture buffer is the least consequential action
                  in the whole System area, and as the loudest control on the
                  card it pulled the eye away from the failures listed below
                  it. The destructive border still says what it does. */}
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmOpen(true)}
                disabled={loading || total === 0}
                aria-label="Clear all error logs"
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
              placeholder="Search error message or detail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search error logs"
              className="pl-9 h-9 bg-background/50 border-border/40 focus:border-primary/50"
            />
          </div>
        </AdminPanelHeader>

        <CardContent className="p-0">
          {loading ? (
            // The list's own shape, not DataTableSkeleton: this panel has no
            // table header and no avatar column, so that skeleton drew a
            // layout the loaded panel never shows.
            <LogListSkeleton rows={6} />
          ) : logs.length === 0 ? (
            <EmptyState
              icon={Bug}
              title="No errors captured"
              description={
                search
                  ? `No results for "${search}".`
                  : "Nothing has called console.error since this started capturing. That's a good sign."
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
                const isExpanded = expandedId === log.id;
                // The message is the row's subject and gets the weight; the
                // time is metadata and gets the muted micro-line. Every row
                // used to be one undifferentiated block of mono text at a
                // single weight, which is why twenty of them read as a wall.
                // Relative age leads because "3m ago" is the thing an
                // operator triaging an incident is actually reading for; the
                // absolute stamp stays next to it for the record.
                const rowBody = (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground leading-snug wrap-break-word line-clamp-2">
                        {log.message}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <time
                          dateTime={log.created_at}
                          className="tabular-nums"
                        >
                          {formatRelativeTime(log.created_at)}
                        </time>
                        <span
                          aria-hidden="true"
                          className="text-muted-foreground/40"
                        >
                          ·
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatTimestamp(log.created_at)}
                        </span>
                      </p>
                    </div>
                    {log.detail && (
                      <div className="shrink-0 mt-0.5">
                        {isExpanded ? (
                          <ChevronUp
                            className="h-4 w-4 text-muted-foreground"
                            aria-hidden="true"
                          />
                        ) : (
                          <ChevronDown
                            className="h-4 w-4 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                    )}
                  </>
                );
                return (
                  <div key={log.id}>
                    {/* A row with no stored detail has nothing to expand, so
                        it renders as a plain row. It used to render as a
                        DISABLED button, which kept the hover affordance's
                        absence AND greyed the text, so roughly half the log
                        looked broken rather than simply not expandable. */}
                    {log.detail ? (
                      <button
                        onClick={() =>
                          setExpandedId(isExpanded ? null : log.id)
                        }
                        className="w-full flex items-start gap-3 px-5 py-3.5 text-left hover:bg-muted/20 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        aria-expanded={isExpanded}
                      >
                        {rowBody}
                      </button>
                    ) : (
                      <div className="w-full flex items-start gap-3 px-5 py-3.5">
                        {rowBody}
                      </div>
                    )}
                    {isExpanded && log.detail && (
                      <div className="px-5 pb-4 bg-muted/10 border-t border-border/30">
                        <ScrollArea className="h-48 rounded-md border border-border/40 bg-muted/20 mt-3">
                          <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">
                            {log.detail}
                          </pre>
                        </ScrollArea>
                      </div>
                    )}
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
                onPageChange={(p) => fetchLogs(p, search, pageSize)}
                pageSize={pageSize}
                totalItems={total}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  fetchLogs(1, search, s);
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Clear error logs"
        description={`This permanently deletes all ${total.toLocaleString()} captured error log ${
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
