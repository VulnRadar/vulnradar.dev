import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import {
  countRecentInFlightScans,
  createGracefulShutdown,
} from "@/lib/database/boot/graceful-shutdown";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

class FakeServer extends EventEmitter {
  closeIdleConnections = vi.fn();
  closeAllConnections = vi.fn();
  closed = deferred();
  close = vi.fn((done?: () => void) => {
    void (async () => {
      await this.closed.promise;
      done?.();
    })();
    return this;
  });
}

function setup(overrides: { count?: () => Promise<number> } = {}) {
  const order: string[] = [];
  const server = new FakeServer();
  const pool = {
    end: vi.fn(async () => {
      order.push("pool.end");
    }),
  };
  const exit = vi.fn((code: number) => {
    order.push(`exit ${code}`);
  });
  const shutdown = createGracefulShutdown({
    appName: "Test",
    stopWorkers: async () => {
      order.push("stopWorkers");
    },
    countInFlightScans: overrides.count ?? (async () => 0),
    pool,
    server: () => server,
    exit,
    drainBudgetMs: 2_000,
    pollMs: 1,
  });
  return { order, server, pool, exit, shutdown };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createGracefulShutdown", () => {
  it("keeps the pool open until the HTTP server has drained", async () => {
    const { order, server, pool, shutdown } = setup();
    const running = shutdown();

    await vi.waitFor(() => expect(server.close).toHaveBeenCalled());
    expect(pool.end).not.toHaveBeenCalled();

    server.closed.resolve();
    await running;
    expect(order).toEqual(["stopWorkers", "pool.end", "exit 0"]);
  });

  it("awaits the in-flight scans before ending the pool", async () => {
    const scans = deferred();
    let running = 1;
    void scans.promise.then(() => (running = 0));
    const { pool, exit, server, shutdown } = setup({
      count: async () => running,
    });
    server.closed.resolve();
    const done = shutdown();

    await new Promise((r) => setTimeout(r, 30));
    expect(pool.end).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    scans.resolve();
    await done;
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("stops waiting at the deadline and force-closes what is left", async () => {
    const order: string[] = [];
    const server = new FakeServer();
    const exit = vi.fn();
    const shutdown = createGracefulShutdown({
      appName: "Test",
      stopWorkers: async () => {},
      countInFlightScans: async () => 2,
      pool: { end: async () => void order.push("pool.end") },
      server: () => server,
      exit,
      drainBudgetMs: 40,
      pollMs: 1,
    });

    await shutdown();

    expect(server.closeAllConnections).toHaveBeenCalled();
    expect(order).toEqual(["pool.end"]);
    expect(exit).toHaveBeenCalledWith(0);
    expect(console.error).toHaveBeenCalled();
  });

  it("reaps idle keep-alive sockets while it drains", async () => {
    const { server, shutdown } = setup();
    const done = shutdown();
    await vi.waitFor(() =>
      expect(server.closeIdleConnections).toHaveBeenCalled(),
    );
    server.closed.resolve();
    await done;
  });

  it("keeps reaping for the whole drain, not once at the start", async () => {
    // close() only reaps the sockets idle at that moment. A keep-alive
    // connection whose response finishes during the drain goes idle later, and
    // without another pass it holds the server open until the deadline.
    const { server, shutdown } = setup();
    const done = shutdown();
    await vi.waitFor(() =>
      expect(server.closeIdleConnections.mock.calls.length).toBeGreaterThan(2),
    );
    server.closed.resolve();
    await done;
  });

  it("runs once however many signals arrive", async () => {
    const { server, pool, exit, shutdown } = setup();
    server.closed.resolve();
    await Promise.all([shutdown(), shutdown(), shutdown()]);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("still exits when a step fails", async () => {
    const exit = vi.fn();
    const shutdown = createGracefulShutdown({
      appName: "Test",
      stopWorkers: async () => {
        throw new Error("no timer");
      },
      countInFlightScans: async () => {
        throw new Error("database gone");
      },
      pool: {
        end: async () => {
          throw new Error("already ended");
        },
      },
      server: () => undefined,
      exit,
      drainBudgetMs: 40,
      pollMs: 1,
    });

    await shutdown();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("does not let a checked-out client hold the exit hostage", async () => {
    // pool.end() resolves only once every client is released, and a scan the
    // deadline gave up on may still be holding one.
    const exit = vi.fn();
    const shutdown = createGracefulShutdown({
      appName: "Test",
      stopWorkers: async () => {},
      countInFlightScans: async () => 0,
      pool: { end: () => new Promise<void>(() => {}) },
      server: () => undefined,
      exit,
      drainBudgetMs: 40,
      poolEndBudgetMs: 10,
      pollMs: 1,
    });

    await shutdown();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("works without an HTTP server, as under next start", async () => {
    const exit = vi.fn();
    const end = vi.fn(async () => {});
    const shutdown = createGracefulShutdown({
      appName: "Test",
      stopWorkers: async () => {},
      countInFlightScans: async () => 0,
      pool: { end },
      server: () => undefined,
      exit,
    });
    await shutdown();
    expect(end).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe("countRecentInFlightScans", () => {
  it("counts live rows inside the grace window and reads the count", async () => {
    const query = vi.fn(async () => ({ rows: [{ n: 3 }] }));
    await expect(
      countRecentInFlightScans({ query } as unknown as Pool, 1800),
    ).resolves.toBe(3);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/status IN \('pending', 'running'\)/);
    expect(params).toEqual(["1800"]);
  });
});
