// browser.storage.local wrapper (uses webextension-polyfill — works on
// both Chrome and Firefox). All extension state lives here so it's
// scoped to the extension profile (not synced to Google) and survives
// browser restarts.
//
// Schema versioning: only clears storage when an OLDER version is
// explicitly present. Missing schemaVersion = fresh install; we merge
// with DEFAULT rather than wiping (prevents the API key from being
// erased on every background-page reload).

import browser from "webextension-polyfill";
import type Browser from "webextension-polyfill";
import {
  DEFAULT_SETTINGS,
  type AuthState,
  type RateLimitInfo,
  type ReputationResponse,
  type ScanHistoryRow,
  type ScanMode,
  type ScanResult,
  type Settings,
} from "./types";

export const STORAGE_SCHEMA_VERSION = 1;

/** Set by the background while it is running a "scan:url" message (a
 *  manual scan triggered from the popup); cleared when that resolves.
 *  Lets a popup that gets torn down mid-scan (losing focus kills the
 *  popup document immediately, but the background keeps the scan going)
 *  tell on reopen that a scan for this tab's URL is still in flight. */
export interface ScanInProgress {
  readonly url: string;
  readonly mode: ScanMode;
  readonly startedAt: number;
}

/** Snapshot of the most recent scan the background finished running for a
 *  "scan:url" message. Written right before scanInProgress is cleared, so
 *  a reopened popup can show what happened to a scan it never got a
 *  response for, instead of resetting to idle. Keyed by url so a reopened
 *  popup only trusts a completion that actually matches the scan it was
 *  waiting on. */
export interface LastScanCompletion {
  readonly url: string;
  readonly finishedAt: number;
  readonly outcome:
    | { readonly ok: true; readonly result: ScanResult }
    | { readonly ok: false; readonly error: string };
}

/** A reputation lookup result cached alongside the timestamp it was
 *  fetched at, so a throttled revisit can still show *something* instead
 *  of nothing (see reputationCache below). */
export interface CachedReputation {
  readonly data: ReputationResponse;
  readonly cachedAt: number;
}

export interface StorageShape {
  schemaVersion: number;
  auth: AuthState | null;
  settings: Settings;
  historyCache: ScanHistoryRow[];
  lastAutoScanAt: number;
  rateLimitInfo: RateLimitInfo | null;
  lastResult: ScanResult | null;
  /** host -> last reputation-check timestamp (ms). Throttles the on-page
   *  site-alert lookup per host; not part of saveAll()'s core snapshot,
   *  read/written directly via get()/set() like `mutedHosts` below. */
  reputationThrottleMap: Record<string, number>;
  /** host -> last known reputation result, kept independently of the
   *  throttle timestamp above. When canCheckReputationNow() blocks a fresh
   *  network lookup, the background falls back to this instead of
   *  telling the content script nothing at all - a throttled revisit
   *  should still show the card (and update the toolbar badge) with the
   *  last-known result, not go silent. Same direct get()/set() access
   *  pattern as `mutedHosts`. */
  reputationCache: Record<string, CachedReputation>;
  /** host -> true for hosts the user dismissed with "don't show for this
   *  site" before pattern-based muting existed. Checked before the
   *  site-alert card is ever shown, forever - kept as a permanent,
   *  scheme-agnostic exact-hostname mute mechanism alongside
   *  `mutedPatterns` below (not migrated into it) so nobody's
   *  already-muted site silently reappears. */
  mutedHosts: Record<string, true>;
  /** URL match patterns (see lib/url-patterns.ts) that disable the
   *  site-alert card for matching URLs - the Settings > Site Alerts page's
   *  add/remove list. Every new mute (the card's "Not this site" quick
   *  action, and the Settings UI) writes here; `mutedHosts` above is only
   *  ever read now, never written to. */
  mutedPatterns: readonly string[];
  /** host -> epoch ms the card's "Snooze 24h" quick action should stop
   *  suppressing the site-alert card for that host. Unlike `mutedHosts`/
   *  `mutedPatterns` above (permanent until manually unmuted), this is a
   *  temporary, self-expiring, per-host suppression - it never disables
   *  the popup for path/subdomain variants the way a mute pattern can, and
   *  it lapses on its own instead of needing an unmute action anywhere.
   *  Same direct get()/set() storage-key-isolation pattern as `mutedHosts`
   *  and `reputationThrottleMap`: snoozing one site never touches the
   *  rest of the user's settings. */
  snoozedHosts: Record<string, number>;
  /** See ScanInProgress above. Not part of saveAll()'s core snapshot,
   *  read/written directly via get()/set() like `mutedHosts` above. */
  scanInProgress: ScanInProgress | null;
  /** See LastScanCompletion above. Same access pattern as scanInProgress. */
  lastScanCompletion: LastScanCompletion | null;
}

