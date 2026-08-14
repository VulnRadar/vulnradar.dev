"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

const STEP_LABELS: Record<string, string> = {
  "resolve-release": "Resolve release",
  download: "Download release assets",
  checksum: "Verify checksum",
  signature: "Verify cosign signature",
  extract: "Extract tarball",
  copy: "Copy files into app directory",
  "npm-ci": "npm ci",
  "npm-build": "npm run build",
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
  const [job, setJob] = useState<UpdaterJob | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v3/admin/updater/status");
      if (res.ok) {
        const data = (await res.json()) as UpdaterStatus;
        setStatus(data);
        if (data.activeJobId && !job) {
          setJob({ id: data.activeJobId } as UpdaterJob);
        }
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        if (data.job.status === "completed" || data.job.status === "failed") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      }
    } catch {
      /* ignore, retry on next tick */
    }
  }, []);

  useEffect(() => {
    if (!job?.id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- poll-on-job-change: pollJob's setState calls only fire after its async request resolves, not synchronously in this effect
    pollJob(job.id);
    pollRef.current = setInterval(() => pollJob(job.id), 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  const startUpdate = async () => {
    setStarting(true);
    setStartError(null);
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
        setPassword("");
      } else {
        setStartError(data.error || "Failed to start update.");
      }
    } catch {
      setStartError("Failed to start update.");
    } finally {
      setStarting(false);
    }
  };

  const jobRunning =
    !!job && job.status !== "completed" && job.status !== "failed";

  if (loading) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-8 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
          Loading updater status...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {status && !status.supported && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-border/50 bg-muted/30">
          <Info
            className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            {status.unsupportedReason}
          </p>
        </div>
      )}

      {status?.status === "behind" && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0">
            <DownloadCloud
              className="h-4 w-4 text-primary"
              aria-hidden="true"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              A new version is available: v{status.latest}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {status.message}
            </p>
          </div>
        </div>
      )}

      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-border/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <DownloadCloud
                  className="h-4 w-4 text-primary"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Updater
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Pull and install the latest release from GitHub. You restart
                  the server yourself once it finishes.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-border/40 shrink-0"
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
          </div>
        </div>

        <CardContent className="p-4 sm:p-5 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                Running
              </p>
              <p className="font-medium mt-0.5">v{status?.current ?? "?"}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                Latest
              </p>
              <p className="font-medium mt-0.5">
                {status?.latest ? `v${status.latest}` : "Unknown"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                cosign
              </p>
              <p className="font-medium mt-0.5">
                {status?.cosignAvailable ? "Available" : "Not installed"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                tar
              </p>
              <p className="font-medium mt-0.5">
                {status?.tarAvailable ? "Available" : "Not found"}
              </p>
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

          {!status?.cosignAvailable && (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <AlertTriangle
                className="h-3.5 w-3.5 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              cosign isn&apos;t installed on this host. The update will still be
              checksum-verified, but its cosign signature won&apos;t be checked.
            </p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button
              size="sm"
              className="h-9 gap-1.5"
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
          <div className="px-4 sm:px-5 py-4 border-b border-border/50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Terminal className="h-4 w-4 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Update to{" "}
                  {job.targetVersion
                    ? `v${job.targetVersion.replace(/^v/, "")}`
                    : "latest"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Job {job.id}
                </p>
              </div>
            </div>
            <Badge
              variant="secondary"
              className={cn(
                "text-xs font-medium h-6 px-2.5",
                job.status === "completed" &&
                  "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
                job.status === "failed" &&
                  "bg-destructive/10 text-destructive border-destructive/20",
              )}
            >
              {job.status}
            </Badge>
          </div>
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
                  Update applied. Restart your server process now to run the new
                  version.
                </p>
              </div>
            )}
            {job.status === "failed" &&
              job.steps?.some(
                (s) => s.name === "copy" && s.status === "done",
              ) && (
                <div className="flex items-start gap-3 p-3 rounded-lg border border-[hsl(var(--severity-medium))]/20 bg-[hsl(var(--severity-medium))]/5">
                  <AlertTriangle
                    className="h-4 w-4 text-[hsl(var(--severity-medium))] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-[hsl(var(--severity-medium))]">
                    Files were already copied onto this app's directory before
                    this step failed, so the on-disk source is now a mix of old
                    and new. Don't restart the server process yet: run "Update
                    now" again first (copying is safe to repeat) so the install
                    actually finishes, rather than restarting into a
                    half-updated build.
                  </p>
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

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => !o && setConfirmOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-destructive/10">
                <AlertTriangle
                  className="h-5 w-5 text-destructive"
                  aria-hidden="true"
                />
              </div>
              <div>
                <AlertDialogTitle>Apply update</AlertDialogTitle>
                <AlertDialogDescription>
                  This downloads, verifies, and installs v
                  {status?.latest ?? "the latest release"} over this app&apos;s
                  files, then runs npm ci, npm run build, and npm run
                  db:migrate. It does not restart the server; you do that
                  yourself once it finishes. Re-enter your password to confirm.
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>
          <div className="space-y-2 px-1">
            <Label htmlFor="updater-password">Your password</Label>
            <Input
              id="updater-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {startError && (
              <p className="text-xs text-destructive">{startError}</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={starting}
              onClick={() => setPassword("")}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={starting || password.length === 0}
              onClick={(e) => {
                e.preventDefault();
                startUpdate();
              }}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {starting && (
                <Loader2
                  className="h-4 w-4 mr-2 animate-spin"
                  aria-hidden="true"
                />
              )}
              Apply update
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
