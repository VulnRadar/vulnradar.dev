/**
 * What happens between SIGTERM and exit.
 *
 * This used to be `pool.end()` and nothing else, running alongside Next's own
 * handler, so every deploy closed the database while requests were still
 * draining: each one failed on its next query, and running scans were cut. The
 * order is the fix. Timers stop first so no new work starts, the server stops
 * accepting and finishes what it has, background scans get to write their
 * results, and only then does the pool close.
 *
 * Only relative, type-only and .mjs imports, so the shutdown test can run this
 * file under bare node with a real signal.
 */
import type { Pool } from "pg";
import { HTTP_SERVER_SLOT } from "../../server/http-front.mjs";

/**
 * Everything before the pool closes shares this. The compose stop_grace_period
 * is 40s, which leaves room for POOL_END_BUDGET_MS and for the exit itself
 * before Docker sends SIGKILL.
 */
const DRAIN_BUDGET_MS = 30_000;
const POOL_END_BUDGET_MS = 5_000;
const POLL_MS = 250;

interface DrainableServer {
  close: (done?: () => void) => unknown;
  closeIdleConnections: () => void;
  closeAllConnections: () => void;
}

export interface GracefulShutdownOptions {
  appName: string;
  stopWorkers: () => Promise<void>;
  countInFlightScans: () => Promise<number>;
  pool: { end: () => Promise<void> };
  /** Defaults to the server server.mjs registered; `next start` has none. */
  server?: () => DrainableServer | undefined;
  exit?: (code: number) => void;
  drainBudgetMs?: number;
  poolEndBudgetMs?: number;
  pollMs?: number;
}

function registeredServer(): DrainableServer | undefined {
  return (globalThis as Record<symbol, unknown>)[HTTP_SERVER_SLOT] as
    DrainableServer | undefined;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolves when every connection has finished, or at the deadline with the
 * stragglers cut. close() alone only reaps the sockets idle at the moment it
 * is called, so a keep-alive connection whose response finishes during the
 * drain would hold the server open until its own timeout; hence the poll.
 */
function drainHttpServer(
  server: DrainableServer,
  deadline: number,
  pollMs: number,
  appName: string,
): Promise<void> {
  return new Promise((resolve) => {
    let reap: NodeJS.Timeout | undefined = undefined;
    let cutoff: NodeJS.Timeout | undefined = undefined;
    const finish = () => {
      clearInterval(reap);
      clearTimeout(cutoff);
      resolve();
    };
    reap = setInterval(() => server.closeIdleConnections(), pollMs);
    cutoff = setTimeout(
      () => {
        console.error(
          `[${appName}] Shutdown: requests were still running at the deadline and were cut off.`,
        );
        server.closeAllConnections();
        finish();
      },
      Math.max(deadline - Date.now(), 0),
    );
    server.close(() => finish());
    server.closeIdleConnections();
  });
}

async function waitForScans(
  count: () => Promise<number>,
  deadline: number,
  pollMs: number,
  appName: string,
): Promise<void> {
  try {
    let running = await count();
    while (running > 0 && Date.now() < deadline) {
      await sleep(pollMs);
      running = await count();
    }
    if (running > 0) {
      console.error(
        `[${appName}] Shutdown: ${running} scan(s) still running at the deadline. The next boot's sweep closes them.`,
      );
    }
  } catch (err) {
    console.error(
      `[${appName}] Shutdown: could not check for running scans:`,
      err,
    );
  }
}

/**
 * The handler to give process.on. It runs once however many signals arrive,
 * and it always ends in exit(0): a step that fails is logged and skipped,
 * because nothing after a SIGTERM is improved by staying up.
 */
export function createGracefulShutdown({
  appName,
  stopWorkers,
  countInFlightScans,
  pool,
  server = registeredServer,
  exit = (code) => process.exit(code),
  drainBudgetMs = DRAIN_BUDGET_MS,
  poolEndBudgetMs = POOL_END_BUDGET_MS,
  pollMs = POLL_MS,
}: GracefulShutdownOptions): () => Promise<void> {
  let running: Promise<void> | undefined;

  const run = async () => {
    const deadline = Date.now() + drainBudgetMs;

    try {
      await stopWorkers();
    } catch (err) {
      console.error(`[${appName}] Shutdown: stopping workers failed:`, err);
    }

    const http = server();
    if (http) await drainHttpServer(http, deadline, pollMs, appName);

    await waitForScans(countInFlightScans, deadline, pollMs, appName);

    // pool.end() resolves only when every client is back, and a scan the
    // deadline gave up on may never return its one.
    try {
      await Promise.race([pool.end(), sleep(poolEndBudgetMs)]);
    } catch (err) {
      console.error(`[${appName}] Error closing database pool:`, err);
    }

    exit(0);
  };

  return () => (running ??= run());
}

/**
 * Scans are dispatched fire-and-forget, so server.close() cannot see them, and
 * there is no in-process list of them to ask. Their rows are the record the
 * concurrency limiter already counts. The age guard is the stale-sweep's: an
 * older row belongs to a process that is long gone and would otherwise cost
 * every deploy the full budget.
 */
export async function countRecentInFlightScans(
  pool: Pick<Pool, "query">,
  graceSeconds: number,
): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM scan_history
      WHERE status IN ('pending', 'running')
        AND COALESCE(started_at, scanned_at, TIMESTAMP 'epoch')
              >= NOW() - ($1 || ' seconds')::interval`,
    [String(graceSeconds)],
  );
  return result.rows[0]?.n ?? 0;
}
