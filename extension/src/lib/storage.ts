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
import {
  DEFAULT_SETTINGS,
  type AuthState,
  type RateLimitInfo,
  type ScanHistoryRow,
  type ScanResult,
  type Settings,
} from "./types";

export const STORAGE_SCHEMA_VERSION = 1;

export interface StorageShape {
  schemaVersion: number;
  auth: AuthState | null;
  settings: Settings;
  historyCache: ScanHistoryRow[];
  lastAutoScanAt: number;
  rateLimitInfo: RateLimitInfo | null;
  lastResult: ScanResult | null;
}

export const DEFAULT: StorageShape = {
  schemaVersion: STORAGE_SCHEMA_VERSION,
  auth: null,
  settings: DEFAULT_SETTINGS,
  historyCache: [],
  lastAutoScanAt: 0,
  rateLimitInfo: null,
  lastResult: null,
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
  return { ...DEFAULT, ...raw } as StorageShape;
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
    changes: Record<string, browser.StorageChange>,
    areaName: string,
  ) => void,
): () => void {
  const listener = (
    changes: Record<string, browser.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== "local") return;
    callback(changes, areaName);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
