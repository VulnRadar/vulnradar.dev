"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ListOrdered,
  RefreshCw,
  AlertTriangle,
  Clock,
  ChevronDown,
  XCircle,
} from "lucide-react";
import {
  SkeletonRegion,
  AdminPanelHeader,
  StatBar,
  QueueBodySkeleton,
  StatusPill,
  StatusValue,
  Toast,
} from "@/components/admin/shared";
import type { ToastState } from "@/components/admin/types";
import { cn } from "@/lib/ui/utils";
import { API } from "@/lib/config/client-constants";
import { useVisibleInterval } from "@/lib/hooks/use-visible-interval";
import {
  formatAgeMs,
  computeBackedUp,
  groupFailures,
  STALE_PENDING_MS,
  STALE_RUNNING_MS,
  type FailedScan,
  type QueueStatusResponse,
} from "./queue-status-utils";
import { LeadingIcon } from "@/components/shared/leading-icon";
import { formatRelativeTime } from "@/components/admin/utils";

// No admin panel manager currently uses SWR (see
// components/providers/auth-provider.tsx for the only usage in the repo,
// a top-level session provider); every other polling manager here
// (updater-manager.tsx, error-logs-manager.tsx) hand-rolls fetch +
// setInterval, so this follows that established convention instead.
const POLL_INTERVAL_MS = 45_000;

/**
 * Admin > System > Scanner Queue. AUDIT-010 admin-feature-gap: there was
 * no way to tell "is the scanner backed up right now" without direct DB
 * access. Polls GET /api/v3/admin/queue-status, which does a single
 * grouped COUNT(*) over scan_history.status.
 */
