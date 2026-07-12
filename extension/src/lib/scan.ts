// High-level scan trigger used by both the popup (manual) and the
// background service worker (auto-scan). Wraps the low-level api.scan
// call with: URL normalization, per-tab throttling, family+probe
// selection from settings, and caching the last-N history rows in
// chrome.storage.local.

import { api, VulnRadarApiError } from "./api";
import { get, set, getApiKey } from "./storage";
import { VULNRADAR } from "./constants";
import { looksLikeApiKey } from "./auth";
import type {
  ScanHistoryRow,
  ScanRequest,
  ScanResult,
  ScannerCategory,
  Settings,
} from "./types";

export class ScanThrottledError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Scan throttled; retry in ${retryAfterMs}ms`);
    this.name = "ScanThrottledError";
  }
}

export class ScanUnauthenticatedError extends Error {
  constructor() {
    super("Not connected to VulnRadar. Open Options to paste an API key.");
    this.name = "ScanUnauthenticatedError";
  }
}

/**
 * Validates a URL and returns the normalized form, or throws.
 * - Bare hostnames get https:// prepended
 * - Rejects non-http(s) schemes
 * - Rejects malformed URLs
 */
export function normalizeUrl(input: string): string {
  let s = input.trim();
  if (!s) throw new Error("URL is required");
  if (!/^https?:\/\//i.test(s)) {
    s = `https://${s}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Only http(s) URLs are supported (got ${parsed.protocol})`,
    );
  }
  return parsed.toString();
}

/**
 * Should this URL be scanned based on whitelist / blacklist / pause?
 * Returns null to proceed, or a string explaining why it was skipped.
 *
 * The matcher is a simple substring check (case-insensitive) against
 * the URL. Each entry is a "fragment" the URL must contain to match
 * the whitelist, or must not contain to match the blacklist. We avoid
 * full glob/regex for predictability.
 */
export function shouldAutoScan(
  url: string,
  settings: Settings,
  now: number = Date.now(),
): string | null {
  if (settings.pauseUntil !== null && now < settings.pauseUntil) {
    return "Auto-scan paused";
  }
  if (settings.autoScan === "off") return "Auto-scan is off";

  const u = url.toLowerCase();

  for (const deny of settings.blacklist) {
    if (deny && u.includes(deny.toLowerCase())) {
      return `Skipped (blacklist: ${deny})`;
    }
  }

  if (settings.whitelist.length > 0) {
    const allow = settings.whitelist.some((w) =>
      w ? u.includes(w.toLowerCase()) : false,
    );
    if (!allow) return "Skipped (no whitelist match)";
  }

  return null;
}

/**
 * Throttle auto-scans per (URL + day) so the user doesn't burn through
 * their daily quota if the content-script fires for every navigation.
 * Returns true if scan should proceed, false if it should be skipped.
 */
export async function canAutoScanNow(
  url: string,
  now: number = Date.now(),
): Promise<boolean> {
  const settings = (await get("settings"));
  if (!settings) return true;
  const last = await get("lastAutoScanAt");
  if (!last) return true;
  const throttleMs = settings.autoScanThrottleSeconds * 1000;
  if (now - last < throttleMs) return false;
  return true;
}

export async function noteAutoScanRan(now: number = Date.now()): Promise<void> {
  await set("lastAutoScanAt", now);
}

export interface ScanInput {
  readonly url: string;
  readonly settings: Settings;
}

/**
 * Run a single scan with the user's settings applied:
 *   - selected families from settings.families
 *   - selected probes from settings.probes
 *   - scan mode (quick / deep) selects /scan vs /scan/crawl
 *
 * On success, also appends to the local history cache (rolling 20).
 */
export async function runScan(input: ScanInput): Promise<ScanResult> {
  const apiKey = await getApiKey();
  if (!apiKey || !looksLikeApiKey(apiKey)) {
    throw new ScanUnauthenticatedError();
  }

  const url = normalizeUrl(input.url);
  const families = (Object.entries(input.settings.families) as Array<
    [ScannerCategory, boolean]
  >)
    .filter(([, enabled]) => enabled)
    .map(([id]) => id);

  const probes = (Object.entries(input.settings.probes) as Array<
    [string, { enabled: boolean; port: number }]
  >)
    .filter(([, cfg]) => cfg.enabled)
    .map(([id, cfg]) => `${id}:${cfg.port}`);

  const body: ScanRequest = {
    url,
    ...(families.length > 0 ? { scanners: families } : {}),
    ...(probes.length > 0 ? { probes } : {}),
  };

  const fetchResult =
    input.settings.scanMode === "deep"
      ? await api.scanCrawl(apiKey, { ...body, urls: [] })
      : await api.scan(apiKey, body);

  const result = fetchResult.body;

  // Append to rolling history cache (most recent first)
  const cache = (await get("historyCache")) ?? [];
  const newRow: ScanHistoryRow = {
    id: result.scanHistoryId ?? 0,
    url: result.url,
    summary: result.summary,
    findings_count: result.findings.length,
    duration: result.duration,
    scanned_at: result.scannedAt,
    source: "api",
    tags: [],
  };
  const next = [newRow, ...cache].slice(0, VULNRADAR.historyCacheSize);
  await set("historyCache", next);

  return result;
}

/**
 * Convenience wrapper: catches VulnRadarApiError, returns a typed
 * result envelope. Used by the popup UI.
 */
export type ScanOutcome =
  | { readonly ok: true; readonly result: ScanResult }
  | {
      readonly ok: false;
      readonly error: string;
      readonly retryAfterMs?: number;
      readonly requiresAuth?: boolean;
    };

export async function runScanSafe(input: ScanInput): Promise<ScanOutcome> {
  try {
    const r = await runScan(input);
    return { ok: true, result: r };
  } catch (err) {
    if (err instanceof ScanUnauthenticatedError) {
      return { ok: false, error: err.message, requiresAuth: true };
    }
    if (err instanceof ScanThrottledError) {
      return { ok: false, error: err.message, retryAfterMs: err.retryAfterMs };
    }
    if (err instanceof VulnRadarApiError) {
      const msg =
        err.status === 429
          ? `Daily or rate limit reached. ${err.body.error}`
          : err.body.error || `API error ${err.status}`;
      return { ok: false, error: msg };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Read the cached history from local storage. Refreshes from the
 * server in the background if the cache is empty (best-effort).
 */
export async function getHistory(): Promise<readonly ScanHistoryRow[]> {
  const cache = (await get("historyCache")) ?? [];
  return cache;
}

export async function refreshHistoryFromServer(): Promise<
  readonly ScanHistoryRow[]
> {
  const apiKey = await getApiKey();
  if (!apiKey || !looksLikeApiKey(apiKey)) return [];
  try {
    const res = await api.history(apiKey);
    const rows = res.body.scans.slice(0, VULNRADAR.historyCacheSize);
    await set("historyCache", rows);
    return rows;
  } catch {
    return [];
  }
}
