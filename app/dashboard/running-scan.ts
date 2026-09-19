import type { ScanMode } from "@/components/scanner/scan-form";

/**
 * The scan this tab is following, kept in sessionStorage so a reload can pick
 * it back up. Per tab, and gone with it. Storage that throws (a private
 * window, blocked site data) only costs the pick-up: the scan still runs.
 */
const RUNNING_SCAN_KEY = "vulnradar:running-scan";

export interface RememberedScan {
  scanId: number;
  url: string;
  mode: ScanMode;
  isCrawl: boolean;
}

export function rememberRunningScan(scan: RememberedScan | null): void {
  try {
    if (scan) sessionStorage.setItem(RUNNING_SCAN_KEY, JSON.stringify(scan));
    else sessionStorage.removeItem(RUNNING_SCAN_KEY);
  } catch {
    // Storage unavailable: nothing to remember it in.
  }
}

export function readRememberedScan(): RememberedScan | null {
  try {
    const raw = sessionStorage.getItem(RUNNING_SCAN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RememberedScan>;
    return typeof value.scanId === "number" && typeof value.url === "string"
      ? {
          scanId: value.scanId,
          url: value.url,
          mode: value.mode ?? "quick",
          isCrawl: value.isCrawl === true,
        }
      : null;
  } catch {
    return null;
  }
}
