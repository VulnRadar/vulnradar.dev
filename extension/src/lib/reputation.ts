// Site-visit reputation lookups: GET /api/v3/scan/reputation?host=<hostname>.
// Tells the content script whether a host has been scanned before, so it
// can show a small "known / not scanned yet" popup on page load.
//
// Kept separate from lib/scan.ts because this is a read-only lookup, not a
// scan trigger - it never touches the scan rate limit and must never throw
// on failure (a broken reputation lookup is a missed popup, not an error
// the user needs to see).
//
// Throttled per HOST (not per URL - the endpoint itself is host-scoped) so
// repeat navigations to different pages on the same site within a short
// window don't spam the endpoint.

import { api } from "./api";
import { get, set } from "./storage";
import { VULNRADAR } from "./constants";
import { shouldAutoScanPolicy } from "./scan";
import type { ReputationResponse, Settings } from "./types";

export async function canCheckReputationNow(
  host: string,
  now: number = Date.now(),
): Promise<boolean> {
  const map = (await get("reputationThrottleMap")) ?? {};
  const last = map[host];
  if (last === undefined) return true;
  return now - last >= VULNRADAR.reputationThrottleMs;
}

export async function noteReputationChecked(
  host: string,
  now: number = Date.now(),
): Promise<void> {
  const map: Record<string, number> = {
    ...((await get("reputationThrottleMap")) ?? {}),
  };
  // Drop stale entries so the map doesn't grow unbounded over a long
  // browsing session - a day is well past any realistic throttle window.
  const maxAgeMs = 24 * 60 * 60 * 1000;
  for (const [h, t] of Object.entries(map)) {
    if (now - t >= maxAgeMs) delete map[h];
  }
  map[host] = now;
  await set("reputationThrottleMap", map);
}

/**
 * Looks up reputation for a host. Returns null on any failure (network
 * error, non-2xx, malformed body) - the caller treats null the same as
 * "don't show anything", never as an error to surface to the user.
 */
export async function checkReputation(
  apiKey: string,
  host: string,
): Promise<ReputationResponse | null> {
  try {
    const res = await api.reputation(apiKey, host);
    return res.body;
  } catch {
    return null;
  }
}

/**
 * True when the "not scanned yet" popup should stay silent because
 * onPageLoad auto-scan is about to run for this exact URL anyway.
 * Showing both would double-prompt the user for the same page load.
 * Only relevant to the known:false case - a known:true popup reports
 * history the user already has, independent of what auto-scan does next.
 */
export function willAutoScanHandleSilently(
  url: string,
  settings: Settings,
): boolean {
  return (
    settings.autoScan === "onPageLoad" &&
    shouldAutoScanPolicy(url, settings) === null
  );
}

// ---- Mute settings ----
//
// Two independent levels: a global toggle (Settings.siteAlertsEnabled,
// round-trips through settings:set like every other setting) and a
// per-site mute list (mutedHosts, a plain host->true map stored the same
// way reputationThrottleMap is - written directly via get()/set() rather
// than through the full settings object, so muting one site never
// touches the rest of the user's settings).

export async function isHostMuted(host: string): Promise<boolean> {
  const muted = (await get("mutedHosts")) ?? {};
  return muted[host] === true;
}

export async function muteHost(host: string): Promise<void> {
  const muted: Record<string, true> = {
    ...((await get("mutedHosts")) ?? {}),
  };
  muted[host] = true;
  await set("mutedHosts", muted);
}

/**
 * True when the site-alert popup (known-host card or "scan this?" prompt)
 * is allowed to show for this host at all - checked BEFORE calling
 * checkReputation(), so a muted/disabled host never triggers the network
 * request in the first place. Global toggle checked first since it's a
 * plain settings read, cheaper than the storage lookup for mutedHosts.
 */
export async function canShowPopupForHost(
  host: string,
  settings: Settings,
): Promise<boolean> {
  if (!settings.siteAlertsEnabled) return false;
  return !(await isHostMuted(host));
}
