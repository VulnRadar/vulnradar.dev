// High-level scan trigger used by both the popup (manual) and the
// background service worker (auto-scan). Wraps the low-level api.scan
// call with: URL normalization, family+probe selection, and caching
// the last-N history rows in chrome.storage.local.
//
// IMPORTANT: shouldAutoScanPolicy() is for the auto-scan pipeline only.
// Manual scan triggers (popup button) must NOT call it — they should
// always proceed regardless of the autoScan setting.

import browser from "webextension-polyfill";
import { api, VulnRadarApiError, type FetchResult } from "./api";
import { get, set, getApiKey } from "./storage";
import { VULNRADAR } from "./constants";
import { looksLikeApiKey } from "./auth";
import type {
  RateLimitInfo,
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
    throw new Error(`Only http(s) URLs are supported (got ${parsed.protocol})`);
  }
  return parsed.toString();
}

/**
 * Auto-scan policy check: should this URL be auto-scanned?
 * Returns null to proceed, or a string reason why it was skipped.
 *
 * ONLY call this from the auto-scan pipeline (background service worker).
 * Manual scans via the popup bypass this entirely.
 */
export function shouldAutoScanPolicy(
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
 * Throttle auto-scans globally so the user doesn't burn through
 * their daily quota if the content-script fires for every navigation.
 * Returns true if the scan should proceed.
 */
export async function canAutoScanNow(
  _url: string,
  now: number = Date.now(),
): Promise<boolean> {
  const settings = await get("settings");
  if (!settings) return true;
  const last = await get("lastAutoScanAt");
  if (!last) return true;
  const throttleMs = settings.autoScanThrottleSeconds * 1000;
  return now - last >= throttleMs;
}

export async function noteAutoScanRan(now: number = Date.now()): Promise<void> {
  await set("lastAutoScanAt", now);
}

const SCAN_KEEPALIVE_ALARM = "vulnradar-scan-keepalive";

/**
 * Chrome can suspend an idle MV3 service worker background context after
 * ~30s with no pending work, and even the "return true, delay
 * sendResponse" pattern used for scan:url messages has a documented
 * ceiling (historically ~5 minutes) after which Chrome may restart the
 * service worker regardless of an in-flight fetch. A scan can legitimately
 * run up to CONFIG_SCAN_TIMEOUT_SECONDS (300s), or CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS
 * (900s) for a crawl - see lib/scanner/execute-scan.ts and
 * execute-crawl-scan.ts in the main app - comfortably past that ceiling.
 *
 * chrome.alarms firing counts as extension activity and resets the
 * service worker's idle-suspend clock, so a short repeating alarm for the
 * duration of the request keeps the worker alive without needing to rely
 * on Chrome's fetch-keeps-alive behavior holding for the full duration.
 * `alarms` is already a declared manifest permission. Wrapped here (not
 * in service-worker.ts) so every scan trigger - manual (popup relay),
 * auto-scan, and the on-page "Scan now" card - benefits uniformly from a
 * single call site instead of duplicating alarm setup per caller.
 */
async function withScanKeepAlive<T>(fn: () => Promise<T>): Promise<T> {
  try {
    // 1 minute is the shortest period Chrome allows for a repeating alarm
    // in a packaged extension; well under the ~30s idle-suspend window.
    await browser.alarms.create(SCAN_KEEPALIVE_ALARM, { periodInMinutes: 1 });
  } catch {
    // alarms API unavailable in this context - proceed without it rather
    // than fail the scan over a keep-alive nicety.
  }
  try {
    return await fn();
  } finally {
    try {
      await browser.alarms.clear(SCAN_KEEPALIVE_ALARM);
    } catch {
      /* noop */
    }
  }
}

export interface ScanInput {
  readonly url: string;
  readonly settings: Settings;
  /** Override the scan mode; falls back to settings.scanMode if omitted. */
  readonly mode?: "quick" | "deep";
}

const SCAN_POLL_INTERVAL_MS = 3_000;

/**
 * Neither POST /api/v3/scan nor POST /api/v3/scan/crawl return a finished
 * result anymore -- both start the scan in the background and respond
 * immediately with a job id (see app/api/v3/scan/route.ts and
 * app/api/v3/scan/crawl/route.ts in the main app). This polls
 * GET /api/v3/scan/status/[id] until it reports completed/failed, bounded
 * by `timeoutMs` (VULNRADAR.scanTimeoutMs for a single-page scan,
 * VULNRADAR.crawlTimeoutMs for a crawl -- matching each mode's own
 * server-side watchdog budget). Previously runScan() treated the
 * immediate {scanId, status: "running"} response as if it were the
 * finished ScanResult, crashing on result.findings.length -- first found
 * for crawl mode, then found again for quick mode once /api/v3/scan
 * became async too on 2026-08-08.
 */
async function pollScanUntilDone(
  apiKey: string,
  scanId: number,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<FetchResult<ScanResult>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const poll = await api.scanStatus(apiKey, scanId);
    const status = poll.body;
    if (status.status === "completed" && status.result) {
      return { ...poll, body: status.result };
    }
    if (status.status === "failed") {
      throw new Error(status.error || "The scan failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, SCAN_POLL_INTERVAL_MS));
  }
  throw new Error(timeoutMessage);
}

/**
 * Run a single scan with the user's settings applied.
 * Mode priority: input.mode > settings.scanMode.
 * Also caches rateLimitInfo and the last-N history rows.
 */
export async function runScan(input: ScanInput): Promise<ScanResult> {
  const apiKey = await getApiKey();
  if (!apiKey || !looksLikeApiKey(apiKey)) {
    throw new ScanUnauthenticatedError();
  }

  const url = normalizeUrl(input.url);
  const mode = input.mode ?? input.settings.scanMode;

  const families = (
    Object.entries(input.settings.families) as Array<[ScannerCategory, boolean]>
  )
    .filter(([, enabled]) => enabled)
    .map(([id]) => id);

  // `portScan` is the field the API reads. This used to serialise the
  // settings panel per-service list as `probes: ["ssh:22", ...]`, which no
  // handler had read since the server replaced that array with this flag: an
  // extension user configured probes, saved, scanned, and nothing happened.
  const body: ScanRequest = {
    url,
    ...(families.length > 0 ? { scanners: families } : {}),
    ...(input.settings.portScan ? { portScan: true } : {}),
  };

  const fetchResult = await withScanKeepAlive(async () => {
    if (mode === "deep") {
      const started = await api.scanCrawl(apiKey, { ...body, urls: [] });
      return pollScanUntilDone(
        apiKey,
        started.body.scanId,
        VULNRADAR.crawlTimeoutMs,
        "The crawl scan is taking longer than expected. Check History on the VulnRadar site shortly for the result.",
      );
    }
    const started = await api.scan(apiKey, body);
    return pollScanUntilDone(
      apiKey,
      started.body.scanId,
      VULNRADAR.scanTimeoutMs,
      "The scan is taking longer than expected. Check History on the VulnRadar site shortly for the result.",
    );
  });

  const result = fetchResult.body;

  // Cache rate limit info so the popup can show it without re-fetching.
  if (fetchResult.rateLimit.remaining !== null) {
    const rl: RateLimitInfo = {
      remaining: fetchResult.rateLimit.remaining,
      limit: fetchResult.rateLimit.limit ?? 0,
      resetsAt: fetchResult.rateLimit.reset
        ? new Date(fetchResult.rateLimit.reset).toISOString()
        : null,
    };
    await set("rateLimitInfo", rl);
  }

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
          ? `Rate limit reached. ${err.body.error}`
          : err.body.error || `API error ${err.status}`;
      return { ok: false, error: msg };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getHistory(): Promise<readonly ScanHistoryRow[]> {
  return (await get("historyCache")) ?? [];
}

/**
 * Same fetch, but says whether it worked. An empty array on its own can't
 * tell "you haven't scanned anything yet" from "the history request failed",
 * and the popup renders very different copy for the two.
 */
export async function fetchHistoryFromServer(): Promise<{
  readonly ok: boolean;
  readonly rows: readonly ScanHistoryRow[];
}> {
  const apiKey = await getApiKey();
  if (!apiKey || !looksLikeApiKey(apiKey)) return { ok: false, rows: [] };
  try {
    const res = await api.history(apiKey);
    const rows = res.body.scans.slice(0, VULNRADAR.historyCacheSize);
    await set("historyCache", rows);
    return { ok: true, rows };
  } catch {
    return { ok: false, rows: [] };
  }
}

export async function refreshHistoryFromServer(): Promise<
  readonly ScanHistoryRow[]
> {
  return (await fetchHistoryFromServer()).rows;
}
