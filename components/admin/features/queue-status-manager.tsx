"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ListOrdered,
  RefreshCw,
  AlertTriangle,
  Clock,
  ChevronDown,
  XCircle,
  Activity,
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
import { pluralize } from "@/lib/ui/plural";
import { API, ROUTES } from "@/lib/config/client-constants";
import { useVisibleInterval } from "@/lib/hooks/use-visible-interval";
import {
  formatAgeMs,
  computeBackedUp,
  groupFailures,
  describeOtherEndings,
  endedWithoutResultCount,
  otherEndedCount,
  ranForLabel,
  adminUserHref,
  STALE_PENDING_MS,
  STALE_RUNNING_MS,
  type FailedScan,
  type InflightScan,
  type QueueStatusResponse,
} from "./queue-status-utils";
import { LeadingIcon } from "@/components/shared/leading-icon";
import { useConfirm } from "@/components/shared/use-confirm";
import { formatRelativeTime } from "@/components/admin/utils";

// No admin panel manager currently uses SWR (see
// components/providers/auth-provider.tsx for the only usage in the repo,
// a top-level session provider); every other polling manager here
// (updater-manager.tsx, error-logs-manager.tsx) hand-rolls fetch +
// setInterval, so this follows that established convention instead.
const POLL_INTERVAL_MS = 45_000;

/**
 * A link that is at least 24px tall without making its row taller: the
 * padding is on the link and pulled back with a negative margin, so the
 * target is the link and not the row around it.
 */
