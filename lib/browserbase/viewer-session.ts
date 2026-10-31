import type { NetworkRequest } from "@/lib/browserbase/client";

/**
 * Timing and list-identity helpers for the live browser viewer
 * (app/browser/[id]/page.tsx), split out so the parts that are wrong silently
 * can be tested without a DOM.
 */

/**
 * The longest delay setTimeout honours. A larger one fires immediately, which
 * for a deadline timer means ending a session hours early.
 */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** A session's expiry from the API (an ISO string) as epoch ms, or null if it
 *  is missing or does not parse. */
export function parseExpiry(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The first of several deadlines (epoch ms) to pass, ignoring the ones that
 * are not set. The viewer ends a session at whichever comes first: the
 * user-controlled timer, or the provider's own expiry as a hard backstop.
 */
export function earliestDeadline(
  deadlines: ReadonlyArray<number | null | undefined>,
): number | null {
  let earliest: number | null = null;
  for (const d of deadlines) {
    if (d === null || d === undefined || !Number.isFinite(d)) continue;
    if (earliest === null || d < earliest) earliest = d;
  }
  return earliest;
}

/**
 * Calls `fire` once, when `deadline` (epoch ms) passes, and returns the
 * function that cancels it.
 *
 * One timeout, re-armed in steps when the wait is longer than a timer can
 * hold: setTimeout fires at once for anything past MAX_TIMER_MS, which for a
 * deadline would mean acting hours early. A deadline already in the past fires
 * synchronously.
 */
export function onDeadline(deadline: number, fire: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    const wait = deadline - Date.now();
    if (wait <= 0) {
      fire();
      return;
    }
    timer = setTimeout(arm, Math.min(wait, MAX_TIMER_MS));
  };
  arm();
  return () => clearTimeout(timer);
}

/** Whole seconds left until `deadline`, never negative. */
export function secondsRemaining(deadline: number, now: number): number {
  return Math.max(0, Math.floor((deadline - now) / 1000));
}

export function formatMmSs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Whether two polls of the network log describe a row the same way, so a
 * memoised row can skip a render. Every poll replaces the whole array with
 * fresh objects, so identity never holds; this compares what the row draws.
 * `timestamp` is deliberately left out: nothing shows it.
 */
export function sameRequest(a: NetworkRequest, b: NetworkRequest): boolean {
  return (
    a === b ||
    (a.requestId === b.requestId &&
      a.method === b.method &&
      a.status === b.status &&
      a.failed === b.failed &&
      a.path === b.path &&
      a.host === b.host &&
      a.mimeType === b.mimeType &&
      a.url === b.url)
  );
}
