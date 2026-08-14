"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListOrdered, RefreshCw, AlertTriangle, Clock } from "lucide-react";
import { StatBar, StatBarSkeleton, Toast } from "@/components/admin/shared";
import type { ToastState } from "@/components/admin/types";
import { cn } from "@/lib/ui/utils";
import {
  formatAge,
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/v3/admin/queue-status");
      if (res.ok) {
        setData(await res.json());
      } else {
        setToast({
          message: "Failed to load scanner queue status.",
          type: "error",
        });
      }
    } catch {
      setToast({
        message: "Failed to load scanner queue status.",
        type: "error",
      });
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchStatus(true);
    pollRef.current = setInterval(() => fetchStatus(false), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const backedUp = computeBackedUp(data);

  const oldestPending = data ? formatAge(data.oldestPendingAgeMs) : null;
  const oldestRunning = data ? formatAge(data.oldestRunningAgeMs) : null;

  return (
    <div className="space-y-6">
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <CardHeader className="pb-4 pt-5 px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={cn(
                  "p-2 rounded-lg shrink-0",
                  backedUp ? "bg-destructive/10" : "bg-primary/10",
                )}
              >
                <ListOrdered
                  className={cn(
                    "h-4 w-4",
                    backedUp ? "text-destructive" : "text-primary",
                  )}
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base font-semibold truncate">
                  Scanner Queue
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  Pending and running scans right now, plus completed/failed
                  counts over the last {data?.recentWindowHours ?? 24}h.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {backedUp && (
                <Badge
                  variant="outline"
                  className="text-xs font-medium h-6 px-2.5 gap-1 border-destructive/30 text-destructive bg-destructive/5"
                >
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  Backed up
                </Badge>
              )}
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
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-5 pb-5 pt-0 space-y-4">
          {loading || !data ? (
            <StatBarSkeleton segments={4} />
          ) : (
            <>
              <StatBar
                items={[
                  {
                    label: "Pending",
                    value: data.counts.pending,
                    icon: Clock,
                    tone: data.counts.pending > 0 ? "orange" : "muted",
                  },
                  {
                    label: "Running",
                    value: data.counts.running,
                    icon: RefreshCw,
                    tone: "purple",
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

              {(oldestPending || oldestRunning) && (
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  {oldestPending && (
                    <span>
                      Oldest pending scan queued{" "}
                      <span
                        className={cn(
                          "font-medium",
                          (data.oldestPendingAgeMs ?? 0) > STALE_PENDING_MS &&
                            "text-destructive",
                        )}
                      >
                        {oldestPending}
                      </span>
                    </span>
                  )}
                  {oldestRunning && (
                    <span>
                      Oldest running scan started{" "}
                      <span
                        className={cn(
                          "font-medium",
                          (data.oldestRunningAgeMs ?? 0) > STALE_RUNNING_MS &&
                            "text-destructive",
                        )}
                      >
                        {oldestRunning}
                      </span>
                    </span>
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
