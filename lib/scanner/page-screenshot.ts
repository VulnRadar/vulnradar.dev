/**
 * Opt-in page screenshot capture.
 *
 * Competitors (Detectify, Probely) show a rendered screenshot of each
 * scanned page. VulnRadar's scan is a headless HTTP fetch, so it never
 * renders the target -- the only place a real browser is spun up is the
 * browser-driven login (lib/scanner/auth/browser-login.ts). This module
 * reuses that exact BrowserBase infrastructure to grab ONE above-the-fold
 * frame of the scanned URL, on demand.
 *
 * A real headless browser session is expensive and metered ("live-browser
 * minutes", lib/billing/browserbase-usage.ts), so this is never on by
 * default: it runs only when the user opts in (a scan option) AND their
 * plan/meter allows it. Every capture:
 *
 *   - is best-effort: any failure, timeout, or missing BrowserBase config
 *     returns null and NEVER throws, so a scan is never slowed or failed by
 *     a screenshot that didn't work out;
 *   - consumes from the same browserbase-minutes meter a live viewer session
 *     does (recordBrowserbaseSeconds), and respects the same plan gate
 *     (checkBrowserbaseQuota) and global concurrency queue
 *     (acquireConcurrencySlot);
 *   - is hard-bounded in wall-clock time so a stuck target can't hold a
 *     session open.
 *
 * The bytes are stored in the scan_screenshots table (one row per scan),
 * NOT stuffed into result_meta -- result_meta only carries a small
 * {width,height,capturedAt} reference so the owner/shared/status result
 * payloads stay small. The image is served separately by
 * app/api/v3/scan/screenshot/[id]/route.ts and
 * app/api/v3/shared/[token]/screenshot/route.ts, both of which read it back
 * through readScanScreenshot below.
 */

import { Buffer } from "node:buffer";
import {
  createBrowserSession,
  endBrowserSession,
  isBrowserBaseConfigured,
  openCdpPageSession,
  type CdpConnection,
} from "@/lib/browserbase/client";
import { validateScanTarget } from "@/lib/scanner/safe-fetch";
import {
  checkBrowserbaseQuota,
  recordBrowserbaseSeconds,
} from "@/lib/billing/browserbase-usage";
import {
  acquireConcurrencySlot,
  releaseConcurrencySlot,
} from "@/lib/browserbase/concurrency-queue";
import { getUserPlan } from "@/lib/rate-limiting/daily-limits";
import pool from "@/lib/database/db";
import { APP_NAME } from "@/lib/config/constants";
import {
  CONFIG_SCAN_SCREENSHOT_JPEG_QUALITY,
  CONFIG_SCAN_SCREENSHOT_MAX_BYTES,
  CONFIG_SCAN_SCREENSHOT_MAX_WAIT_MS,
  CONFIG_SCAN_SCREENSHOT_NAV_TIMEOUT_MS,
  CONFIG_SCAN_SCREENSHOT_SESSION_TIMEOUT_SECONDS,
  CONFIG_SCAN_SCREENSHOT_SETTLE_MS,
  CONFIG_SCAN_SCREENSHOT_VIEWPORT_HEIGHT,
  CONFIG_SCAN_SCREENSHOT_VIEWPORT_WIDTH,
} from "@/lib/config/config-values";

/** Small reference stored in scan_history.result_meta.screenshot. Signals a
 *  screenshot exists for the scan; the bytes live in scan_screenshots. */
export interface ScanScreenshotRef {
  width: number;
  height: number;
  capturedAt: string;
}

/** A captured frame, before it is persisted. */
interface CapturedImage {
  data: Buffer;
  contentType: string;
  width: number;
  height: number;
}

/**
 * The pure "should we even try" gate, factored out so the opt-in threading
 * is testable without a browser or a database. A capture is attempted only
 * when the user opted in AND the target is a real HTTP(S) web host -- a raw
 * IP or a non-HTTP protocol (ssh://, mongodb://, ...) has no page to render.
 */
