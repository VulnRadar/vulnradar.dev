// Shared badge-coloring logic. The background service worker (auto-scan,
// context-menu scans) and the popup (manual scans) both need to stamp the
// same danger-score color scale onto the extension icon - duplicating the
// thresholds in both places would let them drift out of sync, so this is
// the single source of truth for "what does a badge look like after a
// scan". Extension pages (popup/options) have the same browser.action
// access as the background, so the popup can call this directly without
// round-tripping through a message.

import browser from "webextension-polyfill";
import type { ScanResult } from "./types";

/** Exported so the content script's reputation popup can color its danger
 *  badge with the exact same scale as the extension icon badge, instead of
 *  re-deriving its own thresholds. */
export function colorForScore(score: number): string {
  return score >= 8
    ? "#ef4444"
    : score >= 5
      ? "#f97316"
      : score >= 3
        ? "#eab308"
        : "#22c55e";
}

export function setBadgeForResult(result: ScanResult): void {
  const score = result.dangerScore ?? 0;
  try {
    browser.action.setBadgeText({ text: score > 0 ? String(score) : "" });
    browser.action.setBadgeBackgroundColor({ color: colorForScore(score) });
  } catch {
    // Firefox may not support action.setBadge* in every context.
  }
}

export function clearBadge(): void {
  try {
    browser.action.setBadgeText({ text: "" });
  } catch {
    /* noop */
  }
}
