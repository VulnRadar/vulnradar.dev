"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PaginationControl } from "@/components/ui/pagination-control";
import {
  AlertTriangle,
  Bug,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import {
  SkeletonRegion,
  AdminPanelHeader,
  EmptyState,
  LogListSkeleton,
  StatusPill,
  Toast,
} from "@/components/admin/shared";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  formatTimestamp as formatAdminTimestamp,
  formatRelativeTime,
} from "@/components/admin/utils";

// Log views want second precision; the shared formatter defaults to minutes.
const formatTimestamp = (iso: string) => formatAdminTimestamp(iso, true);
import type { ToastState } from "@/components/admin/types";
import { cn } from "@/lib/ui/utils";
import { API, STAFF_ROLE_HIERARCHY } from "@/lib/config/client-constants";
import { getRoleLevel } from "@/lib/auth/permissions-client";
import { useAuth } from "@/components/providers/auth-provider";
import { isCaptureNotice } from "@/lib/logging/capture-notice";
import { ListSearchInput } from "@/components/shared/list-filter-bar";

interface ErrorLogEntry {
  id: number;
  message: string;
  detail: string | null;
  request_id: string | null;
  scan_id: number | null;
  created_at: string;
}

/** Exact-match filters the API takes alongside the free-text search. */
interface LogFilters {
  requestId: string | null;
  scanId: number | null;
}

const NO_FILTERS: LogFilters = { requestId: null, scanId: null };

const DEFAULT_PAGE_SIZE = 20;

/** Long enough to tell two requests apart, short enough to sit on a row. */
const REQUEST_ID_CHIP_LENGTH = 8;

const CHIP_CLASSES =
  "inline-flex h-6 items-center gap-1 rounded-md border px-2 font-mono text-[11px] leading-none transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/** A deep link such as /admin?tab=error-logs&scanId=4812 seeds the filters. */
function filtersFromLocation(): LogFilters {
  if (typeof window === "undefined") return NO_FILTERS;
  const params = new URLSearchParams(window.location.search);
  const scan = Number.parseInt(params.get("scanId") ?? "", 10);
  return {
    requestId: params.get("requestId")?.trim() || null,
    scanId: Number.isSafeInteger(scan) && scan > 0 ? scan : null,
  };
}

/**
 * Admin > System > Error Logs. Shows console.error calls captured by
 * lib/database/error-log-capture.ts's console.error interception, so
 * staff can see real application errors without shell/SSH access to the
 * server instead of relying on raw stdout (which routine console.log
 * status lines like lib/database/cleanup.ts's periodic run summary
 * drown out).
 *
 * Every row carries the request and scan it belongs to when there was one.
 * Clicking either chip narrows the list to that id, which is how the several
 * rows one failing request wrote (route, scan, a check, the fetch) are read
 * together, and how an x-request-id copied from a user's devtools is looked
 * up.
 */