const ROW_LINK =
  "-my-1 rounded-sm py-1 hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  // The live list below is the same: opt-in, and not part of the poll.
  const [failures, setFailures] = useState<FailedScan[] | null>(null);
  const [failuresTruncated, setFailuresTruncated] = useState(false);
  const [failuresOpen, setFailuresOpen] = useState(false);
  const [failuresLoading, setFailuresLoading] = useState(false);
  const [inflight, setInflight] = useState<InflightScan[] | null>(null);
  const [inflightTruncated, setInflightTruncated] = useState(false);
  const [inflightOpen, setInflightOpen] = useState(false);
  const [inflightLoading, setInflightLoading] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

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

  const fetchInflight = useCallback(async () => {
    setInflightLoading(true);
    try {
      const res = await fetch(`${API.ADMIN_QUEUE_STATUS}?inflight=1`);
      if (res.ok) {
        const json: QueueStatusResponse = await res.json();
        setInflight(json.inflight ?? []);
        setInflightTruncated(!!json.inflightTruncated);
      } else {
        setToast({
          message: "Failed to load the running scans.",
          type: "error",
        });
      }
    } catch {
      setToast({ message: "Failed to load the running scans.", type: "error" });
    }
    setInflightLoading(false);
  }, []);

  // Opening fetches; re-opening reuses what is already there. The Refresh
  // button re-fetches an open list, so a stale list is never the only option.
  const toggleFailures = useCallback(() => {
    setFailuresOpen((open) => {
      if (!open && failures === null) void fetchFailures();
      return !open;
    });
  }, [failures, fetchFailures]);

  const toggleInflight = useCallback(() => {
    setInflightOpen((open) => {
      if (!open && inflight === null) void fetchInflight();
      return !open;
    });
  }, [inflight, fetchInflight]);

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
              ? `Marked ${pluralize(json.swept, "stuck scan")} as failed.`
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

  // One scan, by id. Throws on a refusal so the confirm dialog stays open and
  // says why: "it just finished" is a real answer here, and a toast that
  // vanished after five seconds would let it read as a cancel that worked.
  const cancelScan = useCallback(
    async (scanId: number) => {
      const res = await fetch(API.ADMIN_QUEUE_CANCEL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId }),
      });
      // Either way the list is out of date: the scan is gone, or it was
      // already gone.
      void fetchStatus(false);
      void fetchInflight();
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(
          typeof json?.error === "string"
            ? json.error
            : "Failed to cancel the scan.",
        );
      }
      setToast({ message: `Scan #${scanId} cancelled.`, type: "success" });
      if (failuresOpen) void fetchFailures();
    },
    [fetchStatus, fetchInflight, fetchFailures, failuresOpen],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchStatus(true);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
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

  const engineFailed = data?.counts.failedLast24h ?? 0;
  const otherEnded = data ? otherEndedCount(data.counts) : 0;
  const otherEndings = data ? describeOtherEndings(data.counts) : null;
  const inFlightCount = data ? data.counts.pending + data.counts.running : 0;

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
                if (inflightOpen) void fetchInflight();
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
                line="sm"
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
                    // The engine's own failures only. A cancel, a limit that
                    // turned a URL away and a target that was down are not
                    // the scanner breaking; they are counted just below.
                    label: `Failed (${data.recentWindowHours}h)`,
                    value: engineFailed,
                    tone: engineFailed > 0 ? "destructive" : "muted",
                  },
                ]}
              />

              {otherEndings && (
                <p className="text-xs text-muted-foreground">
                  Also ended without a result, and not counted as failed:{" "}
                  {otherEndings}.
                </p>
              )}

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
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                          onClick={() =>
                            confirm({
                              title: "Fail every stuck scan?",
                              description:
                                "Each scan still running past the grace period is marked failed. It belongs to a real account, the person watching it sees it fail, and there is no action that undoes this. Scans inside their timeout are left alone.",
                              confirmLabel: "Fail stuck scans",
                              danger: true,
                              onConfirm: sweepStale,
                            })
                          }
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

              {/* Which scans are running, and the one action that can be
                  taken on a single one.
                  ------------------------------------------------------------
                  The counts say how many scans are in flight and the only
                  action was a sweep of the ones past the grace period, so a
                  single stuck scan, or one aimed at a target that should not
                  be hit any longer, could not be named or stopped. Oldest
                  first: the stuck one is the one that has been going longest. */}
              {inFlightCount > 0 && (
                <div className="rounded-md border border-border/40 bg-muted/20">
                  <button
                    type="button"
                    onClick={toggleInflight}
                    aria-expanded={inflightOpen}
                    aria-controls="queue-inflight-scans"
                    className="flex w-full items-start gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <LeadingIcon
                      line="sm"
                      icon={Activity}
                      className="text-primary"
                    />
                    <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                      {pluralize(inFlightCount, "scan")} in flight, oldest first
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "icon-lead h-4 w-4 text-muted-foreground transition-transform",
                        inflightOpen && "rotate-180",
                      )}
                    />
                  </button>

                  {inflightOpen && (
                    <div
                      id="queue-inflight-scans"
                      className="border-t border-border/40 px-3 py-3"
                    >
                      {inflightLoading && inflight === null ? (
                        <p className="text-xs text-muted-foreground">
                          Loading the running scans...
                        </p>
                      ) : !inflight || inflight.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Nothing is in flight now. The count above is from an
                          earlier poll, so they have since finished.
                        </p>
                      ) : (
                        <>
                          <ul className="space-y-3">
                            {inflight.map((scan) => (
                              <li
                                key={scan.id}
                                className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2 text-xs"
                              >
                                <div className="min-w-0 flex-1">
                                  {/* break-all: a scanned URL is a single
                                      unbroken token with no spaces to wrap
                                      at, and it is exactly the value that
                                      pushes a panel past the viewport on a
                                      phone. */}
                                  <Link
                                    href={ROUTES.ADMIN_SCAN(scan.id)}
                                    className={cn(
                                      "block break-all font-mono text-foreground",
                                      ROW_LINK,
                                    )}
                                  >
                                    {scan.url}
                                  </Link>
                                  <span className="text-muted-foreground">
                                    {scan.status === "running"
                                      ? "Running"
                                      : "Queued"}
                                    {scan.currentCategory
                                      ? ` in ${scan.currentCategory}`
                                      : ""}
                                    {scan.startedAt
                                      ? ` · started ${formatRelativeTime(new Date(scan.startedAt))}`
                                      : ""}{" "}
                                    &middot;{" "}
                                    <Link
                                      href={adminUserHref(scan.userId)}
                                      className={cn("inline-block", ROW_LINK)}
                                    >
                                      user #{scan.userId}
                                    </Link>{" "}
                                    &middot; {scan.source}
                                  </span>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 shrink-0 gap-1.5"
                                  onClick={() =>
                                    confirm({
                                      title: `Cancel scan #${scan.id}?`,
                                      description: `This stops the scan for user #${scan.userId}. They see it fail with "Cancelled by an administrator.", whatever it had found so far is discarded, and there is no action that undoes this.`,
                                      confirmLabel: "Cancel scan",
                                      danger: true,
                                      onConfirm: () => cancelScan(scan.id),
                                    })
                                  }
                                  aria-label={`Cancel scan #${scan.id}`}
                                >
                                  <XCircle
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  Cancel
                                </Button>
                              </li>
                            ))}
                          </ul>
                          {inflightTruncated && (
                            <p className="mt-3 text-xs text-muted-foreground">
                              Showing the {inflight.length} that have been going
                              longest. There are more in flight.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* The rows behind the counts.
                  ------------------------------------------------------------
                  This tile was a bare number for its whole life: the panel
                  could tell an operator THAT scans were failing and never
                  which ones or why, because the endpoint behind it is a
                  GROUP BY and never selected a single row. Knowing the count
                  is 25 is the least useful form of that fact.

                  Grouped by why first, then by error text. The first question
                  is "did the scanner break, or did people cancel", and only
                  the first is an incident. The second is "is this one problem
                  25 times, or 25 problems": twenty-five identical timeouts
                  and twenty-five different errors are the same tile and
                  completely different incidents. */}
              {endedWithoutResultCount(data.counts) > 0 && (
                <div
                  className={cn(
                    "rounded-md border",
                    engineFailed > 0
                      ? "border-destructive/25 bg-destructive/5"
                      : "border-border/40 bg-muted/20",
                  )}
                >
                  <button
                    type="button"
                    onClick={toggleFailures}
                    aria-expanded={failuresOpen}
                    aria-controls="queue-failed-scans"
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      engineFailed > 0
                        ? "hover:bg-destructive/5"
                        : "hover:bg-muted/30",
                    )}
                  >
                    <LeadingIcon
                      line="sm"
                      icon={XCircle}
                      className={
                        engineFailed > 0
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }
                    />
                    <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                      {engineFailed > 0
                        ? `${pluralize(engineFailed, "scan")} failed in the last ${data.recentWindowHours}h`
                        : `No scanner failures in the last ${data.recentWindowHours}h`}
                      {otherEnded > 0 && (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          &middot; {otherEnded} more ended without a result
                        </span>
                      )}
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
                      className={cn(
                        "space-y-2 border-t px-3 py-3",
                        engineFailed > 0
                          ? "border-destructive/20"
                          : "border-border/40",
                      )}
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
                          {groupFailures(failures).map((kindGroup) => (
                            <div
                              key={kindGroup.kind ?? "unrecorded"}
                              className="rounded-md border border-border/40 bg-background/40 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={cn(
                                    "shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums",
                                    kindGroup.engine
                                      ? "bg-destructive/10 text-destructive"
                                      : "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {kindGroup.count}&times;
                                </span>
                                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                                  {kindGroup.label}
                                </h3>
                                {!kindGroup.engine && (
                                  <span className="text-xs text-muted-foreground">
                                    not counted as failed
                                  </span>
                                )}
                              </div>
                              <div className="mt-2 space-y-3">
                                {kindGroup.byText.map((group) => (
                                  <div
                                    key={group.error}
                                    className="border-t border-border/30 pt-2"
                                  >
                                    <div className="flex items-start gap-2">
                                      <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                                        {group.count}&times;
                                      </span>
                                      {/* Raw driver text, so it wraps rather
                                          than truncates: the tail of a pg or
                                          socket error is usually the part
                                          that identifies it. break-words, not
                                          break-all, because these are
                                          sentences. */}
                                      <p
                                        className={cn(
                                          "min-w-0 flex-1 break-words font-mono text-xs leading-relaxed",
                                          kindGroup.engine
                                            ? "text-destructive"
                                            : "text-muted-foreground",
                                        )}
                                      >
                                        {group.error}
                                      </p>
                                    </div>
                                    <ul className="mt-2 space-y-2">
                                      {group.scans.map((scan) => {
                                        const ran = ranForLabel(scan);
                                        return (
                                          <li
                                            key={scan.id}
                                            className="min-w-0 text-xs"
                                          >
                                            <Link
                                              href={ROUTES.ADMIN_SCAN(scan.id)}
                                              className={cn(
                                                "block break-all font-mono text-foreground",
                                                ROW_LINK,
                                              )}
                                            >
                                              {scan.url}
                                            </Link>
                                            <span className="text-muted-foreground">
                                              <Link
                                                href={adminUserHref(
                                                  scan.userId,
                                                )}
                                                className={cn(
                                                  "inline-block",
                                                  ROW_LINK,
                                                )}
                                              >
                                                user #{scan.userId}
                                              </Link>{" "}
                                              &middot; {scan.source}
                                              {scan.failedAt
                                                ? ` · ${formatRelativeTime(new Date(scan.failedAt))}`
                                                : ""}
                                              {ran ? ` · ${ran}` : ""}
                                            </span>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                          {failuresTruncated && (
                            <p className="text-xs text-muted-foreground">
                              Showing {failures.length}, scanner failures first.
                              There are more in the window: check the server
                              logs for the full picture.
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
      {confirmDialog}
    </div>
  );
}
