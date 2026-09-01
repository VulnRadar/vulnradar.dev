"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DatabaseBackup,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  HardDrive,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { useVisibleInterval } from "@/lib/hooks/use-visible-interval";
import { formatBytes, formatTimestamp } from "@/components/admin/utils";

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
  modifiedAt: string;
}

interface BackupStatus {
  job: BackupJob | null;
  backups: BackupFileInfo[];
  lastBackupAt: string | null;
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
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-8 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
          Loading backup status...
        </CardContent>
      </Card>
    );
  }

  const job = status?.job ?? null;
  const showOutcome = !!job && !jobRunning && job.status !== "running";

  return (
    <div className="space-y-6">
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-border/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <DatabaseBackup
                  className="h-4 w-4 text-primary"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Database Backups
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Runs pg_dump, gzips it, and writes it to the configured backup
                  directory on the server.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-border/40 shrink-0"
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
          </div>
        </div>

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
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                Last backup
              </p>
              <p className="font-medium mt-0.5">
                {status?.lastBackupAt
                  ? formatTimestamp(status.lastBackupAt)
                  : "Never"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                Local backups
              </p>
              <p className="font-medium mt-0.5">
                {status?.backups.length ?? 0}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                Status
              </p>
              <p className="font-medium mt-0.5">
                {jobRunning
                  ? "Running"
                  : job?.status === "failed"
                    ? "Last run failed"
                    : job?.status === "success"
                      ? "Last run OK"
                      : "Idle"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              className="h-9 gap-1.5"
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
        <div className="px-4 sm:px-5 py-3.5 border-b border-border/50">
          <h3 className="text-sm font-semibold text-foreground">
            Recent local backups
          </h3>
        </div>
        <CardContent className="p-0">
          {!status?.backups || status.backups.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No local backups yet. Run one above, or schedule `npm run
              db:backup` with cron.
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {status.backups.slice(0, 10).map((file) => (
                <div
                  key={file.name}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <HardDrive
                      className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                      aria-hidden="true"
                    />
                    <span className="font-mono text-xs text-foreground truncate">
                      {file.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {formatTimestamp(file.modifiedAt)}
                    </span>
                    <span>{formatBytes(file.sizeBytes)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
