// browser.storage.local wrapper (uses webextension-polyfill — works on
// both Chrome and Firefox). All extension state lives here so it's
// scoped to the extension profile (not synced to Google) and survives
// browser restarts.
//
// Schema versioning: when an OLDER version is explicitly present, only the
// derived caches are dropped (DERIVED_CACHE_KEYS); the API key, the settings
// and the mute lists are the user's own and survive a bump. Missing
// schemaVersion = fresh install; we merge with DEFAULT rather than wiping
// (prevents the API key from being erased on every background-page reload).

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

/** Identity of a reputation result the site-alert card (known or unknown)
 *  was last shown for, used to decide whether a new one is worth
 *  re-showing - see StorageShape.lastShownReputation and
 *  reputation.ts's reputationResultKey for exactly how this is derived. */
export interface LastShownReputation {
  readonly resultKey: string | number;
  readonly shownAt: number;
}

/** A "Scan this site" offer the background made for one tab, kept so the
 *  scan can be started from what the background recorded instead of from an
 *  address the page-side card sends back. See lib/offered-scan.ts. */
export interface OfferedScan {
  readonly host: string;
  readonly url: string;
  readonly offeredAt: number;
}

export interface StorageShape {
  schemaVersion: number;
  auth: AuthState | null;
  settings: Settings;
  historyCache: ScanHistoryRow[];
  /**
   * When the history list was last fetched from the server, epoch ms.
   *
   * The popup fell back to a server fetch whenever the local cache was empty.
   * For an account with no scans yet the response IS empty, so the cache
   * stayed empty and every single popup open fetched again. GET
   * /api/v3/history runs checkApiKeyRateLimit, which INSERTs an api_usage row
   * rather than merely reading one, so each of those opens spent a daily scan
   * quota unit. A new Free-tier user could exhaust the day by opening the
   * popup, without ever running a scan.
   */
  historyFetchedAt: number;
  lastAutoScanAt: number;
  /** hostname -> when auto-scan last scanned it (ms). The per-site cooldown
   *  (Settings.autoScanHostCooldownHours) reads this; entries older than a
   *  day are pruned on write. Read and written directly through get()/set(),
   *  like `mutedHosts`. */
  autoScannedAt: Record<string, number>;
  /** tab id (as a string) -> the scan the card offered in that tab. */
  offeredScans: Record<string, OfferedScan>;
  rateLimitInfo: RateLimitInfo | null;
  lastResult: ScanResult | null;
  /** host -> last reputation-check timestamp (ms). Throttles the on-page
   *  site-alert lookup per host; read/written directly via get()/set() like
   *  `mutedHosts` below. */
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
  /** host -> identity of the reputation result the site-alert card (known
   *  OR the not-scanned-yet prompt) last actually showed, plus when.
   *  Unlike `snoozedHosts` above (a manual, opt-in "stop showing this"
   *  action), this is automatic: the card is suppressed on every
   *  subsequent page load/tab switch/tab focus for the same host as long
   *  as the result hasn't changed AND it's been under the suppression
   *  window (a few hours) - so reloading, switching tabs, or navigating
   *  between pages on the same host doesn't re-show the same card every
   *  time, but a genuinely new/changed result (or the window elapsing)
   *  still does. See reputation.ts's shouldShowReputationCard/
   *  noteReputationShown. Same direct get()/set() storage-key-isolation
   *  pattern as `reputationThrottleMap`. */
  lastShownReputation: Record<string, LastShownReputation>;
  /** See ScanInProgress above. Read/written directly via get()/set() like
   *  `mutedHosts` above. */
  scanInProgress: ScanInProgress | null;
  /** See LastScanCompletion above. Same access pattern as scanInProgress. */
  lastScanCompletion: LastScanCompletion | null;
}

