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
import { CLEAN_SOLID, SEVERITY_SOLID } from "./tokens";

export type ScoreTier = "unsafe" | "caution" | "safe";

/**
 * The tier a danger score falls in.
 *
 * Boundaries (5, 8) match lib/scanner/safety-rating.ts's getDangerScore tier
 * caps EXACTLY (safe: 0-4, caution: 5-7, unsafe: 8-10) on purpose: this used
 * to insert an extra yellow band at score 3-4, which is still within the
 * "safe" tier everywhere else -- so a host the rest of the app correctly
 * called safe/green got a yellow toolbar badge and score ring for a score
 * as low as 3. Three colors now, not four, so this can never disagree with
 * the tier a score belongs to.
 *
 * Split out of colorForScore so the two things that need a tier can share the
 * boundaries: the toolbar badge, which has no theme and needs a solid hex, and
 * the on-page card, which does and needs a CSS variable (TIER_VAR below).
 */
export function tierForScore(score: number): ScoreTier {
  return score >= 8 ? "unsafe" : score >= 5 ? "caution" : "safe";
}

/**
 * Exported so the content script's reputation popup can color its danger
 * badge with the exact same scale as the extension icon badge, instead of
 * re-deriving its own thresholds.
 */
export function colorForScore(score: number): string {
  // Same ramp as everywhere else (lib/tokens.json), not a private copy.
  const SOLID: Record<ScoreTier, string> = {
    unsafe: SEVERITY_SOLID.critical,
    caution: SEVERITY_SOLID.medium,
    safe: CLEAN_SOLID,
  };
  return SOLID[tierForScore(score)];
}

/**
 * The same three tiers as CSS variables, for anything rendered into a themed
 * surface rather than stamped onto the toolbar icon.
 *
 * colorForScore returns the SOLID ramp, which is the dark theme's, because a
 * browser action badge has no theme to follow. The on-page card does: it used
 * colorForScore for its score ring and the number inside it, which on the
 * light theme drew that number at 1.56:1 (caution) and 1.80:1 (safe) against
 * the ring's own centre, under the 3:1 a 24px bold numeral needs. These follow
 * the theme, and measure 4.56:1 to 6.74:1 light, 5.13:1 to 9.76:1 dark.
 */
export const TIER_VAR: Record<ScoreTier, string> = {
  unsafe: "var(--vr-sev-critical)",
  caution: "var(--vr-sev-medium)",
  safe: "var(--vr-success)",
};

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
