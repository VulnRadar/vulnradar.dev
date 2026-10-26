// High-level scan trigger used by both the popup (manual) and the
// background service worker (auto-scan). Wraps the low-level api.scan
// call with: URL normalization, family+probe selection, and caching
// the last-N history rows in chrome.storage.local.
//
// IMPORTANT: shouldAutoScanPolicy() is for the auto-scan pipeline only.
// Manual scan triggers (popup button) must NOT call it — they should
// always proceed regardless of the autoScan setting.

import browser from "webextension-polyfill";
import {
  api,
  apiErrorFallback,
  VulnRadarApiError,
  type FetchResult,
} from "./api";
import { get, set, update, getApiKey } from "./storage";
import { VULNRADAR } from "./constants";
import { looksLikeApiKey } from "./auth";
import {
  carriesCredential,
  isPublicHostname,
  withoutFragment,
} from "./lookup-url";
import { DEFAULT_SETTINGS } from "./types";
import type {
  RateLimitInfo,
  ScanHistoryRow,
  ScanRequest,
  ScanResult,
  ScannerCategory,
  Settings,
} from "./types";

export class ScanUnauthenticatedError extends Error {
  constructor() {
    super("Not connected to VulnRadar. Open Options to paste an API key.");
    this.name = "ScanUnauthenticatedError";
  }
}

/**
 * Every check family is switched off in Options.
 *
 * Refused here rather than sent, because the API reads a missing or empty
 * `scanners` as "run every default category": passing the empty selection
 * through would run a FULL scan, the exact inverse of what the user asked
 * for, and charge them a quota unit for it.
 */
export class ScanNoFamiliesError extends Error {
  constructor() {
    super(
      "No check families are enabled. Turn at least one on in Options before scanning.",
    );
    this.name = "ScanNoFamiliesError";
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

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "Skipped (not a web address)";
  }
  // Unattended means nobody looked at this address first, so it has to be one
  // that is safe to send away: a public host, and nothing in the address that
  // reads as a credential. A scan stores its URL in the account's history.
  if (!isPublicHostname(host)) return "Skipped (private address)";
  if (carriesCredential(url)) return "Skipped (address carries a credential)";

