import type { NetworkRequest } from "@/lib/browserbase/client";

/**
 * What one read of a session's network log came to. The viewer turns each into
 * a state update, so the decisions (a 429 is silent, an unchanged payload is
 * not an update, a second tick while one is pending is not a request) live
 * here where they can be run without rendering the page.
 */
export type LogsOutcome =
  | { kind: "ok"; requests: NetworkRequest[] }
  | { kind: "rate-limited" }
  | { kind: "error"; message: string };

const NOT_AVAILABLE =
  "The network log for this session is not available right now.";
const UNREACHABLE =
  "Could not reach the server for this session's network log.";

export async function readLogs(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LogsOutcome> {
  try {
    const res = await fetchImpl(url);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // 429 = rate limited by Browserbase, back off silently, don't show an error.
      if (res.status === 429) return { kind: "rate-limited" };
      // The API's own error copy is written for people; a bare `HTTP 502` is
      // not, so it stays in the console and the panel gets a sentence instead.
      const apiError = (data as { error?: string } | null)?.error;
      console.error(
        "[network-panel] logs fetch failed:",
        apiError || `HTTP ${res.status}`,
      );
      return { kind: "error", message: apiError || NOT_AVAILABLE };
    }
    const requests =
      (data as { requests?: NetworkRequest[] } | null)?.requests || [];
    return { kind: "ok", requests };
  } catch (err) {
    console.error("[network-panel] logs fetch error:", err);
    return { kind: "error", message: UNREACHABLE };
  }
}

/**
 * Cheap identity for a log payload. Rows are appended, and a row in flight
 * gains its status in place when the response lands, without changing the
 * length or the last id: a page whose last requests are still loading would
 * freeze on "..." if those two were the whole signature. Counting the settled
 * rows catches that, and a pass over at most 300 rows costs nothing next to
 * re-rendering them.
 */
export function logsSignature(requests: NetworkRequest[]): string {
  let settled = 0;
  for (const r of requests) {
    if (r.status !== undefined || r.failed) settled++;
  }
  return `${requests.length}:${settled}:${requests[requests.length - 1]?.requestId ?? ""}`;
}

export interface LogsPollerHandlers {
  onRequests: (requests: NetworkRequest[]) => void;
  onError: (message: string | null) => void;
}

export interface LogsPoller {
  poll: () => Promise<void>;
  dispose: () => void;
}

/**
 * One poller per open dock. `poll` is safe to call from a timer: while a read
 * is pending a further call does nothing, so a slow upstream (or a tab that
 * was hidden and has just caught up) cannot stack requests against the
 * session's rate limit.
 */
export function createLogsPoller(
  read: () => Promise<LogsOutcome>,
  handlers: LogsPollerHandlers,
): LogsPoller {
  let inFlight = false;
  let disposed = false;
  let lastSignature: string | null = null;

  return {
    async poll() {
      if (inFlight || disposed) return;
      inFlight = true;
      try {
        const outcome = await read();
        if (disposed) return;
        if (outcome.kind === "rate-limited") return;
        if (outcome.kind === "error") {
          handlers.onError(outcome.message);
          return;
        }
        handlers.onError(null);
        if (outcome.requests.length === 0) return;
        const signature = logsSignature(outcome.requests);
        if (signature === lastSignature) return;
        lastSignature = signature;
        handlers.onRequests(outcome.requests);
      } finally {
        inFlight = false;
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
