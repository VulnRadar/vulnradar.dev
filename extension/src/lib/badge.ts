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

/**
 * Stamps the badge from a bare danger score - used when there's no full
 * ScanResult on hand, e.g. a reputation lookup on page visit rather than
 * a scan the extension just ran itself.
 *
 * `tabId` MUST be passed whenever the caller knows which tab this result
 * is for (essentially always). Without it, `action.setBadgeText` writes
 * the extension-wide default badge, which then keeps showing on every
 * *other* tab that has never had its own tab-scoped badge set - e.g. a
 * dangerous host's "10" badge bleeding into an unrelated tab you switch
 * to afterward. `tabId` is only omitted for the rare case where no tab
 * context exists at all (falls back to the global default badge).
 */
export function setBadgeForScore(score: number, tabId?: number): void {
  try {
    const text = score > 0 ? String(score) : "";
    const color = colorForScore(score);
    if (tabId === undefined) {
      browser.action.setBadgeText({ text });
      browser.action.setBadgeBackgroundColor({ color });
    } else {
      browser.action.setBadgeText({ text, tabId });
      browser.action.setBadgeBackgroundColor({ color, tabId });
    }
  } catch {
    // Firefox may not support action.setBadge* in every context.
  }
}

export function setBadgeForResult(result: ScanResult, tabId?: number): void {
  setBadgeForScore(result.dangerScore ?? 0, tabId);
}

/** See setBadgeForScore's `tabId` note - the same global-bleed risk
 *  applies to clearing. */
export function clearBadge(tabId?: number): void {
  try {
    if (tabId === undefined) {
      browser.action.setBadgeText({ text: "" });
    } else {
      browser.action.setBadgeText({ text: "", tabId });
    }
  } catch {
    /* noop */
  }
}