export function QueueStatusManager() {
  const [data, setData] = useState<QueueStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  // Without this a failed load left the skeleton up forever, which reads as
  // "still loading" rather than "this never arrived". The toast that fires
  // alongside it is gone after five seconds.
  const [loadFailed, setLoadFailed] = useState(false);

  // The rows behind the Failed count, fetched separately and only once the
  // operator opens the list. They carry a customer URL and a user id, unlike
  // the aggregate counts above, so the 45-second poll does not pull them.
  const [failures, setFailures] = useState<FailedScan[] | null>(null);
  const [failuresTruncated, setFailuresTruncated] = useState(false);
  const [failuresOpen, setFailuresOpen] = useState(false);
  const [failuresLoading, setFailuresLoading] = useState(false);
  const [sweeping, setSweeping] = useState(false);

  const fetchFailures = useCallback(async () => {
    setFailuresLoading(true);
    try {
      const res = await fetch(`${API.ADMIN_QUEUE_STATUS}?failures=1`);
      if (res.ok) {
        const json: QueueStatusResponse = await res.json();
        setFailures(json.failures ?? []);
        setFailuresTruncated(!!json.failuresTruncated);
      } else {
        setToast({
          message: "Failed to load the failed scans.",
          type: "error",
        });
      }
    } catch {
      setToast({ message: "Failed to load the failed scans.", type: "error" });
    }
    setFailuresLoading(false);
  }, []);

  // Opening fetches; re-opening reuses what is already there. The Refresh
  // button re-fetches an open list, so a stale list is never the only option.
  const toggleFailures = useCallback(() => {
    setFailuresOpen((open) => {
      if (!open && failures === null) void fetchFailures();
      return !open;
    });
  }, [failures, fetchFailures]);

  const fetchStatus = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch(API.ADMIN_QUEUE_STATUS);
      if (res.ok) {
        setData(await res.json());
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
        setToast({
          message: "Failed to load scanner queue status.",
          type: "error",
        });
      }
    } catch {
      setLoadFailed(true);
      setToast({
        message: "Failed to load scanner queue status.",
        type: "error",
      });
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Runs the same stale-scan sweep the timer runs, so it only ever fails rows
  // past the grace period. The card calls a scan stuck at the longest scan
  // timeout, and the grace period is twice that, so "nothing old enough" is a
  // real answer here and says so rather than reporting a silent success.
  const sweepStale = useCallback(async () => {
    setSweeping(true);
    try {
      const res = await fetch(API.ADMIN_QUEUE_STATUS, {
        method: "POST",
      });
      if (res.ok) {
        const json: { swept: number; graceSeconds: number } = await res.json();
        const minutes = Math.round(json.graceSeconds / 60);
        setToast({
          message:
            json.swept > 0
              ? `Marked ${json.swept} stuck scan${json.swept === 1 ? "" : "s"} as failed.`
              : `Nothing was old enough to clear. Scans are cleared once they pass ${minutes} minutes.`,
          type: "success",
        });
        await fetchStatus(false);
      } else {
        setToast({ message: "Failed to clear stuck scans.", type: "error" });
      }
    } catch {
      setToast({ message: "Failed to clear stuck scans.", type: "error" });
    }
    setSweeping(false);
  }, [fetchStatus]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchStatus(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nothing is in flight here, so a backgrounded admin tab has no reason to
  // keep querying the queue every 45 seconds. Stops while hidden and catches
  // up once on return.
  useVisibleInterval(() => fetchStatus(false), POLL_INTERVAL_MS);

  const backedUp = computeBackedUp(data);

  // The two halves of that same verdict, split the way health-overview-utils'
  // scanQueueRow splits it. The strip used to colour Pending amber whenever
  // the count was above zero and hardcode Running's tone regardless of value,
  // so a scan queued two seconds ago looked like a backlog and a scan stuck
  // past every configured timeout looked like a healthy one. Staleness, not
  // the raw count, is what makes either number worth a colour.
  const pendingStale =
    !!data &&
    data.counts.pending > 0 &&
    (data.oldestPendingAgeMs ?? 0) > STALE_PENDING_MS;
  const runningStuck =
    !!data &&
    data.counts.running > 0 &&
    (data.oldestRunningAgeMs ?? 0) > STALE_RUNNING_MS;

  const oldestPending = data ? formatAgeMs(data.oldestPendingAgeMs) : null;
  const oldestRunning = data ? formatAgeMs(data.oldestRunningAgeMs) : null;

  return (
    <div className="space-y-6">
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <AdminPanelHeader
          icon={ListOrdered}
          tone={backedUp ? "crit" : "info"}
          title="Scanner Queue"
          subtitle={`Pending and running scans right now, plus completed/failed counts over the last ${data?.recentWindowHours ?? 24}h.`}
          status={
            backedUp ? (
              <StatusPill tone="crit" icon={AlertTriangle}>
                Backed up
              </StatusPill>
            ) : null
          }
          actions={
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 gap-2 border-border/40"
              onClick={() => {
                void fetchStatus(false);
                // An open list is part of what the operator is looking
                // at, so Refresh has to move it too. Without this the
                // counts updated and the rows under them did not, which
                // is worse than a stale card: the two disagree and
                // neither of them says so.
                if (failuresOpen) void fetchFailures();
              }}
              disabled={loading || refreshing}
              aria-label="Refresh scanner queue status"
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          }
        />

        <CardContent className="px-4 sm:px-5 py-5 space-y-4">
          {!data && loadFailed ? (
            <div className="flex items-start gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/10">
              <LeadingIcon
                line="p"
                icon={AlertTriangle}
                className="text-destructive"
              />
              <p className="text-sm text-destructive">
                Couldn&apos;t load the scanner queue. This is not an all-clear:
                the queue state is unknown. Use Refresh to try again.
              </p>
            </div>
          ) : loading || !data ? (
            // The strip AND the two age cells below it. Drawing the strip
            // alone meant the card grew by a whole fact row the moment the
            // counts landed, and the ages are the sharper diagnostic of the
            // two.
            <SkeletonRegion label="Loading scanner queue">
              <QueueBodySkeleton />
            </SkeletonRegion>
          ) : (
            <>
              <StatBar
                items={[
                  {
                    label: "Pending",
                    value: data.counts.pending,
                    icon: Clock,
                    tone: pendingStale
                      ? "orange"
                      : data.counts.pending > 0
                        ? "primary"
                        : "muted",
                  },
                  {
                    label: "Running",
                    value: data.counts.running,
                    icon: RefreshCw,
                    tone: runningStuck
                      ? "destructive"
                      : data.counts.running > 0
                        ? "primary"
                        : "muted",
                  },
                  {
                    label: `Completed (${data.recentWindowHours}h)`,
                    value: data.counts.completedLast24h,
                    tone: "success",
                  },
                  {
                    label: `Failed (${data.recentWindowHours}h)`,
                    value: data.counts.failedLast24h,
                    tone:
                      data.counts.failedLast24h > 0 ? "destructive" : "muted",
                  },
                ]}
              />

              {/* The two ages are the sharpest diagnostic on this card: the
                  counts say how much work exists, these say whether any of it
                  is moving. They used to render at text-xs in
                  text-muted-foreground under the strip, i.e. the smallest and
                  faintest type on a card whose loudest element was a count
                  that cannot go wrong. Same fact-cell shape the other System
                  panels open with, so they read as first-class values. */}
              {(oldestPending || oldestRunning) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {oldestPending && (
                    <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Oldest pending
                      </p>
                      <StatusValue
                        tone={pendingStale ? "warn" : "info"}
                        className="block text-base mt-0.5"
                      >
                        {oldestPending}
                      </StatusValue>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {pendingStale
                          ? "A healthy queue starts a scan within seconds. This one is backing up."
                          : "Waiting to start, inside the normal window."}
                      </p>
                    </div>
                  )}
                  {oldestRunning && (
                    <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Oldest running
                      </p>
                      <StatusValue
                        tone={runningStuck ? "crit" : "info"}
                        className="block text-base mt-0.5"
                      >
                        {oldestRunning}
                      </StatusValue>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {runningStuck
                          ? "Past every configured scan timeout. It is stuck, not slow."
                          : "Running inside the configured scan timeout."}
                      </p>
                      {runningStuck && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 mt-2 gap-1.5"
                          onClick={sweepStale}
                          disabled={sweeping}
                        >
                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          {sweeping ? "Clearing..." : "Fail stuck scans"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* The rows behind the Failed count.
                  ------------------------------------------------------------
                  This tile was a bare number for its whole life: the panel
                  could tell an operator THAT scans were failing and never
                  which ones or why, because the endpoint behind it is a
                  GROUP BY and never selected a single row. Knowing the count
                  is 25 is the least useful form of that fact.

                  Grouped by error text rather than listed flat, because the
                  first question is never "which 25 scans" - it is "is this
                  one problem 25 times, or 25 problems". Twenty-five identical
                  timeouts and twenty-five different errors are the same tile
                  and completely different incidents. */}
              {data.counts.failedLast24h > 0 && (
                <div className="rounded-md border border-destructive/25 bg-destructive/5">
                  <button
                    type="button"
                    onClick={toggleFailures}
                    aria-expanded={failuresOpen}
                    aria-controls="queue-failed-scans"
                    className="flex w-full items-start gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <LeadingIcon
                      line="sm"
                      icon={XCircle}
                      className="text-destructive"
                    />
                    <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                      {data.counts.failedLast24h}{" "}
                      {data.counts.failedLast24h === 1 ? "scan" : "scans"}{" "}
                      failed in the last {data.recentWindowHours}h
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "icon-lead h-4 w-4 text-muted-foreground transition-transform",
                        failuresOpen && "rotate-180",
                      )}
                    />
                  </button>

                  {failuresOpen && (
                    <div
                      id="queue-failed-scans"
                      className="space-y-2 border-t border-destructive/20 px-3 py-3"
                    >
                      {failuresLoading && failures === null ? (
                        <p className="text-xs text-muted-foreground">
                          Loading the failed scans...
                        </p>
                      ) : !failures || failures.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No failed scans are left in the{" "}
                          {data.recentWindowHours}h window. The count above is
                          from an earlier poll, so they have since aged out.
                        </p>
                      ) : (
                        <>
                          {groupFailures(failures).map((group) => (
                            <div
                              key={group.error}
                              className="rounded-md border border-border/40 bg-background/40 p-3"
                            >
                              <div className="flex items-start gap-2">
                                <span className="shrink-0 rounded-sm bg-destructive/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-destructive">
                                  {group.count}&times;
                                </span>
                                {/* Raw driver text, so it wraps rather than
                                    truncates: the tail of a pg or socket
                                    error is usually the part that identifies
                                    it. break-words, not break-all, because
                                    these are sentences. */}
                                <p className="min-w-0 flex-1 break-words font-mono text-xs leading-relaxed text-destructive">
                                  {group.error}
                                </p>
                              </div>
                              <ul className="mt-2 space-y-2 border-t border-border/30 pt-2">
                                {group.scans.map((scan) => (
                                  <li key={scan.id} className="min-w-0 text-xs">
                                    {/* break-all: a scanned URL is a single
                                        unbroken token with no spaces to wrap
                                        at, and it is exactly the value that
                                        pushes a panel past the viewport on a
                                        phone. */}
                                    <span className="block break-all font-mono text-foreground">
                                      {scan.url}
                                    </span>
                                    <span className="text-muted-foreground">
                                      user #{scan.userId} &middot; {scan.source}
                                      {scan.failedAt
                                        ? ` · ${formatRelativeTime(new Date(scan.failedAt))}`
                                        : ""}
                                      {scan.ranForMs != null
                                        ? ` · ran ${(scan.ranForMs / 1000).toFixed(1)}s`
                                        : ""}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                          {failuresTruncated && (
                            <p className="text-xs text-muted-foreground">
                              Showing the most recent {failures.length}. There
                              are more in the window: check the server logs for
                              the full picture.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
