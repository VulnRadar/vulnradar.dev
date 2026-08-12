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
import type { CachedReputation, LastShownReputation } from "./storage";
import { VULNRADAR } from "./constants";
import { shouldAutoScanPolicy } from "./scan";
import { matchesUrlPattern } from "./url-patterns";
import type { ReputationResponse, ScanResult, Settings } from "./types";

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
 * Last-known reputation result for a host, independent of the throttle
 * timestamp above. Lets a throttled revisit (canCheckReputationNow ==
 * false) still show the site-alert card and update the toolbar badge
 * with whatever we last learned, instead of going silent for up to the
 * full throttle window on every reload/renavigation.
 */
export async function getCachedReputation(
  host: string,
): Promise<ReputationResponse | null> {
  const cache = (await get("reputationCache")) ?? {};
  return cache[host]?.data ?? null;
}

export async function cacheReputation(
  host: string,
  data: ReputationResponse,
  now: number = Date.now(),
): Promise<void> {
  const cache: Record<string, CachedReputation> = {
    ...((await get("reputationCache")) ?? {}),
  };
  // Same staleness prune as noteReputationChecked's throttle map above - a
  // day is well past any realistic revisit window.
  const maxAgeMs = 24 * 60 * 60 * 1000;
  for (const [h, entry] of Object.entries(cache)) {
    if (now - entry.cachedAt >= maxAgeMs) delete cache[h];
  }
  cache[host] = { data, cachedAt: now };
  await set("reputationCache", cache);
}

/** How long a repeat of the same result stays suppressed for one host. */
const SHOWN_SUPPRESS_MS = 4 * 60 * 60 * 1000;

/**
 * Identity of a reputation result, covering both the known and unknown
 * cards with one comparable value: "unknown" for a not-yet-scanned host, or
 * scanId (falling back to lastScannedAt) for a known one. A host flipping
 * between the two -- someone just scanned it, or a purge dropped it back to
 * unknown -- changes this key, so that transition always re-shows the card
 * even within the suppression window; only a truly identical repeat result
 * gets suppressed.
 */
function reputationResultKey(rep: ReputationResponse): string | number {
  if (!rep.known) return "unknown";
  return rep.scanId ?? rep.lastScannedAt ?? "known";
}

/**
 * True when the site-alert card (known-result OR not-scanned-yet prompt,
 * whichever applies) is actually worth showing for this fresh reputation
 * result: either the user hasn't seen a card for this host in the last few
 * hours, or the result identity has changed since the one they were last
 * shown (a new scan ran, or the host went from unknown to known or back).
 * Reloading the same page, switching tabs, or navigating between pages on
 * the same host (dashboard -> admin is still vulnradar.dev) no longer
 * re-shows an identical card every time -- see StorageShape.
 * lastShownReputation for why this is separate from the network-check
 * throttle and the manual snooze/mute mechanisms above.
 */
export async function shouldShowReputationCard(
  host: string,
  rep: ReputationResponse,
  now: number = Date.now(),
): Promise<boolean> {
  const map = (await get("lastShownReputation")) ?? {};
  const last = map[host];
  if (!last) return true;
  if (now - last.shownAt >= SHOWN_SUPPRESS_MS) return true;
  return reputationResultKey(rep) !== last.resultKey;
}

/** Records that the site-alert card was just shown for this result, so
 *  shouldShowReputationCard() can suppress an identical repeat on the next
 *  page load/tab switch/tab focus within the suppression window. */
export async function noteReputationShown(
  host: string,
  rep: ReputationResponse,
  now: number = Date.now(),
): Promise<void> {
  const map: Record<string, LastShownReputation> = {
    ...((await get("lastShownReputation")) ?? {}),
  };
  // Same opportunistic staleness prune as the other host-maps in this file.
  for (const [h, entry] of Object.entries(map)) {
    if (now - entry.shownAt >= SHOWN_SUPPRESS_MS) delete map[h];
  }
  map[host] = { resultKey: reputationResultKey(rep), shownAt: now };
  await set("lastShownReputation", map);
}

/**
 * Writes the reputation cache directly from a scan this extension just ran,
 * instead of waiting for the next page-load reputation check to pick it up.
 *
 * Without this, scanning a host updates the server but never touches the
 * local reputationCache - only maybeShowReputationFromSender() (background/
 * service-worker.ts) writes to it, and only on an unthrottled check. Since
 * that same host was almost always just checked (the visit that led to the
 * scan), the very next visit lands inside canCheckReputationNow()'s
 * throttle window and falls back to getCachedReputation(), which still
 * holds the stale pre-scan "not scanned" result. A refresh right after
 * scanning would then report the host as unscanned despite the scan that
 * just completed. Called with the same raw tab hostname cacheReputation()
 * is always keyed by elsewhere (not any server-normalized host string).
 */
