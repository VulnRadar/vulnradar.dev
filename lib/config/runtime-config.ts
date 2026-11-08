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

// How long a failed load is believed before the next attempt. Short, because
// until a read succeeds an admin's change is invisible to this process; long
// enough that a burst of requests during an outage is not a burst of failing
// queries against a database that is already in trouble.
const FAILED_LOAD_RETRY_MS = 4_000;

type Snapshot = {
  values: Map<SettingKey, unknown>;
  freshUntil: number;
};

type CacheState = {
  snapshot: Snapshot | null;
  inFlight: Promise<Snapshot> | null;
  generation: number;
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
  generation: 0,
}));

/**
 * Mark the cached snapshot stale so the next resolve re-reads the table. Called
 * by the admin write path, which means the admin sees their own change at once
 * rather than waiting out the TTL. Other server processes converge via TTL.
 *
 * Stale rather than dropped: if the re-read fails, the values from before are
 * still the best answer available. The generation stops a read already on the
 * wire, which may have seen the row from before the write, from being stored
 * as the fresh answer afterwards.
 */
export function invalidateSettingsCache(): void {
  cache.generation += 1;
  cache.inFlight = null;
  if (cache.snapshot) cache.snapshot.freshUntil = 0;
}

/** The table as a map, or null when it could not be read. */
async function query(): Promise<Map<SettingKey, unknown> | null> {
  try {
    const { rows } = await pool.query<{ key: string; value: string }>(
      "SELECT key, value FROM system_settings",
    );
    const values = new Map<SettingKey, unknown>();
    for (const row of rows) {
      if (!isSettingKey(row.key)) continue;
      const coerced = coerceSettingValue(row.key, row.value);
      if (coerced !== undefined) values.set(row.key, coerced);
    }
    return values;
  } catch (error) {
    console.error("[RuntimeConfig] Failed to load system_settings:", error);
    return null;
  }
}

async function load(): Promise<Snapshot> {
  const { snapshot } = cache;
  if (snapshot && Date.now() < snapshot.freshUntil) return snapshot;
  // Callers that arrive while a load is in progress share its result, so a
  // request that resolves ten settings still issues one query.
  if (cache.inFlight) return cache.inFlight;

  const { generation } = cache;
  const pending: Promise<Snapshot> = query()
    .then((values) => {
      // A failed read keeps the last good values, so a database blip cannot
      // turn ENFORCE_STAFF_2FA or a rate limit an admin tightened back into
      // its shipped default. With nothing loaded yet the empty map fails open:
      // every key resolves to its environment override or shipped default,
      // never to every feature flag false or every limit nothing.
      const loaded: Snapshot = values
        ? { values, freshUntil: Date.now() + TTL_MS }
        : {
            values: cache.snapshot?.values ?? new Map(),
            freshUntil: Date.now() + FAILED_LOAD_RETRY_MS,
          };
      if (generation === cache.generation) cache.snapshot = loaded;
      return loaded;
    })
    .finally(() => {
      if (cache.inFlight === pending) cache.inFlight = null;
    });
  cache.inFlight = pending;

  return pending;
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
