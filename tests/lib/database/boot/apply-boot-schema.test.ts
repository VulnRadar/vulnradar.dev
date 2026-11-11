import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";

vi.mock("@/lib/database/db", () => ({
  default: { query: async () => ({ rows: [] }) },
}));

const {
  applyBootSchema,
  withBootClient,
  BOOT_LOCK_TIMEOUT,
  BOOT_QUERY_TIMEOUT_MS,
  BOOT_STATEMENT_TIMEOUT,
} = await import("@/lib/database/boot/apply-boot-schema");

/**
 * The boot schema and backfills run on a connection of their own (ops-10):
 * the app pool's 30 second statement timeout cancelled index builds and
 * backfills on a large table at every boot, and SET on a pooled connection
 * would leak a ten-minute timeout into whatever request used it next. A faked
 * pool shows which connection each statement went to and in what order; the
 * real timeouts are exercised in tests/integration/boot-schema.test.ts.
 */

type Config = { text: string; values?: unknown[]; query_timeout?: number };

function fakePool() {
  const sent: Config[] = [];
  const release = vi.fn();
  const clientQuery = vi.fn(async (config: Config) => {
    sent.push(config);
    return { rows: [] };
  });
  const poolQuery = vi.fn(async () => ({ rows: [] }));
  const pool = {
    query: poolQuery,
    connect: vi.fn(async () => ({ query: clientQuery, release })),
  } as unknown as Pool;
  return { pool, sent, release, poolQuery };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withBootClient", () => {
  it("sets both timeouts on its own connection before any work", async () => {
    const { pool, sent } = fakePool();
    await withBootClient(pool, async (executor) => {
      await executor.query("SELECT 1");
    });
    expect(sent.map((c) => c.text)).toEqual([
      `SET statement_timeout = '${BOOT_STATEMENT_TIMEOUT}'`,
      `SET lock_timeout = '${BOOT_LOCK_TIMEOUT}'`,
      "SELECT 1",
    ]);
    expect(BOOT_STATEMENT_TIMEOUT).toBe("10min");
    expect(BOOT_LOCK_TIMEOUT).toBe("5s");
  });

  it("lifts node-postgres's own client-side timeout past the server's", async () => {
    const { pool, sent } = fakePool();
    await withBootClient(pool, (executor) =>
      executor.query("SELECT $1::int", [1]),
    );
    for (const config of sent) {
      expect(config.query_timeout).toBe(BOOT_QUERY_TIMEOUT_MS);
    }
    expect(BOOT_QUERY_TIMEOUT_MS).toBeGreaterThan(10 * 60 * 1000);
    expect(sent.at(-1)?.values).toEqual([1]);
  });

  it("destroys the connection afterwards, so the timeouts never reach a request", async () => {
    const { pool, release } = fakePool();
    await withBootClient(pool, async () => {});
    expect(release).toHaveBeenCalledWith(true);
  });

  it("destroys it when the work throws, too", async () => {
    const { pool, release } = fakePool();
    await expect(
      withBootClient(pool, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(release).toHaveBeenCalledWith(true);
  });
});

describe("applyBootSchema", () => {
  it("runs the whole schema on the boot connection, none of it on the pool", async () => {
    const { pool, sent, poolQuery, release } = fakePool();
    await applyBootSchema(pool, "VulnRadar");
    expect(poolQuery).not.toHaveBeenCalled();
    expect(
      sent.some((c) => /CREATE TABLE IF NOT EXISTS users\b/.test(c.text)),
    ).toBe(true);
    expect(release).toHaveBeenCalledWith(true);
  });

  it("logs a failed warn step and keeps going", async () => {
    const { pool } = fakePool();
    const clientQuery = vi.fn(async (config: Config) => {
      if (config.text.includes("ADD COLUMN IF NOT EXISTS locale")) {
        throw new Error("permission denied");
      }
      return { rows: [] };
    });
    (pool.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      query: clientQuery,
      release: () => {},
    });
    await applyBootSchema(pool, "VulnRadar");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to add users.locale (non-fatal)"),
      "permission denied",
    );
  });
});