export function shouldCaptureScreenshot(opts: {
  optedIn: boolean;
  protocolType: string;
  isRawIpTarget: boolean;
}): boolean {
  return (
    opts.optedIn && opts.protocolType === "http" && !opts.isRawIpTarget
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve `p`, or resolve `fallback` once `ms` elapses -- whichever is
 *  first. Used so a hung CDP command can never exceed the wall-clock bound. */
function withDeadline<T>(
  p: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => {
      const t = setTimeout(() => resolve(fallback), ms);
      t.unref?.();
    }),
  ]);
}

/**
 * Drive an already-open CDP page session to the target and grab one JPEG.
 * Returns null on any CDP hiccup, an aborted signal, or an empty/oversized
 * frame. Bounded by the caller's overall deadline as well as the per-step
 * nav timeout here.
 */
async function captureViaCdp(
  cdp: CdpConnection,
  targetUrl: string,
  signal?: AbortSignal,
): Promise<CapturedImage | null> {
  try {
    await cdp.send("Page.enable");
  } catch {
    return null;
  }

  let loadFired = false;
  cdp.on("Page.loadEventFired", () => {
    loadFired = true;
  });

  try {
    await cdp.send("Page.navigate", { url: targetUrl });
  } catch {
    return null;
  }

  const navDeadline = Date.now() + CONFIG_SCAN_SCREENSHOT_NAV_TIMEOUT_MS;
  while (!loadFired && Date.now() < navDeadline) {
    if (signal?.aborted) return null;
    await sleep(100);
  }

  // A short settle so a client-rendered page finishes painting; capped so a
  // page that never fires `load` still gets grabbed instead of waiting the
  // whole nav timeout for nothing.
  await sleep(CONFIG_SCAN_SCREENSHOT_SETTLE_MS);
  if (signal?.aborted) return null;

  let result: Record<string, unknown>;
  try {
    result = await cdp.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: CONFIG_SCAN_SCREENSHOT_JPEG_QUALITY,
    });
  } catch {
    return null;
  }

  const b64 = (result as { data?: unknown }).data;
  if (typeof b64 !== "string" || b64.length === 0) return null;

  const data = Buffer.from(b64, "base64");
  if (data.byteLength === 0 || data.byteLength > CONFIG_SCAN_SCREENSHOT_MAX_BYTES) {
    return null;
  }

  return {
    data,
    contentType: "image/jpeg",
    width: CONFIG_SCAN_SCREENSHOT_VIEWPORT_WIDTH,
    height: CONFIG_SCAN_SCREENSHOT_VIEWPORT_HEIGHT,
  };
}

/**
 * Capture one above-the-fold JPEG of `targetUrl` through a bounded, metered
 * BrowserBase session. Returns null (never throws) on missing config, an
 * exhausted quota, a full concurrency queue, an unsafe target, or any
 * capture failure/timeout. Consumes the browserbase-minutes meter for the
 * real session duration and always releases the concurrency slot it took.
 */
