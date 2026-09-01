// Deadline arithmetic for the background's `scanInProgress` record.
//
// Kept out of storage.ts on purpose: that module pulls in
// webextension-polyfill, and this is pure logic worth testing on its own. The
// bug it exists for is real and unrecoverable without it - see
// isScanInProgressStale below.

import { VULNRADAR } from "./constants";
import type { ScanMode } from "./types";

/** The shape storage.ts persists. Repeated here to keep this module pure. */
export interface ScanInProgressRecord {
  readonly mode: ScanMode;
  readonly startedAt: number;
}

/** Slack over the server's own watchdog, covering response and write time. */
const STALE_SCAN_MARGIN_MS = 30_000;

function ceilingFor(record: ScanInProgressRecord): number {
  return record.mode === "deep"
    ? VULNRADAR.crawlTimeoutMs
    : VULNRADAR.scanTimeoutMs;
}

/**
 * Whether a `scanInProgress` record can still describe a live scan.
 *
 * The background clears the key in a `finally`, but an MV3 service worker can
 * die before that runs: a browser restart, an extension reload or update, or a
 * worker crash during a crawl that is allowed 910 seconds. The key then
 * survives forever, and every later popup on that URL read it, set
 * `isScanning`, disabled the Scan button and waited on a storage event that
 * would never fire, with no cancel control and no way back. Past this deadline
 * the record is treated as dead rather than trusted.
 */
export function isScanInProgressStale(
  record: ScanInProgressRecord,
  now: number = Date.now(),
): boolean {
  return now - record.startedAt > ceilingFor(record) + STALE_SCAN_MARGIN_MS;
}

/** Milliseconds left before a record goes stale, floored at zero. */
export function scanInProgressTimeLeftMs(
  record: ScanInProgressRecord,
  now: number = Date.now(),
): number {
  return Math.max(
    0,
    record.startedAt + ceilingFor(record) + STALE_SCAN_MARGIN_MS - now,
  );
}