export const DEFAULT: StorageShape = {
  schemaVersion: STORAGE_SCHEMA_VERSION,
  auth: null,
  settings: DEFAULT_SETTINGS,
  historyCache: [],
  lastAutoScanAt: 0,
  rateLimitInfo: null,
  lastResult: null,
  reputationThrottleMap: {},
  reputationCache: {},
  mutedHosts: {},
  mutedPatterns: [],
  snoozedHosts: {},
  scanInProgress: null,
  lastScanCompletion: null,
};

export async function get<K extends keyof StorageShape>(
  key: K,
): Promise<StorageShape[K] | null> {
  const result = (await browser.storage.local.get(key as string)) as Partial<
    Record<K, StorageShape[K]>
  >;
  return (result[key] ?? null) as StorageShape[K] | null;
}

export async function set<K extends keyof StorageShape>(
  key: K,
  value: StorageShape[K],
): Promise<void> {
  await browser.storage.local.set({ [key]: value } as Partial<
    Record<K, StorageShape[K]>
  >);
}

export async function remove(key: keyof StorageShape): Promise<void> {
  await browser.storage.local.remove(key as string);
}

export async function clearAll(): Promise<void> {
  await browser.storage.local.clear();
}

export async function getApiKey(): Promise<string | null> {
  const auth = await get("auth");
  return auth?.apiKey ?? null;
}

/**
 * Loads the full stored snapshot. Only clears storage when an older
 * schema version is explicitly present (real upgrade path). Missing
 * schemaVersion means fresh install — merge with DEFAULT to preserve
 * any keys already written (e.g. auth written by pasteKey() before
 * saveAll() stamps the version).
 */
export async function loadAll(): Promise<StorageShape> {
  const raw = (await browser.storage.local.get(null)) as Partial<
    Record<string, unknown>
  >;
  if (
    typeof raw.schemaVersion === "number" &&
    raw.schemaVersion < STORAGE_SCHEMA_VERSION
  ) {
    await clearAll();
    return DEFAULT;
  }
  const merged = { ...DEFAULT, ...raw } as StorageShape;
  // `settings` is stored as one object, so a settings blob saved before a
  // new family/probe existed would otherwise fully replace DEFAULT_SETTINGS
  // and silently drop it - a newly added scan category would read as
  // unchecked and never run instead of defaulting on like a fresh install.
  // Merge the two nested maps explicitly; everything the user actually
  // changed is still preserved since it's spread last.
  if (raw.settings) {
    const rawSettings = raw.settings as Settings;
    merged.settings = {
      ...DEFAULT_SETTINGS,
      ...rawSettings,
      families: { ...DEFAULT_SETTINGS.families, ...rawSettings.families },
      probes: { ...DEFAULT_SETTINGS.probes, ...rawSettings.probes },
    };
  }
  return merged;
}

export async function saveAll(state: StorageShape): Promise<void> {
  await browser.storage.local.set({
    schemaVersion: STORAGE_SCHEMA_VERSION,
    auth: state.auth,
    settings: state.settings,
    historyCache: state.historyCache,
    lastAutoScanAt: state.lastAutoScanAt,
    rateLimitInfo: state.rateLimitInfo ?? null,
    lastResult: state.lastResult ?? null,
  });
}

/**
 * On startup, subscribe to storage changes so the popup/options can
 * react live to settings changes without polling. Returns the
 * unsubscribe function.
 */
export function onChanged(
  callback: (
    changes: Record<string, Browser.Storage.StorageChange>,
    areaName: string,
  ) => void,
): () => void {
  const listener = (
    changes: Record<string, Browser.Storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== "local") return;
    callback(changes, areaName);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