export const DEFAULT: StorageShape = {
  schemaVersion: STORAGE_SCHEMA_VERSION,
  auth: null,
  settings: DEFAULT_SETTINGS,
  historyCache: [],
  historyFetchedAt: 0,
  lastAutoScanAt: 0,
  autoScannedAt: {},
  offeredScans: {},
  rateLimitInfo: null,
  lastResult: null,
  reputationThrottleMap: {},
  reputationCache: {},
  mutedHosts: {},
  mutedPatterns: [],
  snoozedHosts: {},
  lastShownReputation: {},
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
 * Everything the extension can rebuild or re-fetch, as opposed to what the
 * user entered. A schema bump removes exactly these. It used to clear storage
 * outright, which signed everyone out and threw away their settings and mute
 * lists the first time a release changed the shape of a cache.
 */
export const DERIVED_CACHE_KEYS: readonly (keyof StorageShape)[] = [
  "historyCache",
  "historyFetchedAt",
  "lastResult",
  "lastScanCompletion",
  "reputationCache",
  "reputationThrottleMap",
  "lastShownReputation",
  "rateLimitInfo",
  "autoScannedAt",
  "offeredScans",
];

/**
 * A stored settings blob laid over DEFAULT_SETTINGS. `settings` is stored as
 * one object, so a blob saved before a new family or setting existed would
 * otherwise fully replace DEFAULT_SETTINGS and silently drop it: a newly added
 * scan category would read as unchecked and never run instead of defaulting on
 * like a fresh install. The nested `families` map is merged explicitly;
 * everything the user actually changed is still preserved since it is spread
 * last.
 */
export function normalizeSettings(raw: Partial<Settings> | null): Settings {
  if (!raw) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    families: { ...DEFAULT_SETTINGS.families, ...raw.families },
  };
}

/**
 * Loads the full stored snapshot. When an older schema version is explicitly
 * present (a real upgrade) the derived caches are removed and the version is
 * stamped, and everything the user owns is kept. Missing schemaVersion means
 * fresh install: merge with DEFAULT to preserve any keys already written (e.g.
 * auth written by pasteKey() before anything stamps the version).
 */
export async function loadAll(): Promise<StorageShape> {
  const raw = (await browser.storage.local.get(null)) as Partial<
    Record<string, unknown>
  >;
  if (
    typeof raw.schemaVersion === "number" &&
    raw.schemaVersion < STORAGE_SCHEMA_VERSION
  ) {
    await browser.storage.local.remove([...DERIVED_CACHE_KEYS]);
    await browser.storage.local.set({
      schemaVersion: STORAGE_SCHEMA_VERSION,
    });
    for (const key of DERIVED_CACHE_KEYS) delete raw[key];
    raw.schemaVersion = STORAGE_SCHEMA_VERSION;
  }
  const merged = { ...DEFAULT, ...raw } as StorageShape;
  if (raw.settings) {
    merged.settings = normalizeSettings(raw.settings as Settings);
  }
  return merged;
}

// Read-modify-write on one key, serialised per key within this JS context.
// Two writers that each read, change and set the same key would otherwise
// interleave their awaits and the second set would erase the first's change:
// two quick clicks in Options, or two tabs finishing loading in the same tick.
// Writers in different contexts (the options page and the background) can
// still race, but the window is one storage round trip rather than a whole
// handler.
const updateChains = new Map<string, Promise<unknown>>();

export function update<K extends keyof StorageShape>(
  key: K,
  change: (current: StorageShape[K] | null) => StorageShape[K],
): Promise<StorageShape[K]> {
  const previous = updateChains.get(key) ?? Promise.resolve();
  const run = previous.then(async () => {
    const next = change(await get(key));
    await set(key, next);
    return next;
  });
  updateChains.set(
    key,
    run.catch(() => {}),
  );
  return run;
}

/**
 * Writes `partial` over the stored settings and nothing else. The options
 * page used to rebuild the whole storage snapshot to save one toggle, which
 * rewrote auth, the history cache and the last auto-scan time from a copy read
 * moments earlier, so a toggle clicked while a key refresh or a scan was
 * landing could put the older values back.
 */
export function patchSettings(partial: Partial<Settings>): Promise<Settings> {
  return update("settings", (current) => {
    const base = normalizeSettings(current);
    return {
      ...base,
      ...partial,
      families: { ...base.families, ...partial.families },
    };
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