export async function capturePageScreenshot(
  targetUrl: string,
  opts: { userId: number; signal?: AbortSignal },
): Promise<CapturedImage | null> {
  // Missing config (self-hosted with no BrowserBase creds): skip before
  // touching the meter, the queue, or the network.
  if (!isBrowserBaseConfigured()) return null;

  // Re-validate the target so this is safe to call standalone (the scan
  // route already SSRF-checks, but this must not depend on that).
  try {
    const safety = await validateScanTarget(targetUrl);
    if (!safety.safe) return null;
  } catch {
    return null;
  }

  // Plan/meter gate: identical to a live viewer session's pre-create check.
  try {
    const quota = await checkBrowserbaseQuota(opts.userId);
    if (!quota.allowed) return null;
  } catch {
    return null;
  }

  // Paid plans jump the concurrency queue ahead of free, same rule the
  // interactive session route uses.
  let priority = false;
  try {
    priority = (await getUserPlan(opts.userId)) !== "free";
  } catch {
    /* default to non-priority */
  }

  let slot: { acquired: boolean } | null = null;
  try {
    slot = await acquireConcurrencySlot(priority);
  } catch {
    return null;
  }
  if (!slot?.acquired) return null;

  const startedAt = Date.now();
  let sessionId: string | null = null;
  try {
    const bb = await createBrowserSession({
      timeoutSeconds: CONFIG_SCAN_SCREENSHOT_SESSION_TIMEOUT_SECONDS,
      keepAlive: false,
      viewport: {
        width: CONFIG_SCAN_SCREENSHOT_VIEWPORT_WIDTH,
        height: CONFIG_SCAN_SCREENSHOT_VIEWPORT_HEIGHT,
      },
    });
    sessionId = bb.id || null;
    if (!bb.connectUrl) return null;

    const cdp = await openCdpPageSession(
      bb.connectUrl,
      CONFIG_SCAN_SCREENSHOT_NAV_TIMEOUT_MS,
    );
    if (!cdp) return null;

    try {
      return await withDeadline(
        captureViaCdp(cdp, targetUrl, opts.signal),
        CONFIG_SCAN_SCREENSHOT_MAX_WAIT_MS,
        null,
      );
    } finally {
      cdp.close();
    }
  } catch (err) {
    console.error(
      `[${APP_NAME}] page screenshot capture failed (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    if (sessionId) {
      await endBrowserSession(sessionId);
      // Charge the meter only when a real session was actually created --
      // a session that never came up (createBrowserSession threw) consumed
      // nothing on BrowserBase's side. Fire-and-forget: never blocks the
      // scan on a usage write.
      const elapsedSeconds = Math.max(
        1,
        Math.round((Date.now() - startedAt) / 1000),
      );
      recordBrowserbaseSeconds(opts.userId, elapsedSeconds).catch(() => {});
    }
    // Always release the slot taken above, on every path.
    releaseConcurrencySlot().catch(() => {});
  }
}

/**
 * Persist one captured frame for a scan (one row per scan; a re-capture
 * overwrites). Returns the small reference to store in result_meta, or null
 * if the write failed -- never throws.
 */
export async function storeScanScreenshot(
  scanId: number,
  img: CapturedImage,
): Promise<ScanScreenshotRef | null> {
  try {
    await pool.query(
      `INSERT INTO scan_screenshots
         (scan_id, image_data, content_type, width, height, captured_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (scan_id) DO UPDATE
         SET image_data = EXCLUDED.image_data,
             content_type = EXCLUDED.content_type,
             width = EXCLUDED.width,
             height = EXCLUDED.height,
             captured_at = NOW()`,
      [scanId, img.data, img.contentType, img.width, img.height],
    );
    return {
      width: img.width,
      height: img.height,
      capturedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(
      `[${APP_NAME}] failed to store scan screenshot (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Capture and store one screenshot for a scan, returning the reference to
 * fold into result_meta (or null). The single entry point the scan
 * executors call -- best-effort end to end, never throws.
 */
export async function captureAndStoreScreenshot(
  scanId: number,
  targetUrl: string,
  opts: { userId: number; signal?: AbortSignal },
): Promise<ScanScreenshotRef | null> {
  const img = await capturePageScreenshot(targetUrl, opts);
  if (!img) return null;
  return storeScanScreenshot(scanId, img);
}

/**
 * Read one scan's stored screenshot bytes for serving. Returns a plain
 * ArrayBuffer body (BYTEA comes back as a Node Buffer, copied into a
 * standalone ArrayBuffer so it is a valid response BodyInit) plus its
 * content type, or null when the scan has no screenshot. Used by the two
 * image-serving routes; lives here, not in a route file, because a Next.js
 * route module may only export request handlers.
 */
export async function readScanScreenshot(
  scanId: number,
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  try {
    const res = await pool.query<{
      image_data: Buffer;
      content_type: string | null;
    }>(
      `SELECT image_data, content_type FROM scan_screenshots WHERE scan_id = $1`,
      [scanId],
    );
    const row = res.rows[0];
    if (!row?.image_data) return null;
    const bytes = new Uint8Array(row.image_data.byteLength);
    bytes.set(row.image_data);
    return {
      data: bytes.buffer,
      contentType: row.content_type || "image/jpeg",
    };
  } catch (err) {
    console.error(
      `[${APP_NAME}] failed to read scan screenshot (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
