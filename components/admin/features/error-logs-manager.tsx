"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  EmptyState,
  DataTableSkeleton,
  ConfirmDialog,
  Toast,
} from "@/components/admin/shared";
import { formatTimestamp as formatAdminTimestamp } from "@/components/admin/utils";

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
        <CardHeader className="pb-4 pt-5 px-5">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-destructive/10 shrink-0">
                  <Bug
                    className="h-4 w-4 text-destructive"
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base font-semibold truncate">
                    Error Logs
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    Every console.error call from the running server, most
                    recent first.
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
                  placeholder="Search error message or detail..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search error logs"
                  className="pl-9 h-10 bg-background/50 border-border/40 focus:border-primary/50"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 px-3 gap-2 border-border/40"
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
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <DataTableSkeleton rows={6} />
            </div>
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
                "divide-y divide-border/40 transition-opacity duration-200",
                refreshing && "opacity-40 pointer-events-none",
              )}
            >
              {logs.map((log) => {
                const isExpanded = expandedId === log.id;
                return (
                  <div key={log.id}>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      className="w-full flex items-start gap-3 px-5 py-3.5 text-left hover:bg-muted/20 transition-colors"
                      aria-expanded={isExpanded}
                      disabled={!log.detail}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono text-foreground wrap-break-word line-clamp-2">
                          {log.message}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatTimestamp(log.created_at)}
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
                    </button>
                    {isExpanded && log.detail && (
                      <div className="px-5 pb-4 bg-muted/10 border-t border-border/30">
                        <ScrollArea className="h-48 rounded-lg border border-border/40 bg-muted/20 mt-3">
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
