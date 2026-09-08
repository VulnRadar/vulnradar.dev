/**
 * The stale-scan reaper, on a timer as well as at boot.
 *
 * lib/scanner/scan-jobs.ts's sweepStaleScans is the SQL. It used to have
 * exactly one caller, the boot safety net in lib/database/boot/safety-nets.ts,
 * so the only thing that ever released a scan stuck at 'pending'/'running'
 * was the next process start. That covers the case it was written for (a
 * process killed mid-scan by a deploy, an OOM, a crash) and nothing else. A
 * row that goes stale while the process is UP has no rescuer: the dispatch
 * that threw before executeScan armed its watchdog, the watchdog whose own
 * finalizeScanFailure write was rejected because the database was the thing
 * that was unhealthy, the batch a caller abandoned. Each of those sits there
 * until someone deploys, holding one of the owner's concurrent-scan slots the
 * whole time (lib/rate-limiting/concurrent-scans.ts counts every
 * 'pending'/'running' row) and showing on their dashboard as a scan that
 * never finishes.
 *
 * The sweep's age guard is written for a repeating caller and reads oddly
 * without one: it refuses to touch anything younger than twice the longest
 * configured scan budget, 1800 seconds on the shipped defaults, so the in-
 * process watchdog always gets to fail its own scan first. A boot-only caller
 * can never observe that window deliberately, it just happens to be past it.
 * This is the caller the grace period was sized for.
 */

import { sweepStaleScans } from "./scan-jobs";
import { createFailureEscalator } from "@/lib/admin/failure-escalation";
import { CONFIG_STALE_SCAN_SWEEP_INTERVAL_MS } from "@/lib/config/config-values";
import { APP_NAME } from "@/lib/config/constants";

/** Which caller ran the sweep. Only changes what operators are told. */
export type StaleScanSweepTrigger = "boot" | "periodic";

function sweptMessage(swept: number, trigger: StaleScanSweepTrigger): string {
  return trigger === "boot"
    ? `${swept} scan(s) were left running/pending by a previous process (an unclean restart) and have been marked failed.`
    : `${swept} scan(s) went stale while the server was running and have been marked failed. Each one held a concurrent-scan slot until it was swept, so something is finishing a scan without ever closing its row.`;
}

/**
 * Run one sweep and tell operators about it. Returns how many rows were
 * failed. Throws whatever sweepStaleScans throws, so a caller with an
 * escalator can count a failed pass; both callers here wrap it.
 */
export async function runStaleScanSweep(
  trigger: StaleScanSweepTrigger,
): Promise<number> {
  const swept = await sweepStaleScans();
  if (swept === 0) return 0;

  console.error(`[${APP_NAME}] ${sweptMessage(swept, trigger)}`);
  const { sendAdminAlert } = await import("@/lib/admin/alert-webhook");
  void sendAdminAlert({
    event: "stale_scans_swept",
    severity: "warning",
    message: sweptMessage(swept, trigger),
    context: { count: swept, trigger },
  });
  return swept;
}

let activeStaleSweepTimer: NodeJS.Timeout | null = null;

/**
 * Sweep on a repeating interval. Same shape as every other worker here (an
 * unref'd setInterval, a repeat call cancelling the previous timer, a failure
 * escalator on the pass itself), so it only fires in a long-lived deployment,
 * which is the same deployment the in-process watchdog it backstops needs.
 */
export function schedulePeriodicStaleScanSweep(
  intervalMs: number = CONFIG_STALE_SCAN_SWEEP_INTERVAL_MS,
): NodeJS.Timeout {
  if (activeStaleSweepTimer) {
    clearInterval(activeStaleSweepTimer);
  }
  const safeInterval =
    Number.isFinite(intervalMs) && intervalMs > 0
      ? intervalMs
      : CONFIG_STALE_SCAN_SWEEP_INTERVAL_MS;

  const escalator = createFailureEscalator("stale_scan_sweep_failing");
  activeStaleSweepTimer = setInterval(async () => {
    try {
      await runStaleScanSweep("periodic");
      escalator.recordSuccess();
    } catch (err) {
      console.error(`[${APP_NAME}] Stale-scan sweep pass failed:`, err);
      escalator.recordFailure(
        "The stale-scan sweep is failing on every pass -- a scan that dies without closing its row will hold its owner's concurrency slot until the next restart",
      );
    }
  }, safeInterval);
  activeStaleSweepTimer.unref?.();
  return activeStaleSweepTimer;
}

export function stopPeriodicStaleScanSweep(): void {
  if (activeStaleSweepTimer) {
    clearInterval(activeStaleSweepTimer);
    activeStaleSweepTimer = null;
  }
}
