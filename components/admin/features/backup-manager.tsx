"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DatabaseBackup,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  HardDrive,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { useVisibleInterval } from "@/lib/hooks/use-visible-interval";
import {
  formatBytes,
  formatTimestamp,
  formatRelativeTime,
} from "@/components/admin/utils";
import {
  AdminPanelHeader,
  FactPanelSkeleton,
  StatusPill,
  StatusValue,
  type AdminStatusTone,
} from "@/components/admin/shared";
import {
  BACKUP_STALE_INTERVALS_WARN,
  BACKUP_STALE_INTERVALS_CRIT,
} from "./health-overview-utils";

interface BackupJob {
  id: string;
  status: "running" | "success" | "failed";
  log: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface BackupFileInfo {
  name: string;
  sizeBytes: number;
  /** Set when a key sidecar sits beside this dump: it is encrypted, and
   *  restoring it needs that file as well. */
  encrypted?: boolean;
  modifiedAt: string;
}

interface BackupStatus {
  job: BackupJob | null;
  backups: BackupFileInfo[];
  lastBackupAt: string | null;
  /** SCHEDULED_BACKUP_ENABLED, read live from the runtime settings, and the
   *  compiled interval the timer registers with. Both come from GET
   *  /api/v3/admin/backup, which reads them exactly the way the health
   *  route's backup row does, so this panel grades against the same numbers
   *  the server does rather than a client-side guess at them. */
  scheduledEnabled: boolean;
  intervalMs: number;
}

/**
 * How stale the newest backup file is, graded against the SAME thresholds and
 * the SAME schedule inputs the Overview health list uses
 * (health-overview-utils.ts backupRow), so the two screens cannot disagree
 * about what "old" means.
 *
 * The schedule is the whole grading question: with no schedule running,
 * nothing is promising a cadence, so an old file is a fact rather than a
 * fault and grading it amber would cry wolf on every deployment that backs up
 * by hand. Only "never" survives that as a verdict, and only as a warning.
 */
function gradeBackupAge(
  ageMs: number | null,
  scheduledEnabled: boolean,
  intervalMs: number,
): AdminStatusTone {
  if (ageMs === null) return scheduledEnabled ? "crit" : "warn";
  if (!scheduledEnabled) return "neutral";
  if (intervalMs <= 0) return "neutral";
  const intervals = ageMs / intervalMs;
  if (intervals >= BACKUP_STALE_INTERVALS_CRIT) return "crit";
  if (intervals >= BACKUP_STALE_INTERVALS_WARN) return "warn";
  return "ok";
}

/** The one line under the fact grid saying what the grade above was measured
 *  against. Same wording as backupRow()'s `detail`, because it is the same
 *  judgement and an operator should not have to reconcile two phrasings of
 *  it across two tabs. */
function backupScheduleNote(
  ageMs: number | null,
  scheduledEnabled: boolean,
  intervalMs: number,
): string {
  if (!scheduledEnabled) {
    return ageMs === null
      ? "No backup file exists yet. Scheduled backups are off on this deployment."
      : "Scheduled backups are off, so this is whenever someone last ran one by hand.";
  }
  if (ageMs === null) {
    return "Scheduled backups are on but nothing has been written to the backup directory.";
  }
  if (intervalMs <= 0) {
    return "Scheduled backups are on, but no run interval is configured.";
  }
  const intervals = Math.floor(ageMs / intervalMs);
  return intervals >= BACKUP_STALE_INTERVALS_WARN
    ? `Older than ${intervals} backup ${intervals === 1 ? "interval" : "intervals"}. The scheduled backup is not running, or it is running and failing.`
    : "Within the configured backup interval.";
}

function ageMsOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Date.now() - t);
}

/**
 * Admin > System > Backups. Triggers scripts/backup-db.mjs (pg_dump ->
 * gzip -> optional encryption/offsite upload, see that script's own
 * header) as a real child process via POST /api/v3/admin/backup, and
 * polls GET for progress -- same job-store-backed pattern as the
 * Updater panel (updater-manager.tsx), just without a multi-step
 * breakdown since a backup run has one outcome, not an installable
 * sequence.
 */
