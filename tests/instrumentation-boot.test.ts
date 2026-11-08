import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The order register() runs its phases in, which is the only thing
 * instrumentation.ts still owns. Every phase is a mock that records itself.
 */

const h = vi.hoisted(() => {
  const order: string[] = [];
  const step =
    (name: string, value?: unknown) =>
    async (..._args: unknown[]) => {
      order.push(name);
      return value;
    };
  return {
    order,
    step,
    poolEnd: vi.fn(async () => {
      order.push("pool.end");
    }),
    createGracefulShutdown: vi.fn(),
  };
});

vi.mock("@/lib/config/env", () => ({ validateEnv: vi.fn() }));
vi.mock("@/lib/database/db", () => ({
  default: { end: h.poolEnd, query: vi.fn(async () => ({ rows: [{ n: 0 }] })) },
}));
vi.mock("@/lib/database/error-log-capture", () => ({
  installErrorLogCapture: vi.fn(),
}));
vi.mock("@/lib/database/boot/schema-version", () => ({
  ensureSchemaVersion: h.step("ensureSchemaVersion"),
}));
vi.mock("@/lib/database/boot/release-check", () => ({
  reportRunningVersion: h.step("reportRunningVersion"),
}));
vi.mock("@/lib/database/boot/schema-lock", () => ({
  acquireBootSchemaLock: h.step("acquireLock", { fake: "lock" }),
  releaseBootSchemaLock: h.step("releaseLock"),
}));
vi.mock("@/lib/database/boot/apply-boot-schema", () => ({
  applyBootSchema: h.step("applyBootSchema"),
}));
vi.mock("@/lib/database/boot/backfills", () => ({
  runBootBackfills: h.step("runBootBackfills"),
}));
vi.mock("@/lib/database/boot/workers", () => ({
  runInitialCleanup: h.step("runInitialCleanup"),
  startBackgroundWorkers: h.step("startBackgroundWorkers"),
  stopBackgroundWorkers: h.step("stopBackgroundWorkers"),
}));
vi.mock("@/lib/database/boot/safety-nets", () => ({
  runBootSafetyNets: h.step("runBootSafetyNets"),
}));
vi.mock("@/lib/database/boot/app-url-drift", () => ({
  reportAppUrlDrift: h.step("reportAppUrlDrift"),
}));
vi.mock("@/lib/scanner/scan-jobs", () => ({
  staleScanGraceSeconds: vi.fn(async () => 1800),
}));
vi.mock("@/lib/admin/alert-webhook", () => ({ sendAdminAlert: vi.fn() }));

const { register } = await import("@/instrumentation");

const ENV_KEYS = [
  "NEXT_RUNTIME",
  "DATABASE_URL",
  "NEXT_MANUAL_SIG_HANDLE",
  "HOST_BIND",
  "ALLOW_INSECURE_HTTP",
  "TRUSTED_PROXY_CIDR",
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

let added: Array<[string | symbol, (...args: unknown[]) => void]>;

beforeEach(() => {
  h.order.length = 0;
  h.poolEnd.mockClear();
  added = [];
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.NEXT_RUNTIME = "nodejs";
  process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process, "on").mockImplementation(((
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ) => {
    added.push([event, listener]);
    return process;
  }) as typeof process.on);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("register()", () => {
  it("takes the boot lock before the version gate creates the meta table", async () => {
    // Two first boots on an empty database both ran CREATE TABLE IF NOT
    // EXISTS on the meta table outside the lock, and that statement is not
    // atomic, so one of them crashed on pg_type's unique index.
    await register();
    expect(h.order.indexOf("acquireLock")).toBeGreaterThanOrEqual(0);
    expect(h.order.indexOf("acquireLock")).toBeLessThan(
      h.order.indexOf("ensureSchemaVersion"),
    );
  });

  it("does not hold the lock across the release check's network call", async () => {
    await register();
    expect(h.order.indexOf("reportRunningVersion")).toBeLessThan(
      h.order.indexOf("acquireLock"),
    );
  });

  it("releases the lock after the last phase", async () => {
    await register();
    expect(h.order.at(-1)).toBe("releaseLock");
  });

  it("arms the workers before the first cleanup pass", async () => {
    await register();
    expect(h.order.indexOf("startBackgroundWorkers")).toBeLessThan(
      h.order.indexOf("runInitialCleanup"),
    );
  });

  it("compares the build-time URL once the settings table exists", async () => {
    await register();
    expect(h.order).toContain("reportAppUrlDrift");
    expect(h.order.indexOf("applyBootSchema")).toBeLessThan(
      h.order.indexOf("reportAppUrlDrift"),
    );
  });

  describe("signal handling", () => {
    it("leaves signals to Next unless told otherwise, and never ends the pool early", async () => {
      // Without NEXT_MANUAL_SIG_HANDLE Next drains the server and exits by
      // itself. A handler here would close the pool underneath that drain.
      await register();
      expect(added.map(([event]) => event)).not.toContain("SIGTERM");
      expect(h.poolEnd).not.toHaveBeenCalled();
    });

    it("owns SIGTERM and SIGINT with NEXT_MANUAL_SIG_HANDLE=1", async () => {
      process.env.NEXT_MANUAL_SIG_HANDLE = "1";
      await register();
      const events = added.map(([event]) => event);
      expect(events).toContain("SIGTERM");
      expect(events).toContain("SIGINT");
    });

    it("stops the workers before it ends the pool", async () => {
      process.env.NEXT_MANUAL_SIG_HANDLE = "1";
      const exit = vi
        .spyOn(process, "exit")
        .mockImplementation(
          (() => undefined) as unknown as typeof process.exit,
        );
      await register();

      const handler = added.find(([event]) => event === "SIGTERM")![1];
      handler();
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

      expect(h.order.indexOf("stopBackgroundWorkers")).toBeLessThan(
        h.order.indexOf("pool.end"),
      );
    });
  });

  describe("the trusted-proxy warning", () => {
    const warned = () =>
      vi
        .mocked(console.error)
        .mock.calls.some((c) => /TRUSTED_PROXY_CIDR/.test(String(c[0])));

    it("is logged when the port is published with no proxy named", async () => {
      process.env.HOST_BIND = "0.0.0.0";
      await register();
      expect(warned()).toBe(true);
    });

    it("is logged for plain HTTP with no proxy named", async () => {
      process.env.ALLOW_INSECURE_HTTP = "1";
      await register();
      expect(warned()).toBe(true);
    });

    it("is not logged once a proxy is named", async () => {
      process.env.HOST_BIND = "0.0.0.0";
      process.env.TRUSTED_PROXY_CIDR = "10.0.0.0/8";
      await register();
      expect(warned()).toBe(false);
    });
  });
});
