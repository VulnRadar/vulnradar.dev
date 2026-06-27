/**
 * Browserbase client.
 *
 * Thin wrapper around the BrowserBase REST API
 * (https://api.browserbase.com). Used to launch ephemeral headless-browser
 * sessions from a scan result so the user can view the scanned site
 * without leaving VulnRadar.
 *
 * ── API contract (verified against docs.browserbase.com) ─────────────
 * POST   /v1/sessions                  create a session
 * GET    /v1/sessions/{id}            read session metadata
 * GET    /v1/sessions/{id}/debug      live viewer URLs
 * POST   /v1/sessions/{id}            end session (status: REQUEST_RELEASE)
 *
 * Create body shape:
 *   {
 *     projectId:         "...",
 *     timeout:           60..21600,        // seconds
 *     keepAlive:         boolean,
 *     proxies:           boolean | ProxyConfig[],
 *     region:            "us-west-2" | "us-east-1" | "eu-central-1" | "ap-southeast-1",
 *     browserSettings: {
 *       recordSession:    boolean (default true),
 *       logSession:       boolean (default true),
 *       blockAds:         boolean (default true),
 *       solveCaptchas:    boolean (Hobby+),
 *       viewport:         { width, height },
 *       os:               "windows" | "mac" | "linux" | "mobile" | "tablet",
 *       context:          { id, persist } | undefined,
 *       extensionId:      string | undefined,
 *     },
 *     userMetadata:      { ... },
 *   }
 *
 * The /debug endpoint does NOT echo the session id. It returns
 *   { debuggerFullscreenUrl, debuggerUrl, pages[], wsUrl }.
 * The iframe-embed URL is `debuggerFullscreenUrl` (or
 * `pages[0].debuggerFullscreenUrl` as a fallback).
 */

const BROWSERBASE_BASE_URL = "https://api.browserbase.com/v1";

export interface BrowserBaseSession {
  id: string;
  status: string;
  url: string;
  connectUrl?: string;
  debuggerUrl?: string;
  debuggerFullscreenUrl?: string;
  /** Iframe-embeddable viewer URL — preferred for the popup. */
  liveViewerUrl?: string;
  wsUrl?: string;
  region?: string;
  expiresAt?: string;
  raw?: Record<string, unknown>;
}

export class BrowserBaseError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BrowserBaseError";
    this.status = status;
  }
}

function isConfigured(): boolean {
  return !!(
    process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID
  );
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-BB-API-Key": process.env.BROWSERBASE_API_KEY || "",
  };
}

export interface CreateSessionOptions {
  timeoutSeconds?: number;
  region?: "us-west-2" | "us-east-1" | "eu-central-1" | "ap-southeast-1";
  keepAlive?: boolean;
  viewport?: { width: number; height: number };
}

export async function createBrowserSession(
  opts: CreateSessionOptions = {},
): Promise<BrowserBaseSession> {
  if (!isConfigured()) {
    throw new BrowserBaseError(
      "BrowserBase is not configured (set BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID).",
      503,
    );
  }
  const configuredMax = Number(
    process.env.BROWSERBASE_MAX_TTL_SECONDS || 300,
  );
  const maxTtl = Math.max(60, Math.min(configuredMax, 21600));
  const requested = Math.max(60, opts.timeoutSeconds ?? configuredMax);
  const timeout = Math.min(requested, maxTtl);

  const browserSettings: Record<string, unknown> = {
    recordSession: true,
    logSession: true,
    blockAds: true,
  };
  // Apply viewport so the remote browser renders at the right resolution.
  // Without this, BrowserBase defaults to a very large viewport that makes
  // everything appear tiny when the DevTools viewer is embedded in the popup.
  if (opts.viewport) {
    browserSettings.viewport = opts.viewport;
  }

  const payload: Record<string, unknown> = {
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    timeout,
    browserSettings,
  };
  if (opts.region) payload.region = opts.region;
  if (opts.keepAlive) payload.keepAlive = true;

  console.log(`[browserbase] create:start ${JSON.stringify({ opts })}`);
  const res = await fetch(`${BROWSERBASE_BASE_URL}/sessions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  console.log(`[browserbase] create:response:status ${JSON.stringify({ status: res.status })}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.log(`[browserbase] create:error:body ${JSON.stringify({ status: res.status, body: text.slice(0, 500) })}`);
    throw new BrowserBaseError(
      `BrowserBase create session failed (${res.status}): ${text || res.statusText}`,
      res.status,
    );
  }
  const raw = (await res.json()) as Record<string, unknown>;
  console.log(`[browserbase] create:response:body ${JSON.stringify({ id: raw.id, status: raw.status, region: raw.region, expiresAt: raw.expiresAt, hasConnectUrl: !!raw.connectUrl })}`);
  return normalizeSession(raw);
}

export async function getBrowserSession(id: string): Promise<BrowserBaseSession> {
  if (!isConfigured()) {
    throw new BrowserBaseError("BrowserBase is not configured.", 503);
  }
  const res = await fetch(
    `${BROWSERBASE_BASE_URL}/sessions/${encodeURIComponent(id)}`,
    { method: "GET", headers: authHeaders() },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BrowserBaseError(
      `BrowserBase read session failed (${res.status}): ${text || res.statusText}`,
      res.status,
    );
  }
  const raw = (await res.json()) as Record<string, unknown>;
  return normalizeSession(raw);
}