export function ErrorLogsManager() {
  const { me } = useAuth();
  // The API refuses DELETE below admin (requireAdmin). The ops role can read
  // this log, so the button used to be offered to it and answered with a 403
  // after the confirm dialog. Hidden until the role is known, not shown and
  // then taken away.
  const canClear = getRoleLevel(me?.role) >= STAFF_ROLE_HIERARCHY.admin;

  const [logs, setLogs] = useState<ErrorLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<LogFilters>(NO_FILTERS);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const searchInitRef = useRef(false);

  const fetchLogs = useCallback(
    async (
      p: number,
      s: string,
      limit: number,
      f: LogFilters,
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
        if (f.requestId) params.set("requestId", f.requestId);
        if (f.scanId !== null) params.set("scanId", String(f.scanId));
        const res = await fetch(`${API.ADMIN}/error-logs?${params}`);
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs || []);
          setPage(data.page || 1);
          setTotalPages(data.totalPages || 1);
          setTotal(data.total || 0);
        } else {
          // A 400 names what was wrong with a filter; anything else is ours.
          const data = await res.json().catch(() => null);
          setToast({
            message:
              res.status === 400 && data?.error
                ? data.error
                : "Failed to load error logs.",
            type: "error",
          });
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
    const seeded = filtersFromLocation();
    // oxlint-disable-next-line react/set-state-in-effect -- reads the deep link once on mount, then fetches; the filters are only known client-side
    setFilters(seeded);
    fetchLogs(1, "", pageSize, seeded, true);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search, same 300ms pattern as the main admin users table.
  useEffect(() => {
    if (!searchInitRef.current) {
      searchInitRef.current = true;
      return;
    }
    const timeout = setTimeout(() => {
      fetchLogs(1, search, pageSize, filters);
    }, 300);
    return () => clearTimeout(timeout);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const applyFilters = (next: LogFilters) => {
    setFilters(next);
    setExpandedId(null);
    fetchLogs(1, search, pageSize, next);
  };

  const handleClear = async () => {
    try {
      const res = await fetch(`${API.ADMIN}/error-logs`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({
          message: `Cleared ${data.deletedCount || 0} error log ${
            data.deletedCount === 1 ? "entry" : "entries"
          }.`,
          type: "success",
        });
        setExpandedId(null);
        await fetchLogs(1, search, pageSize, filters);
      } else if (res.status === 403) {
        setToast({
          message: "Only admins can clear the error logs.",
          type: "error",
        });
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

  const filtered = filters.requestId !== null || filters.scanId !== null;

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
          subtitle="Every console.error call from the running server, most recent first. A warning row means some errors were left out of the list."
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
                onClick={() => fetchLogs(page, search, pageSize, filters)}
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
              {canClear && (
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
              )}
            </>
          }
        >
          <ListSearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search error message or detail"
            label="Search error logs"
          />
        </AdminPanelHeader>

        <CardContent className="p-0">
          {filtered && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/50 bg-muted/20 px-5 py-3 text-xs text-muted-foreground">
              <span>Showing only</span>
              {filters.requestId && (
                <button
                  type="button"
                  onClick={() => applyFilters({ ...filters, requestId: null })}
                  className={cn(
                    CHIP_CLASSES,
                    "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
                  )}
                  aria-label={`Remove the request filter ${filters.requestId}`}
                >
                  request {filters.requestId}
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
              {filters.scanId !== null && (
                <button
                  type="button"
                  onClick={() => applyFilters({ ...filters, scanId: null })}
                  className={cn(
                    CHIP_CLASSES,
                    "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
                  )}
                  aria-label={`Remove the scan filter ${filters.scanId}`}
                >
                  scan #{filters.scanId}
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {loading ? (
            // The list's own shape, not DataTableSkeleton: this panel has no
            // table header and no avatar column, so that skeleton drew a
            // layout the loaded panel never shows.
            <SkeletonRegion label="Loading error logs">
              <LogListSkeleton rows={pageSize} />
            </SkeletonRegion>
          ) : logs.length === 0 ? (
            <EmptyState
              icon={Bug}
              title="No errors captured"
              description={
                search || filtered
                  ? "Nothing matches the search and filters you have set."
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
                // A row the capture wrote about itself, not an application
                // error: some errors were left out, and this is the only
                // place that says so. Styled as a warning so a page of
                // errors does not read as the whole story.
                const notice = isCaptureNotice(log.message);
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
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {notice && (
                          <StatusPill tone="warn" icon={AlertTriangle}>
                            Capture notice
                          </StatusPill>
                        )}
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
                const requestActive = filters.requestId === log.request_id;
                const scanActive = filters.scanId === log.scan_id;
                return (
                  <div
                    key={log.id}
                    className={cn(
                      notice &&
                        "border-l-2 border-l-[hsl(var(--warning))] bg-[hsl(var(--warning))]/5",
                    )}
                  >
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
                    {/* Outside the expand button on purpose: a button inside
                        a button is invalid, and a click on a chip must
                        filter, not open the stack. */}
                    {(log.request_id || log.scan_id !== null) && (
                      <div className="flex flex-wrap items-center gap-2 px-5 pb-3.5 -mt-1.5">
                        {log.request_id && (
                          <button
                            type="button"
                            onClick={() =>
                              applyFilters({
                                ...filters,
                                requestId: requestActive
                                  ? null
                                  : log.request_id,
                              })
                            }
                            aria-pressed={requestActive}
                            aria-label={`Show only rows from request ${log.request_id}`}
                            title={log.request_id}
                            className={cn(
                              CHIP_CLASSES,
                              requestActive
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                            )}
                          >
                            req{" "}
                            {log.request_id.slice(0, REQUEST_ID_CHIP_LENGTH)}
                          </button>
                        )}
                        {log.scan_id !== null && (
                          <button
                            type="button"
                            onClick={() =>
                              applyFilters({
                                ...filters,
                                scanId: scanActive ? null : log.scan_id,
                              })
                            }
                            aria-pressed={scanActive}
                            aria-label={`Show only rows from scan ${log.scan_id}`}
                            className={cn(
                              CHIP_CLASSES,
                              scanActive
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                            )}
                          >
                            scan #{log.scan_id}
                          </button>
                        )}
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
                onPageChange={(p) => fetchLogs(p, search, pageSize, filters)}
                pageSize={pageSize}
                totalItems={total}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  fetchLogs(1, search, s, filters);
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Clear error logs"
        // The delete is not scoped to the list: it empties the table. With a
        // search or filter on, `total` is only the rows that match, so quoting
        // it would promise a smaller delete than the one that happens.
        description={
          search.trim() || filtered
            ? "This permanently deletes every captured error log entry, including the ones your search and filters are hiding. This cannot be undone."
            : `This permanently deletes all ${total.toLocaleString()} captured error log ${
                total === 1 ? "entry" : "entries"
              }. This cannot be undone.`
        }
        confirmLabel="Clear logs"
        danger
        onConfirm={handleClear}
        onCancel={() => setConfirmOpen(false)}
      />

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
