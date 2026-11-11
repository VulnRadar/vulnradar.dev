/**
 * The async half of a scan (DNS, TLS, reputation, the live-fetch probes),
 * started once and bounded by an outer ceiling.
 *
 * The single-page executor, each crawl page, the demo and the authenticated
 * route all raced runAsyncChecksDetailed against a timer of their own, and the
 * four copies had drifted: one clamped the ceiling to the branch timeout and
 * the others did not, one aborted the losing side and the others left it
 * running against the target, one seeded `incomplete` before the race and the
 * others only on the paths they remembered. Every one of those differences was
 * a way for a scan that did not finish to read as clean, so the race lives
 * here once.
 */

import {
  runAsyncChecksDetailed,
  getPlannedAsyncBranches,
  type AsyncBranchScope,
} from "./async-checks";
import { ScanCancelledError } from "./scan-jobs";
import type { ScanProgressHook, Vulnerability } from "./types";

/**
 * How far past the async layer's per-branch timeout the outer race must be.
 * The branch timer starts only after a settings read, so an outer ceiling
 * equal to the branch ceiling can fire first and discard branches that had
 * already finished.
 */
const ASYNC_OUTER_HEADROOM_MS = 2_000;

/**
 * The outer ceiling, never shorter than one branch's own ceiling plus the
 * headroom. The two are separate admin settings with no cross-check, and the
 * race is a safety net only while it is the LONGER of the two: set below the
 * branch ceiling it wins while branches are still working, and its result is
 * an empty finding list with every branch marked not checked, which throws
 * away the DNS, TLS and reputation findings that had already finished.
 */
export function asyncOuterTimeoutMs(outerMs: number, branchMs: number): number {
  return Math.max(outerMs, branchMs + ASYNC_OUTER_HEADROOM_MS);
}

export interface AsyncPhaseOptions {
  url: string;
  scanners: string[] | null | undefined;
  scope?: AsyncBranchScope;
  onProgress?: ScanProgressHook;
  /** The scan's cancel signal. Aborting it aborts the phase. */
  parentSignal?: AbortSignal;
  /** SCAN_ASYNC_CHECKS_TIMEOUT_MS: the outer ceiling as configured. */
  checksTimeoutMs: number;
  /**
   * SCANNER_ASYNC_BRANCH_TIMEOUT_MS. When given, the outer ceiling is clamped
   * to stay above it (asyncOuterTimeoutMs).
   */
  branchTimeoutMs?: number;
}

export interface AsyncPhaseResult {
  findings: Vulnerability[];
  /**
   * Branch labels that reached no conclusion. On the ceiling or an
   * unexpected failure this is every planned branch: an empty list is the
   * claim that everything ran.
   */
  incomplete: string[];
  /** The outer ceiling fired before the checks settled. */
  timedOut: boolean;
}

/**
 * Start the phase now and return its eventual result. The promise only
 * rejects with ScanCancelledError; any other failure resolves to "nothing
 * planned completed".
 *
 * The phase runs on its own AbortController, joined to the parent signal, and
 * aborts it when the race settles either way: on the ceiling so the live-fetch
 * battery stops hitting the target with nobody waiting for it, and on success
 * so nothing still holding the signal outlives the phase. The timer is always
 * cleared, so it cannot fire late on a phase that already finished.
 */
export function startAsyncPhase(
  options: AsyncPhaseOptions,
): Promise<AsyncPhaseResult> {
  const {
    url,
    scanners,
    scope = "all",
    onProgress,
    parentSignal,
    checksTimeoutMs,
    branchTimeoutMs,
  } = options;

  const planned = getPlannedAsyncBranches(url, scanners, scope);
  const ownAbort = new AbortController();
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, ownAbort.signal])
    : ownAbort.signal;
  const ceilingMs =
    branchTimeoutMs === undefined
      ? checksTimeoutMs
      : asyncOuterTimeoutMs(checksTimeoutMs, branchTimeoutMs);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<AsyncPhaseResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ findings: [], incomplete: planned, timedOut: true }),
      ceilingMs,
    );
  });

  const checks = runAsyncChecksDetailed(
    url,
    scanners,
    onProgress,
    signal,
    scope,
  ).then(
    (result): AsyncPhaseResult => ({ ...result, timedOut: false }),
    (err: unknown): AsyncPhaseResult => {
      if (err instanceof ScanCancelledError) throw err;
      // runAsyncChecksDetailed absorbs per-branch failures, so this is only
      // reachable on something it cannot absorb. Either way the layer
      // contributed nothing, which is exactly what incomplete records.
      return { findings: [], incomplete: planned, timedOut: false };
    },
  );

  const phase = Promise.race([checks, ceiling]).finally(() => {
    if (timer) clearTimeout(timer);
    ownAbort.abort();
  });
  // The ceiling can win while `checks` later rejects with a cancel, and a
  // caller that started the phase early may still be in its sync checks when
  // a cancel rejects it. Neither must surface as an unhandled rejection; the
  // caller's own await still receives the cancel, since a promise can carry
  // more than one handler.
  checks.catch(() => {});
  phase.catch(() => {});
  return phase;
}
