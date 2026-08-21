import {
  getBrowserSession,
  openCdpPageSession,
  type CdpConnection,
  type NetworkRequest,
} from "./client";

/**
 * Live network capture for the browser-session viewer.
 *
 * Browserbase's REST `GET /sessions/{id}/logs` is a POST-session recording
 * artifact: during a live session it returns little or nothing, which is why
 * the viewer's Network panel looked broken. This captures requests LIVE instead,
 * over a CDP connection (the same transport navigateBrowserSession uses): attach
 * to the page target, `Network.enable`, and buffer Network.* events as they fire.
 *
 * State lives in a module-level map because VulnRadar runs as one persistent
 * Node process (see lib/scanner/execute-scan.ts's reasoning). Everything fails
 * closed: if CDP is unavailable (Node < 22, no connectUrl, handshake timeout),
 * getLiveNetworkRequests returns [] -- the panel just shows "waiting", exactly
 * as before, and the viewer is never affected.
 *
 * NOTE: opening a second CDP connection alongside the live-view iframe, and the
 * exact Network event shape, should be verified against a live Browserbase
 * account -- it can't be exercised without one.
 */

const MAX_REQUESTS = 300;
// Bound in-flight requests too: one that never gets a response/failure event
// (hung, aborted, or a detached frame) would otherwise linger for the whole
// session. Oldest is evicted once this many are outstanding.
const MAX_PENDING = 300;
const IDLE_TTL_MS = 90_000;
const CDP_CONNECT_TIMEOUT_MS = 8_000;

interface Capture {
  conn: CdpConnection | null;
  /** In-flight requests keyed by CDP requestId, promoted to `completed` on response/failure. */
  pending: Map<string, NetworkRequest>;
  /** Requests that got a response or failed, in arrival order (bounded). */
  completed: NetworkRequest[];
  starting: Promise<void> | null;
  lastAccess: number;
}

const captures = new Map<string, Capture>();

function toHostPath(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      path: u.pathname + (u.search ? u.search.slice(0, 60) : "") || "/",
    };
  } catch {
    return { host: url.slice(0, 40), path: "/" };
  }
}

function bound(cap: Capture): void {
  if (cap.completed.length > MAX_REQUESTS) {
    cap.completed.splice(0, cap.completed.length - MAX_REQUESTS);
  }
}

async function startCapture(sessionId: string, cap: Capture): Promise<void> {
  const session = await getBrowserSession(sessionId).catch(() => null);
  const connectUrl = session?.connectUrl;
  if (!connectUrl) return;

  const conn = await openCdpPageSession(connectUrl, CDP_CONNECT_TIMEOUT_MS);
  if (!conn) return;
  cap.conn = conn;

  conn.on("Network.requestWillBeSent", (params) => {
    const requestId = params.requestId as string | undefined;
    const req = params.request as Record<string, unknown> | undefined;
    if (!requestId || !req) return;
    const url = (req.url as string) || "";
    if (!url.startsWith("http")) return; // skip data:, chrome-extension:, etc.
    const { host, path } = toHostPath(url);
    cap.pending.set(requestId, {
      requestId,
      url,
      method: ((req.method as string) || "GET").toUpperCase(),
      host,
      path,
      timestamp: params.timestamp as number | undefined,
    });
    // Evict the oldest still-in-flight request if the pending set is over cap.
    if (cap.pending.size > MAX_PENDING) {
      const oldest = cap.pending.keys().next().value;
      if (oldest !== undefined) cap.pending.delete(oldest);
    }
  });

  conn.on("Network.responseReceived", (params) => {
    const requestId = params.requestId as string | undefined;
    if (!requestId) return;
    const entry = cap.pending.get(requestId);
    const response = params.response as Record<string, unknown> | undefined;
    if (!entry || !response) return;
    entry.status = response.status as number | undefined;
    entry.mimeType = (response.mimeType as string | undefined)
      ?.split(";")[0]
      .trim();
    cap.pending.delete(requestId);
    cap.completed.push(entry);
    bound(cap);
  });

  conn.on("Network.loadingFailed", (params) => {
    const requestId = params.requestId as string | undefined;
    if (!requestId) return;
    const entry = cap.pending.get(requestId);
    if (!entry) return;
    entry.failed = true;
    entry.status = 0;
    cap.pending.delete(requestId);
    cap.completed.push(entry);
    bound(cap);
  });

  await conn.send("Network.enable").catch(() => {
    /* enable failed: handlers simply never fire, buffer stays empty */
  });
}

/**
 * Current captured requests for a session, starting the CDP capture on first
 * call. Returns completed requests plus still-in-flight ones, oldest first.
 * Never throws; returns [] when capture couldn't be established.
 */
export async function getLiveNetworkRequests(
  sessionId: string,
): Promise<NetworkRequest[]> {
  let cap = captures.get(sessionId);
  if (!cap) {
    cap = {
      conn: null,
      pending: new Map(),
      completed: [],
      starting: null,
      lastAccess: Date.now(),
    };
    captures.set(sessionId, cap);
    const capRef = cap;
    cap.starting = startCapture(sessionId, cap)
      .catch(() => {
        /* fail closed */
      })
      .finally(() => {
        capRef.starting = null;
      });
  }
  cap.lastAccess = Date.now();

  const merged = [...cap.completed, ...cap.pending.values()];
  merged.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  return merged.slice(-MAX_REQUESTS);
}

/** Close and forget a session's capture. Call when the session ends. */
export function stopLiveNetworkCapture(sessionId: string): void {
  const cap = captures.get(sessionId);
  if (!cap) return;
  try {
    cap.conn?.close();
  } catch {
    /* ignore */
  }
  captures.delete(sessionId);
}

// Reap captures whose viewer stopped polling (tab closed without an explicit
// end) so a CDP socket + buffer never leaks. unref so it never holds the
// process open on its own.
const reaper = setInterval(() => {
  const now = Date.now();
  for (const [id, cap] of captures) {
    if (now - cap.lastAccess > IDLE_TTL_MS) stopLiveNetworkCapture(id);
  }
}, IDLE_TTL_MS);
if (typeof reaper.unref === "function") reaper.unref();