  // Never the fragment: it does not reach a server, so a rule written against
  // the address should not be able to match on it either.
  const u = withoutFragment(url).toLowerCase();

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

// ---- Auto-scan throttle ----
//
// Two limits, both on what an unattended scan may cost the user's daily quota:
//
//   - globally, no two auto-scans closer than Settings.autoScanThrottleSeconds,
//     whichever sites they are for;
//   - per site, no second auto-scan of the same hostname inside
//     Settings.autoScanHostCooldownHours.
//
// The persisted half (lastAutoScanAt, autoScannedAt) survives a service worker
// restart. The in-memory half exists for a race the persisted one cannot close:
// a browser restoring a session fires page:loaded for every tab in the same
// tick, each handler reads storage before any of them has written it, and all
// of them used to pass. claimAutoScan() is synchronous, so the second handler
// to reach it sees the first one's claim.

const HOUR_MS = 60 * 60 * 1000;

function cooldownMs(settings: Settings): number {
  const hours = settings.autoScanHostCooldownHours;
  const clamped = Number.isFinite(hours)
    ? Math.min(VULNRADAR.autoScanHostCooldownMaxHours, Math.max(0, hours))
    : DEFAULT_SETTINGS.autoScanHostCooldownHours;
  return clamped * HOUR_MS;
}

const claimedHosts = new Map<string, number>();
let lastClaimAt = 0;

export interface AutoScanClaim {
  /** Hands the claim back when the scan turned out not to run. */
  readonly release: () => void;
}

/**
 * Reserves the right to auto-scan `host` right now, or returns null when the
 * global throttle or the host's cooldown says no. Call it before the first
 * await of an auto-scan, then confirm with canAutoScanNow() and
 * noteAutoScanRan(), releasing the claim if the scan does not go ahead.
 */
export function claimAutoScan(
  host: string,
  settings: Settings,
  now: number = Date.now(),
): AutoScanClaim | null {
  if (
    lastClaimAt !== 0 &&
    now - lastClaimAt < settings.autoScanThrottleSeconds * 1000
  ) {
    return null;
  }
  const maxAgeMs = VULNRADAR.autoScanHostCooldownMaxHours * HOUR_MS;
  for (const [h, at] of claimedHosts) {
    if (now - at >= maxAgeMs) claimedHosts.delete(h);
  }
  const previousHostClaim = claimedHosts.get(host);
  if (
    previousHostClaim !== undefined &&
    now - previousHostClaim < cooldownMs(settings)
  ) {
    return null;
  }
  const previousGlobalClaim = lastClaimAt;
  lastClaimAt = now;
  claimedHosts.set(host, now);
  return {
    release: () => {
      if (lastClaimAt === now) lastClaimAt = previousGlobalClaim;
      if (claimedHosts.get(host) !== now) return;
      if (previousHostClaim === undefined) claimedHosts.delete(host);
      else claimedHosts.set(host, previousHostClaim);
    },
  };
}

/** Test seam: forgets every in-memory claim. */
export function resetAutoScanClaims(): void {
  claimedHosts.clear();
  lastClaimAt = 0;
}

/**
 * The persisted check behind claimAutoScan(): true when neither the global
 * throttle nor the host's cooldown, as last written to storage, forbids a scan
 * of `host` now.
 */
export async function canAutoScanNow(
  host: string,
  settings: Settings,
  now: number = Date.now(),
): Promise<boolean> {
  const last = (await get("lastAutoScanAt")) ?? 0;
  if (last && now - last < settings.autoScanThrottleSeconds * 1000) {
    return false;
  }
  const seen = (await get("autoScannedAt")) ?? {};
  const scannedAt = seen[host];
  return scannedAt === undefined || now - scannedAt >= cooldownMs(settings);
}

export async function noteAutoScanRan(
  host: string,
  now: number = Date.now(),
): Promise<void> {
  await set("lastAutoScanAt", now);
  const maxAgeMs = VULNRADAR.autoScanHostCooldownMaxHours * HOUR_MS;
  await update("autoScannedAt", (current) => {
    const next: Record<string, number> = { ...current };
    for (const [h, at] of Object.entries(next)) {
      if (now - at >= maxAgeMs) delete next[h];
    }
    next[host] = now;
    return next;
  });
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
/**
 * How many status polls may fail in a row before the scan is abandoned.
 *
 * Not one, which is what "no try/catch" amounted to. A crawl polls a few
 * hundred times across its budget, so a single blip failed a scan that was
 * succeeding.
 */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

async function withScanKeepAlive<T>(fn: () => Promise<T>): Promise<T> {
  try {
    // 30 seconds, and the comment this replaces had the arithmetic
    // backwards: it said one minute was "well under the ~30s idle-suspend
    // window", when it is double it. An alarm at t=60s wakes a fresh worker
    // and cannot resurrect the scan closure evicted at t=30s, which is what
    // all the stale-scan recovery machinery in scan-lifecycle.ts exists to
    // clean up after. 0.5 has been the MV3 minimum since Chrome 120.
    await browser.alarms.create(SCAN_KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
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
  /**
   * True for a scan nobody asked for in the moment: auto-scan. It never sends
   * active probing or the port sweep, whatever Options says. Both write to or
   * open connections against the target (and need a verified domain), which a
   * person ticks on for a scan they start, not for every page a rule happens
   * to match.
   */
  readonly unattended?: boolean;
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
  /** The start response's rate-limit headers; the status poll sends none. */
  startRateLimit?: FetchResult<unknown>["rateLimit"],
): Promise<FetchResult<ScanResult>> {
  const deadline = Date.now() + timeoutMs;
  let consecutiveFailures = 0;
  while (Date.now() < deadline) {
    let poll: Awaited<ReturnType<typeof api.scanStatus>>;
    try {
      poll = await api.scanStatus(apiKey, scanId);
    } catch (err) {
      // A crawl polls a few hundred times over its budget, so treating one
      // dropped connection or one 502 from a proxy as fatal threw the whole
      // scan out to the popup's error banner while it completed server-side
      // and landed in the user's history. The same defect was in the CLI.
      consecutiveFailures += 1;
      if (consecutiveFailures > MAX_CONSECUTIVE_POLL_FAILURES) throw err;
      await new Promise((resolve) =>
        setTimeout(resolve, SCAN_POLL_INTERVAL_MS),
      );
      continue;
    }
    consecutiveFailures = 0;
    const status = poll.body;
    if (status.status === "completed" && status.result) {
      // rateLimit from the START response, not from this poll.
      //
      // This returned `{ ...poll, body: status.result }`, so the rate-limit
      // fields came from GET /scan/status, which emits no X-RateLimit headers
      // at all: it deliberately never charges quota. The response that does
      // carry them is the POST that started the scan, and it was discarded.
      // So remaining was always null, the cache was never written, and the
      // popup's "N remaining today" block and "Unlimited scans" pill have
      // never rendered for anyone.
      return {
        ...poll,
        rateLimit: startRateLimit ?? poll.rateLimit,
        body: status.result,
      };
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

  const unattended = input.unattended === true;
  const allFamilies = Object.entries(input.settings.families) as Array<
    [ScannerCategory, boolean]
  >;
  const families = allFamilies
    .filter(([id, on]) => on && !(unattended && id === "active-probes"))
    .map(([id]) => id);
  // "The user narrowed the set" is not the same as "the user picked nothing",
  // and the API cannot tell them apart: it reads a missing or empty
  // `scanners` as "run every default category". So omitting the key when the
  // list was empty meant switching every family OFF in Options ran a full
  // scan, which is the exact inverse of what the screen said. Nothing to scan
  // is a client-side error now, before a request is made.
  if (allFamilies.length > 0 && families.length === 0) {
    throw new ScanNoFamiliesError();
  }

  // `portScan` is the field the API reads. This used to serialise the
  // settings panel per-service list as `probes: ["ssh:22", ...]`, which no
  // handler had read since the server replaced that array with this flag: an
  // extension user configured probes, saved, scanned, and nothing happened.
  // Always the explicit list, never omitted.
  //
  // Omitting it when the user had ticked every family looked like a tidy
  // optimisation and was the exact opposite. A missing `scanners` means "run
  // the defaults" to the API, and the active-probe catalog reads a null
  // selection as "run no active probes at all", so the maximal configuration
  // was the one that scanned least: Options read 18 of 18, Active Probing was
  // on, and it never ran. Un-ticking any unrelated family made it start
  // working, which is the kind of behaviour nobody reports as a bug because
  // nobody believes it.
  const body: ScanRequest = {
    url,
    scanners: families,
    ...(input.settings.portScan && !unattended ? { portScan: true } : {}),
  };

  const fetchResult = await withScanKeepAlive(async () => {
    if (mode === "deep") {
      const started = await api.scanCrawl(apiKey, { ...body, urls: [] });
      return pollScanUntilDone(
        apiKey,
        started.body.scanId,
        VULNRADAR.crawlTimeoutMs,
        "The crawl scan is taking longer than expected. Check History on the VulnRadar site shortly for the result.",
        started.rateLimit,
      );
    }
    const started = await api.scan(apiKey, body);
    return pollScanUntilDone(
      apiKey,
      started.body.scanId,
      VULNRADAR.scanTimeoutMs,
      "The scan is taking longer than expected. Check History on the VulnRadar site shortly for the result.",
      started.rateLimit,
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
    // The opaque id, matching what GET /history returns. Caching the
    // numeric scanHistoryId here made a locally-scanned row a different
    // shape from a server-fetched one in the same cache.
    id: result.scanPublicId ?? "",
    url: result.url,
    summary: result.summary,
    findings_count: result.findings.length,
    duration: result.duration,
    scanned_at: result.scannedAt,
    source: "api",
    // runScan only returns once the poll saw a terminal state, and a failed
    // scan throws before reaching here, so a row cached at this point is
    // always a completed one.
    status: "completed",
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
    if (err instanceof VulnRadarApiError) {
      const msg =
        err.status === 429
          ? `Rate limit reached. ${err.body.error}`
          : err.body.error || apiErrorFallback(err.status);
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
/**
 * How long an empty history result is trusted before the server is asked
 * again. Each ask costs the caller a daily quota unit, so this is a spend
 * limit rather than a freshness knob: a scan run from the extension updates
 * the cache locally and does not wait for this.
 */
export const HISTORY_REFETCH_COOLDOWN_MS = 60 * 60 * 1000;

/** Whether a server fetch is worth its quota unit right now. */
export async function shouldRefetchHistory(): Promise<boolean> {
  const last = (await get("historyFetchedAt")) ?? 0;
  return Date.now() - last >= HISTORY_REFETCH_COOLDOWN_MS;
}

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
    // Stamped even when rows is empty, which is the case that mattered: an
    // empty cache is indistinguishable from a never-fetched one without it.
    await set("historyFetchedAt", Date.now());
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
