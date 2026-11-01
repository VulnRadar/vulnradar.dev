// RUNTIME CONFIG RESOLVER
//
//   resolve(key) = database value ?? environment override ?? shipped default
//
// The database wins because that is the layer the admin panel edits. The
// environment comes next so a container can pin a value without a write. The
// shipped CONFIG_ constant comes last, which is why a fresh install with an
// empty system_settings table behaves exactly as it does today.
//
// Server only: this module talks to Postgres and must not be imported from a
// client component or from middleware.

import pool from "@/lib/database/db";
import { serverAppUrl } from "@/lib/config/server-app-url";

import {
  SETTINGS_REGISTRY,
  coerceSettingValue,
  isSettingKey,
  type SettingKey,
  type SettingValue,
} from "./registry";

const TTL_MS = 30_000;

type Snapshot = {
  values: Map<SettingKey, unknown>;
  loadedAt: number;
};

type CacheState = {
  snapshot: Snapshot | null;
  inFlight: Promise<Snapshot> | null;
};

/**
 * One value per process, whichever bundle copy asks. Next compiles this
 * module into more than one server bundle, and a plain module-level `let` is
 * then a separate cache per copy: an admin write invalidated one copy while
 * the others kept serving the old value for the rest of the TTL, and each copy
 * issued its own query. Keyed on globalThis so every copy shares one.
 *
 * Local until lib/runtime/global-singleton.ts lands; same signature.
 */
function globalSingleton<T>(key: string, init: () => T): T {
  const store = globalThis as unknown as Record<symbol, T | undefined>;
  const slot = Symbol.for(key);
  let value = store[slot];
  if (value === undefined) {
    value = init();
    store[slot] = value;
  }
  return value;
}

const cache = globalSingleton<CacheState>("vulnradar.runtimeConfig", () => ({
  snapshot: null,
  inFlight: null,
}));

/**
 * Drop the cached snapshot so the next resolve re-reads the table. Called by
 * the admin write path, which means the admin sees their own change at once
 * rather than waiting out the TTL. Other server processes converge via TTL.
 */
export function invalidateSettingsCache(): void {
  cache.snapshot = null;
  cache.inFlight = null;
}

async function query(): Promise<Snapshot> {
  const values = new Map<SettingKey, unknown>();
  try {
    const { rows } = await pool.query<{ key: string; value: string }>(
      "SELECT key, value FROM system_settings",
    );
    for (const row of rows) {
      if (!isSettingKey(row.key)) continue;
      const coerced = coerceSettingValue(row.key, row.value);
      if (coerced !== undefined) values.set(row.key, coerced);
    }
  } catch (error) {
    // Fail open. An empty map resolves every key to its environment override
    // or shipped default, so a database blip cannot turn every feature flag
    // false or drop every rate limit to nothing.
    console.error("[RuntimeConfig] Failed to load system_settings:", error);
  }
  return { values, loadedAt: Date.now() };
}

async function load(): Promise<Snapshot> {
  const { snapshot } = cache;
  if (snapshot && Date.now() - snapshot.loadedAt < TTL_MS) return snapshot;
  // Callers that arrive while a load is in progress share its result, so a
  // request that resolves ten settings still issues one query.
  if (cache.inFlight) return cache.inFlight;

  cache.inFlight = query()
    .then((loaded) => {
      cache.snapshot = loaded;
      return loaded;
    })
    .finally(() => {
      cache.inFlight = null;
    });

  return cache.inFlight;
}

function resolve<K extends SettingKey>(
  values: Map<SettingKey, unknown>,
  key: K,
): SettingValue<K> {
  const stored = values.get(key);
  if (stored !== undefined) return stored as SettingValue<K>;

  const fromEnv = process.env[key];
  if (fromEnv !== undefined && fromEnv !== "") {
    const coerced = coerceSettingValue(key, fromEnv);
    if (coerced !== undefined) return coerced;
  }

  return SETTINGS_REGISTRY[key].default as SettingValue<K>;
}

/** Resolve one setting. Reads the cached table snapshot, not a per-key query. */
export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<SettingValue<K>> {
  const { values } = await load();
  return resolve(values, key);
}

/** Resolve several settings from a single table snapshot. */
export async function getSettings<K extends SettingKey>(
  keys: readonly K[],
): Promise<Record<K, SettingValue<K>>> {
  const { values } = await load();
  const out = {} as Record<K, SettingValue<K>>;
  for (const key of keys) {
    out[key] = resolve(values, key);
  }
  return out;
}

/**
 * The value saved in system_settings for `key`, or undefined when there is no
 * valid row. Unlike getSetting it does not fall through to the environment or
 * the shipped default, for a caller with its own fallback order
 * (lib/config/server-app-url.ts).
 */
export async function getStoredSetting<K extends SettingKey>(
  key: K,
): Promise<SettingValue<K> | undefined> {
  const { values } = await load();
  return values.get(key) as SettingValue<K> | undefined;
}

/**
 * The application's public URL for building a redirect_uri. Same order as
 * serverAppUrl() (the saved setting, then APP_URL or NEXT_PUBLIC_APP_URL as
 * the running process sees them), except that the last resort is this
 * request's own origin rather than the shipped CONFIG_APP_URL: redirecting a
 * misconfigured deployment to a domain it does not own is worse than trusting
 * the Host header the request actually arrived on.
 */
export async function resolveAppUrl(request: Request): Promise<string> {
  return serverAppUrl(new URL(request.url).origin);
}
