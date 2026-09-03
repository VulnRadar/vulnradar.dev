"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AdminPanelHeader,
  AdminPasswordConfirmDialog,
  FactPanelSkeleton,
  StatusPill,
  StatusValue,
  type AdminStatusTone,
} from "@/components/admin/shared";
import {
  DownloadCloud,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Terminal,
  Info,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { useVisibleInterval } from "@/lib/hooks/use-visible-interval";

interface UpdaterStatus {
  current: string;
  engine: string;
  latest: string | null;
  status: "up-to-date" | "behind" | "ahead" | "unknown";
  message: string;
  releaseUrl: string;
  releaseNotes: string | null;
  supported: boolean;
  unsupportedReason: string | null;
  cosignAvailable: boolean;
  tarAvailable: boolean;
  activeJobId: string | null;
}

type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

interface UpdaterJobStep {
  name: string;
  status: StepStatus;
  detail?: string;
}

interface UpdaterJob {
  id: string;
  targetVersion: string;
  status: string;
  steps: UpdaterJobStep[];
  log: string[];
  error: string | null;
  cosignVerified: "verified" | "skipped" | "failed" | null;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * The job's raw enum is a wire value ("completed", "failed", "migrating"),
 * and it used to be printed straight into a Badge: lowercase, and every
 * in-progress status falling through to the same grey a plain count badge
 * uses, so a job that was still copying files looked identical to one that
 * had finished. A human label plus a tone, so the state reads at a glance.
 */
const JOB_STATUS_META: Record<
  string,
  { label: string; tone: AdminStatusTone }
> = {
  pending: { label: "Queued", tone: "neutral" },
  downloading: { label: "Downloading", tone: "info" },
  verifying: { label: "Verifying", tone: "info" },
  extracting: { label: "Extracting", tone: "info" },
  installing: { label: "Installing", tone: "info" },
  migrating: { label: "Migrating", tone: "info" },
  completed: { label: "Completed", tone: "ok" },
  failed: { label: "Failed", tone: "crit" },
};

/** The freshly-started job is stored as a bare `{ id }` until the first poll
 *  answers, so `status` is genuinely undefined for a moment: that rendered as
 *  an empty badge before. Anything unrecognised reads as in-progress rather
 *  than as a verdict. */
function jobStatusMeta(status: string | undefined): {
  label: string;
  tone: AdminStatusTone;
} {
  return (
    JOB_STATUS_META[status ?? ""] ?? {
      label: status || "Starting",
      tone: "info",
    }
  );
}

const STEP_LABELS: Record<string, string> = {
  "resolve-release": "Resolve release",
  download: "Download release assets",
  checksum: "Verify checksum",
  signature: "Verify cosign signature",
  extract: "Extract tarball",
  copy: "Copy files into app directory",
  "npm-ci": "npm ci",
  "db-migrate": "npm run db:migrate",
};

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done")
    return (
      <CheckCircle2
        className="h-4 w-4 text-[hsl(var(--success))]"
        aria-hidden="true"
      />
    );
  if (status === "failed")
    return <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />;
  if (status === "running")
    return (
      <Loader2
        className="h-4 w-4 text-primary animate-spin"
        aria-hidden="true"
      />
    );
  if (status === "skipped")
    return (
      <AlertTriangle
        className="h-4 w-4 text-muted-foreground"
        aria-hidden="true"
      />
    );
  return (
    <div
      className="h-4 w-4 rounded-full border border-border/60"
      aria-hidden="true"
    />
  );
}

export function UpdaterManager() {
  const [status, setStatus] = useState<UpdaterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  // Separate from `loading`, which only ever covers the initial mount --
  // the Refresh button called fetchStatus() directly with no state of its
  // own, so a manual click had zero visible feedback (no spinner, nothing
  // disabled). The request itself worked fine; there was just no way to
  // tell it had, especially when the status hadn't actually changed.
  const [refreshing, setRefreshing] = useState(false);
  // With status still null the panel asserts "cosign: Not installed" and
  // "tar: Not found", which are claims about the host, not "unknown". Track
  // the failure so the row can say so instead.
  const [loadFailed, setLoadFailed] = useState(false);
  const [job, setJob] = useState<UpdaterJob | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v3/admin/updater/status");
      if (!res.ok) {
        setLoadFailed(true);
      } else {
        setLoadFailed(false);
        const data = (await res.json()) as UpdaterStatus;
        setStatus(data);
        if (data.activeJobId) {
          // Functional update reads the CURRENT job, not a stale closure over
          // the initial null. The old `!job` was always true (job wasn't a
          // dep), so every poll overwrote a fully-populated job with a bare
          // {id}, which could wedge the UI as "running" with no live poll.
          setJob((prev) => prev ?? ({ id: data.activeJobId } as UpdaterJob));
        }
      }
    } catch {
      setLoadFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: fetchStatus' setState calls only fire after its async request resolves, not synchronously in this effect
    fetchStatus();
  }, [fetchStatus]);

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchStatus();
    } finally {
      setRefreshing(false);
    }
  }, [fetchStatus]);

  const pollJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(
        `/api/v3/admin/updater/apply?jobId=${encodeURIComponent(jobId)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { job: UpdaterJob };
        setJob(data.job);
      }
    } catch {
      /* ignore, retry on next tick */
    }
  }, []);

  useEffect(() => {
    if (!job?.id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- poll-on-job-change: pollJob's setState calls only fire after its async request resolves, not synchronously in this effect
    pollJob(job.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  // Slows down rather than stopping while the tab is hidden: an update job is
  // in flight and this poll is how the panel learns it finished or failed.
  // Polls only while the job is still running. A terminal status drops the
  // delay to null, which is how this hook expresses 'stop', replacing the
  // manual clearInterval that used to live inside pollJob.
  const jobId = job?.id;
  const jobActive =
    Boolean(jobId) && job?.status !== "completed" && job?.status !== "failed";
  useVisibleInterval(() => jobId && pollJob(jobId), jobActive ? 2000 : null, {
    hiddenDelayMs: 10_000,
  });

  const startUpdate = async (password: string) => {
    try {
      const res = await fetch("/api/v3/admin/updater/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentAdminPassword: password,
          targetVersion: status?.latest || "latest",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setJob({ id: data.jobId } as UpdaterJob);
        setConfirmOpen(false);
        return { ok: true as const };
      }
      return {
        ok: false as const,
        error: data.error || "Failed to start update.",
      };
    } catch {
      return { ok: false as const, error: "Failed to start update." };
    }
  };

  const jobRunning =
    !!job && job.status !== "completed" && job.status !== "failed";

  if (loading) {
    // Same reason as the Backups panel: the old centred spinner in a p-8 box
    // was a fraction of the height of the loaded card, so the tab resized
    // under the cursor when the status landed.
    return <FactPanelSkeleton facts={4} />;
  }

  const behind = status?.status === "behind";

  return (
    <div className="space-y-6">
      {status && !status.supported && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border/50 bg-muted/30">
          <Info
            className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            {status.unsupportedReason}
          </p>
        </div>
      )}

      {/* Amber, not brand blue. An install sitting behind the published
          release is missing whatever security fixes that release carried, and
          in primary/5 it read as a friendly product announcement, the same
          tone this panel uses for "here is a link to the notes". */}
      {behind && status && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10">
          <div className="p-2 rounded-md bg-[hsl(var(--warning))]/15 shrink-0">
            <DownloadCloud
              className="h-4 w-4 text-[hsl(var(--warning))]"
              aria-hidden="true"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              A new version is available:{" "}
              <span className="font-mono tabular-nums">v{status.latest}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {status.message}
            </p>
          </div>
        </div>
      )}

      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <AdminPanelHeader
          icon={DownloadCloud}
          tone={behind ? "warn" : "info"}
          title="Updater"
          subtitle="Pull and install the latest release from GitHub. You build and restart the server yourself once it finishes."
          status={
            behind ? (
              <StatusPill tone="warn">Update available</StatusPill>
            ) : status?.status === "up-to-date" ? (
              <StatusPill tone="ok">Up to date</StatusPill>
            ) : null
          }
          actions={
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 gap-2 border-border/40 shrink-0"
              onClick={handleManualRefresh}
              disabled={refreshing}
              aria-label="Refresh update status"
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
                Couldn&apos;t load updater status. Everything below is unknown,
                not absent. Use Refresh to try again.
              </p>
            </div>
          )}
          {/* All four of these used to render in the same plain font-medium,
              so "Not found" (tar missing means the updater cannot run at all)
              sat at exactly the weight of the version string next to it.
              Versions are mono and tabular so the running and latest numbers
              line up digit for digit; the two host tools carry a tone. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Running
              </p>
              <p className="font-medium font-mono tabular-nums mt-0.5">
                v{status?.current ?? "?"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Latest
              </p>
              <p
                className={cn(
                  "font-medium mt-0.5",
                  status?.latest
                    ? "font-mono tabular-nums"
                    : "text-muted-foreground",
                )}
              >
                {status?.latest ? `v${status.latest}` : "Unknown"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                cosign
              </p>
              <StatusValue
                tone={
                  !status ? "neutral" : status.cosignAvailable ? "ok" : "warn"
                }
                className="block mt-0.5"
              >
                {!status
                  ? "Unknown"
                  : status.cosignAvailable
                    ? "Available"
                    : "Not installed"}
              </StatusValue>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                tar
              </p>
              <StatusValue
                tone={!status ? "neutral" : status.tarAvailable ? "ok" : "warn"}
                className="block mt-0.5"
              >
                {!status
                  ? "Unknown"
                  : status.tarAvailable
                    ? "Available"
                    : "Not found"}
              </StatusValue>
            </div>
          </div>

          {status?.releaseUrl && (
            <a
              href={status.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              View release notes
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}

          {status && !status.cosignAvailable && (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <AlertTriangle
                className="h-3.5 w-3.5 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              cosign isn&apos;t installed on this host. The update will still be
              checksum-verified, but its cosign signature won&apos;t be checked.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {/* Destructive weight, matching the password dialog it opens
                (variant="destructive" below). This was a default primary
                button, visually identical to the Backups panel's "Back up
                now", while what it actually does is overwrite this app's
                files on disk, run npm ci, and migrate the database. */}
            <Button
              variant="destructive"
              size="sm"
              className="h-9 px-3 gap-2"
              disabled={
                !status?.supported ||
                !status?.tarAvailable ||
                jobRunning ||
                status?.status === "unknown" ||
                status?.status === "up-to-date"
              }
              onClick={() => setConfirmOpen(true)}
            >
              <DownloadCloud className="h-4 w-4" aria-hidden="true" />
              Update now
            </Button>
            {status?.status === "up-to-date" && !jobRunning && (
              <span className="text-xs text-muted-foreground">
                Already on the latest version.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {job && (
        <Card className="border-border/50 bg-card/50 overflow-hidden">
          <AdminPanelHeader
            icon={Terminal}
            tone={jobStatusMeta(job.status).tone}
            title={`Update to ${
              job.targetVersion
                ? `v${job.targetVersion.replace(/^v/, "")}`
                : "latest"
            }`}
            subtitle={<span className="font-mono break-all">Job {job.id}</span>}
            status={
              <StatusPill tone={jobStatusMeta(job.status).tone}>
                {jobStatusMeta(job.status).label}
              </StatusPill>
            }
          />
          <CardContent className="p-4 sm:p-5 space-y-4">
            {job.steps?.length > 0 && (
              <ul className="space-y-2">
                {job.steps.map((step) => (
                  <li
                    key={step.name}
                    className="flex items-center gap-2.5 text-sm"
                  >
                    <StepIcon status={step.status} />
                    <span className="flex-1">
                      {STEP_LABELS[step.name] || step.name}
                    </span>
                    {step.detail && (
                      <span className="text-xs text-muted-foreground truncate max-w-[50%]">
                        {step.detail}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {job.status === "completed" && (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-[hsl(var(--success))]/20 bg-[hsl(var(--success))]/5">
                <CheckCircle2
                  className="h-4 w-4 text-[hsl(var(--success))] shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <p className="text-sm text-[hsl(var(--success))]">
                  Update applied. Run{" "}
                  <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-background border border-border/60 text-foreground">
                    npm run build
                  </code>
                  , then restart your server process, to run the new version.
                </p>
              </div>
            )}
            {/* The most dangerous message this panel can show, and it used to
                wear the same quiet single-line callout as the success note
                above, in --severity-medium, a token that encodes how bad a
                scan FINDING is and has no meaning for an install state. Amber
                warning tokens, a heavier border, and a heading line, because
                the instruction that matters ("do not restart") has to survive
                being skimmed. */}
            {job.status === "failed" &&
              job.steps?.some(
                (s) => s.name === "copy" && s.status === "done",
              ) && (
                <div className="flex items-start gap-3 p-4 rounded-lg border-2 border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/10">
                  <AlertTriangle
                    className="h-5 w-5 text-[hsl(var(--warning))] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[hsl(var(--warning))]">
                      Do not restart the server: this install is half-updated
                    </p>
                    <p className="text-sm text-foreground/90 mt-1">
                      Files were already copied onto this app&apos;s directory
                      before this step failed, so the on-disk source is now a
                      mix of old and new. Run &quot;Update now&quot; again first
                      (copying is safe to repeat) so the install actually
                      finishes, rather than restarting into a half-updated
                      build.
                    </p>
                  </div>
                </div>
              )}
            {job.status === "failed" && job.error && (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-destructive/20 bg-destructive/5">
                <XCircle
                  className="h-4 w-4 text-destructive shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <p className="text-sm text-destructive">{job.error}</p>
              </div>
            )}

            {job.log?.length > 0 && (
              <ScrollArea className="h-56 rounded-lg border border-border/40 bg-muted/20">
                <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">
                  {job.log.join("\n")}
                </pre>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}

      <AdminPasswordConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Apply update"
        description={`This downloads, verifies, and installs v${status?.latest ?? "the latest release"} over this app's files, then runs npm ci and npm run db:migrate (backing up the database first). It does not build or restart the server; you do that yourself once it finishes. Re-enter your password to confirm.`}
        confirmLabel="Apply update"
        variant="destructive"
        onConfirm={startUpdate}
      />
    </div>
  );
}
