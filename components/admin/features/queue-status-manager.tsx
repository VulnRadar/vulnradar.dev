"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListOrdered, RefreshCw, AlertTriangle, Clock } from "lucide-react";
import {
  AdminPanelHeader,
  StatBar,
  StatBarSkeleton,
  StatusPill,
  StatusValue,
  Toast,
} from "@/components/admin/shared";
import type { ToastState } from "@/components/admin/types";
import { cn } from "@/lib/ui/utils";
import { useVisibleInterval } from "@/lib/hooks/use-visible-interval";
import {
  formatAgeMs,
  computeBackedUp,
  STALE_PENDING_MS,
  STALE_RUNNING_MS,
  type QueueStatusResponse,
} from "./queue-status-utils";

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

  const fetchStatus = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/v3/admin/queue-status");
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
              onClick={() => fetchStatus(false)}
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
              <AlertTriangle
                className="h-4 w-4 text-destructive shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <p className="text-sm text-destructive">
                Couldn&apos;t load the scanner queue. This is not an all-clear:
                the queue state is unknown. Use Refresh to try again.
              </p>
            </div>
          ) : loading || !data ? (
            <StatBarSkeleton segments={4} />
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