export function BackupManager() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v3/admin/backup");
      if (res.ok) {
        const data = (await res.json()) as BackupStatus;
        setStatus(data);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    } catch {
      // Surfaced rather than swallowed: with status still null the panel
      // reads "Last backup: Never", which tells an operator they have no
      // backups when they may have many.
      setLoadFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchStatus();
  }, [fetchStatus]);

  const jobRunning = status?.job?.status === "running";

  // Only polls while a backup job is actually running, and keeps polling at a
  // slower period when the tab is hidden rather than stopping: the point of
  // this timer is to notice the job finishing, which it should still do if the
  // admin switched tabs to wait it out.
  useVisibleInterval(fetchStatus, jobRunning ? 2000 : null, {
    hiddenDelayMs: 10_000,
  });

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchStatus();
    } finally {
      setRefreshing(false);
    }
  };

  const startBackup = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/v3/admin/backup", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        await fetchStatus();
      } else {
        setStartError(data.error || "Failed to start backup.");
      }
    } catch {
      setStartError("Failed to start backup.");
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    // The card's own shape, not a centred spinner in a p-8 box: that version
    // was about a third of the height of the loaded panel, so the whole tab
    // jumped the moment the status arrived.
    return <FactPanelSkeleton facts={3} />;
  }

  const job = status?.job ?? null;
  const showOutcome = !!job && !jobRunning && job.status !== "running";

  const lastBackupAgeMs = ageMsOf(status?.lastBackupAt);
  const scheduledEnabled = status?.scheduledEnabled ?? false;
  const backupIntervalMs = status?.intervalMs ?? 0;
  const backupAgeTone = gradeBackupAge(
    lastBackupAgeMs,
    scheduledEnabled,
    backupIntervalMs,
  );

  const runTone: AdminStatusTone = jobRunning
    ? "info"
    : job?.status === "failed"
      ? "crit"
      : job?.status === "success"
        ? "ok"
        : "neutral";
  const runLabel = jobRunning
    ? "Running"
    : job?.status === "failed"
      ? "Last run failed"
      : job?.status === "success"
        ? "Last run OK"
        : "Idle";

  const panelTone: AdminStatusTone =
    runTone === "crit" || backupAgeTone === "crit"
      ? "crit"
      : backupAgeTone === "warn"
        ? "warn"
        : "info";

  const backupCount = status?.backups.length ?? 0;
  const shownBackups = status?.backups.slice(0, 10) ?? [];

  return (
    <div className="space-y-6">
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <AdminPanelHeader
          icon={DatabaseBackup}
          tone={panelTone}
          title="Database Backups"
          subtitle="Dumps the database, gzips it, and writes it to the backup directory on the server. Uses pg_dump when it is installed, and a built-in dumper when it is not."
          status={
            jobRunning ? <StatusPill tone="info">Running</StatusPill> : null
          }
          actions={
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 gap-2 border-border/40 shrink-0"
              onClick={handleManualRefresh}
              disabled={refreshing}
              aria-label="Refresh backup status"
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          }
        />

        <CardContent className="p-4 sm:p-5 space-y-5">
          {!status && loadFailed && (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/10">
              <AlertTriangle
                className="h-4 w-4 text-destructive shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <p className="text-sm text-destructive">
                Couldn&apos;t load backup status. The figures below are unknown,
                not zero. Use Refresh to try again.
              </p>
            </div>
          )}
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Last backup
                </p>
                {/* Age first, absolute second. This printed only the absolute
                    timestamp, so a backup from six weeks ago and one from five
                    minutes ago were the same shape of string and the operator
                    did the staleness arithmetic in their head. "Never" was
                    rendered in ordinary foreground, which is the one value
                    here that is never fine. */}
                <StatusValue tone={backupAgeTone} className="block mt-0.5">
                  {status?.lastBackupAt
                    ? formatRelativeTime(status.lastBackupAt)
                    : "Never"}
                </StatusValue>
                {status?.lastBackupAt && (
                  <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                    {formatTimestamp(status.lastBackupAt)}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Local backups
                </p>
                <p className="font-medium mt-0.5 tabular-nums">{backupCount}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Status
                </p>
                <StatusValue tone={runTone} className="block mt-0.5">
                  {runLabel}
                </StatusValue>
              </div>
            </div>
            {/* Full width rather than inside the first cell: it explains what
                the age above was graded against, and a sentence that long
                inside a third of the grid pushes the other two facts around. */}
            <p className="text-xs text-muted-foreground">
              {backupScheduleNote(
                lastBackupAgeMs,
                scheduledEnabled,
                backupIntervalMs,
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Stays a plain primary button: it writes a new file and touches
                nothing that exists. The Updater's "Update now" is the one that
                had to move away from this weight. */}
            <Button
              size="sm"
              className="h-9 px-3 gap-2"
              onClick={startBackup}
              disabled={starting || jobRunning}
            >
              {starting || jobRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <DatabaseBackup className="h-4 w-4" aria-hidden="true" />
              )}
              {jobRunning ? "Backup running..." : "Back up now"}
            </Button>
            {startError && (
              <span className="text-xs text-destructive">{startError}</span>
            )}
          </div>

          {showOutcome && (
            <div
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border",
                job.status === "success"
                  ? "border-[hsl(var(--success))]/20 bg-[hsl(var(--success))]/5"
                  : "border-destructive/20 bg-destructive/5",
              )}
            >
              {job.status === "success" ? (
                <CheckCircle2
                  className="h-4 w-4 text-[hsl(var(--success))] shrink-0 mt-0.5"
                  aria-hidden="true"
                />
              ) : (
                <XCircle
                  className="h-4 w-4 text-destructive shrink-0 mt-0.5"
                  aria-hidden="true"
                />
              )}
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "text-sm",
                    job.status === "success"
                      ? "text-[hsl(var(--success))]"
                      : "text-destructive",
                  )}
                >
                  {job.status === "success"
                    ? "Backup completed."
                    : job.error || "Backup failed."}
                </p>
              </div>
            </div>
          )}

          {job && job.log.length > 0 && (jobRunning || showOutcome) && (
            <ScrollArea className="h-32 rounded-lg border border-border/40 bg-muted/20">
              <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">
                {job.log.join("\n")}
              </pre>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <AdminPanelHeader
          icon={HardDrive}
          tone="neutral"
          title="Recent local backups"
          subtitle="Backups sitting in the backup directory right now, newest first. An encrypted backup is stored as the dump plus a small key file, and is counted here once."
          status={
            backupCount > 0 ? (
              <StatusPill tone="neutral">
                <span className="tabular-nums">{backupCount}</span>
                {backupCount === 1 ? "backup" : "backups"}
              </StatusPill>
            ) : null
          }
        />
        <CardContent className="p-0">
          {shownBackups.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No local backups yet. Run one above, or schedule{" "}
              {/* Was a pair of literal backtick characters in the prose,
                  which render as backticks, not as code. */}
              <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-background border border-border/60 text-foreground">
                npm run db:backup
              </code>{" "}
              with cron.
            </div>
          ) : (
            <>
              <div className="divide-y divide-border/40">
                {shownBackups.map((file, i) => (
                  <div
                    key={file.name}
                    // Stacked below sm: the timestamp and the w-16 size cell
                    // on the right are shrink-0 and cost about 150px, which
                    // left roughly 110px for the filename on a 320px screen.
                    className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        title={file.name}
                        className="font-mono text-xs text-foreground truncate"
                      >
                        {file.name}
                      </span>
                      {/* The list is sorted newest first, but ten rows of
                          identical filenames made that ordering invisible:
                          the one file that is the current restore point had
                          no mark at all. */}
                      {i === 0 && (
                        <StatusPill tone="ok" className="shrink-0">
                          Newest
                        </StatusPill>
                      )}
                      {/* The key sidecar is no longer listed as its own row,
                          so say here that it exists. Without it this dump
                          cannot be decrypted, which an operator copying
                          backups off the box needs to know before copying
                          only the big file. */}
                      {file.encrypted && (
                        <StatusPill tone="neutral" className="shrink-0">
                          Encrypted
                        </StatusPill>
                      )}
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-xs text-muted-foreground tabular-nums">
                      <span className="whitespace-nowrap">
                        {formatTimestamp(file.modifiedAt)}
                      </span>
                      {/* Fixed width and right-aligned so the sizes form a
                          column that can be compared down the page, instead
                          of ragged text that moves with the timestamp. */}
                      <span className="w-16 text-right">
                        {formatBytes(file.sizeBytes)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {backupCount > shownBackups.length && (
                // The list was silently capped at ten with nothing saying so,
                // which reads as "there are ten backups".
                <p className="px-5 py-3 border-t border-border/40 bg-muted/20 text-xs text-muted-foreground">
                  Showing the{" "}
                  <span className="tabular-nums">{shownBackups.length}</span>{" "}
                  newest of <span className="tabular-nums">{backupCount}</span>{" "}
                  files in the backup directory.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