export async function getBrowserLiveUrls(
  id: string,
): Promise<BrowserBaseSession> {
  if (!isConfigured()) {
    throw new BrowserBaseError("BrowserBase is not configured.", 503);
  }
  const res = await fetch(
    `${BROWSERBASE_BASE_URL}/sessions/${encodeURIComponent(id)}/debug`,
    { method: "GET", headers: authHeaders() },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BrowserBaseError(
      `BrowserBase read live URLs failed (${res.status}): ${text || res.statusText}`,
      res.status,
    );
  }
  const raw = (await res.json()) as Record<string, unknown>;
  return normalizeSession(raw);
}

export async function endBrowserSession(id: string): Promise<void> {
  if (!isConfigured()) return;
  try {
    await fetch(
      `${BROWSERBASE_BASE_URL}/sessions/${encodeURIComponent(id)}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ status: "REQUEST_RELEASE" }),
      },
    );
  } catch {
    /* best-effort */
  }
}

function normalizeSession(raw: Record<string, unknown>): BrowserBaseSession {
  const id = String(raw.id ?? raw.sessionId ?? "");
  const status = String(raw.status ?? "UNKNOWN");
  const expiresAt = (raw.expiresAt as string | undefined) ?? undefined;
  const connectUrl =
    (raw.connectUrl as string | undefined) ??
    (raw.cdpUrl as string | undefined) ??
    undefined;

  // /debug returns debuggerFullscreenUrl at the top level OR under pages[0].
  // Mirror the reference project: check both.
  const pages = Array.isArray(raw.pages)
    ? (raw.pages as Array<Record<string, unknown>>)
    : [];
  const debuggerFullscreenUrl =
    (raw.debuggerFullscreenUrl as string | undefined) ??
    (pages[0]?.debuggerFullscreenUrl as string | undefined) ??
    undefined;
  const debuggerUrl =
    (raw.debuggerUrl as string | undefined) ??
    (pages[0]?.debuggerUrl as string | undefined) ??
    undefined;
  const wsUrl = (raw.wsUrl as string | undefined) ?? undefined;
  return {
    id,
    status,
    url: (raw.url as string | undefined) ?? "",
    connectUrl,
    debuggerUrl,
    debuggerFullscreenUrl,
    liveViewerUrl: debuggerFullscreenUrl,
    wsUrl: wsUrl || connectUrl,
    region: (raw.region as string | undefined) ?? undefined,
    expiresAt,
    raw,
  };
}

/**
 * Pick the iframe-embed URL. Per docs.browserbase.com:
 *   - `debuggerFullscreenUrl` is the full-screen (no borders) view.
 *   - `debuggerUrl` is the bordered view.
 * Returns the raw URL from the /debug response. We do NOT modify it
 * (no `?goto=`, no `&navbar=false`) because BrowserBase's DevTools
 * page is sensitive to URL parameters — the user manually navigates
 * inside the frame.
 */
export function pickLiveViewerUrl(
  live: Pick<BrowserBaseSession, "debuggerFullscreenUrl" | "debuggerUrl">,
): string | null {
  return live.debuggerFullscreenUrl ?? live.debuggerUrl ?? null;
}

export function isBrowserBaseConfigured(): boolean {
  return isConfigured();
}

/**
 * Navigate the remote BrowserBase session to a URL via the Chrome DevTools
 * Protocol (CDP) WebSocket. BrowserBase has no REST "startUrl" parameter — CDP
 * is the only way to control navigation after session creation.
 *
 * Requires Node.js 22+ for native WebSocket support. On Node 20 the function
 * returns immediately (no-op) because globalThis.WebSocket is unavailable.
 * All errors are swallowed — this is best-effort and must never block the caller.
 *
 * CDP sequence:
 *   1. Connect to the session-level CDP endpoint (connectUrl)
 *   2. Target.getTargets  → find the initial page target
 *   3. Target.attachToTarget (flatten=true) → get a session token
 *   4. Page.navigate with the session token → browser navigates
 */
export async function navigateBrowserSession(
  connectUrl: string,
  targetUrl: string,
): Promise<void> {
  type WsConstructor = new (url: string) => {
    onopen: ((ev: Event) => void) | null;
    onmessage: ((ev: MessageEvent) => void) | null;
    onerror: ((ev: Event) => void) | null;
    onclose: ((ev: CloseEvent) => void) | null;
    send: (data: string) => void;
    close: () => void;
  };
  const WS = (globalThis as Record<string, unknown>).WebSocket as
    WsConstructor | undefined;
  if (!WS) return; // Node 20 — native WebSocket not available

  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      try { ws.close(); } catch { /* ignore */ }
      resolve();
    };
    const watchdog = setTimeout(finish, 5000);

    const ws = new WS(connectUrl);
    let nextId = 0;
    const send = (
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string,
    ): number => {
      const id = ++nextId;
      const msg: Record<string, unknown> = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
      return id;
    };

    let getTargetsId = 0;
    let attachId = 0;
    let navId = 0;
    let cdpSession: string | undefined;

    ws.onopen = () => {
      getTargetsId = send("Target.getTargets");
    };

    ws.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          id?: number;
          result?: Record<string, unknown>;
        };
        if (msg.id === getTargetsId && msg.result) {
          const targets = (
            msg.result.targetInfos as Array<{ targetId: string; type: string }>
          ) ?? [];
          const page = targets.find((t) => t.type === "page");
          if (!page) { finish(); return; }
          attachId = send("Target.attachToTarget", {
            targetId: page.targetId,
            flatten: true,
          });
        } else if (msg.id === attachId && msg.result) {
          cdpSession = msg.result.sessionId as string;
          navId = send("Page.navigate", { url: targetUrl }, cdpSession);
        } else if (msg.id === navId) {
          finish();
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => finish();
    ws.onclose = () => finish();
  });
}
