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

let snapshot: Snapshot | null = null;
let inFlight: Promise<Snapshot> | null = null;

/**
 * Drop the cached snapshot so the next resolve re-reads the table. Called by
 * the admin write path, which means the admin sees their own change at once
 * rather than waiting out the TTL. Other server processes converge via TTL.
 */
export function invalidateSettingsCache(): void {
  snapshot = null;
  inFlight = null;
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
  if (snapshot && Date.now() - snapshot.loadedAt < TTL_MS) return snapshot;
  // Callers that arrive while a load is in progress share its result, so a
  // request that resolves ten settings still issues one query.
  if (inFlight) return inFlight;

  inFlight = query()
    .then((loaded) => {
      snapshot = loaded;
      return loaded;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
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