export async function cacheReputationFromScan(
  host: string,
  result: ScanResult,
): Promise<void> {
  await cacheReputation(host, {
    known: true,
    host,
    dangerScore: result.dangerScore ?? 0,
    verdict: result.verdict ?? null,
    severityCounts: {
      critical: result.summary.critical,
      high: result.summary.high,
      medium: result.summary.medium,
      low: result.summary.low,
      info: result.summary.info,
    },
    lastScannedAt: result.scannedAt,
    scanId: result.scanHistoryId ?? null,
  });
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
// Two independent levels: a pair of global toggles (Settings.showScanResults
// / showScanPrompts, round-trip through settings:set like every other
// setting) and a per-site mute list. The per-site list has two
// storage-level mechanisms
// that both get checked, never merged: `mutedHosts` (a plain host->true
// map, exact hostname, scheme-agnostic - the original mechanism, now
// read-only from here on so already-muted sites from before pattern
// matching existed keep working forever) and `mutedPatterns` (a list of
// glob-ish URL patterns, see lib/url-patterns.ts - what every new mute,
// from the card's "Not this site" quick action or the Settings UI, writes
// to now). Both are stored directly via get()/set() rather than through
// the full settings object, same as reputationThrottleMap, so muting one
// site never touches the rest of the user's settings.
//
// A third, separate mechanism - `snoozedHosts` (below) - is temporary
// rather than permanent: the card's "Snooze 24h" quick action, checked
// alongside the two mute mechanisms in canShowPopupForUrl() so a snoozed
// host is silently skipped identically to a muted one until it expires.

export async function isHostMuted(host: string): Promise<boolean> {
  const muted = (await get("mutedHosts")) ?? {};
  return muted[host] === true;
}

export async function addMutePattern(pattern: string): Promise<void> {
  const patterns = (await get("mutedPatterns")) ?? [];
  if (patterns.includes(pattern)) return;
  await set("mutedPatterns", [...patterns, pattern]);
}

/**
 * True when `url` is muted by either mechanism described above. Replaces
 * the old hostname-only isHostMuted() at every call site that decides
 * whether the site-alert card is allowed to show.
 */
export async function isUrlMuted(url: string): Promise<boolean> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (await isHostMuted(host)) return true;
  const patterns = (await get("mutedPatterns")) ?? [];
  return patterns.some((p) => matchesUrlPattern(url, p));
}

const SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * True when `host` is currently within an active (non-expired) snooze
 * window started by the card's "Snooze 24h" quick action.
 */
export async function isHostSnoozed(
  host: string,
  now: number = Date.now(),
): Promise<boolean> {
  const map = (await get("snoozedHosts")) ?? {};
  const expiresAt = map[host];
  return expiresAt !== undefined && expiresAt > now;
}

/**
 * Suppresses the site-alert card for `host` only, for 24 hours - unlike
 * addMutePattern()/isHostMuted() above, this is temporary and self-expiring,
 * with no separate "unsnooze" action anywhere. Same direct get()/set()
 * storage-key-isolation pattern as mutedHosts/reputationThrottleMap: this
 * never touches the rest of the user's settings. Expired entries are
 * pruned opportunistically on write, same as noteReputationChecked's
 * throttle map and cacheReputation's cache above.
 */
export async function snoozeHost(
  host: string,
  now: number = Date.now(),
): Promise<void> {
  const map: Record<string, number> = {
    ...((await get("snoozedHosts")) ?? {}),
  };
  for (const [h, expiresAt] of Object.entries(map)) {
    if (expiresAt <= now) delete map[h];
  }
  map[host] = now + SNOOZE_DURATION_MS;
  await set("snoozedHosts", map);
}

/**
 * True when the site-alert popup (known-host card OR "scan this?" prompt --
 * either one, not both) is allowed to show for this URL at all - checked
 * BEFORE calling checkReputation(), so a muted/disabled/snoozed host never
 * triggers the network request in the first place. Only skips outright
 * when BOTH showScanResults and showScanPrompts are off, since we don't
 * yet know which of the two this host will turn out to need -- the
 * specific one is picked after the reputation check resolves (see
 * background/service-worker.ts's handleReputationCheck). Global toggles
 * checked first since it's a plain settings read, cheaper than the
 * storage lookups below. A URL that fails to parse is treated the same as
 * "not snoozed" (matches isUrlMuted()'s own catch-and-allow behavior for
 * an unparsable URL) rather than blocking the popup outright.
 */
export async function canShowPopupForUrl(
  url: string,
  settings: Settings,
): Promise<boolean> {
  if (!settings.showScanResults && !settings.showScanPrompts) return false;
  if (await isUrlMuted(url)) return false;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return true;
  }
  return !(await isHostSnoozed(host));
}
