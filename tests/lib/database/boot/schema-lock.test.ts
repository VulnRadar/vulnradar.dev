import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";
import {
  BOOT_SCHEMA_LOCK_ID,
  acquireBootSchemaLock,
  releaseBootSchemaLock,
} from "@/lib/database/boot/schema-lock";

/**
 * The boot advisory lock is what makes two processes booting against one
 * database take turns (tests-7). It has to be session-level on a connection
 * of its own: through pool.query the connection goes back to the pool at once
 * and the lock with it. These tests pin that shape and both failure paths;
 * the lock's real effect needs two real sessions and is not faked here.
 */

function fakePool(opts: { lockFails?: boolean; unlockFails?: boolean } = {}) {
  const client = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (opts.lockFails && sql.includes("pg_advisory_lock(")) {
        throw new Error("too many connections");
      }
      if (opts.unlockFails && sql.includes("pg_advisory_unlock")) {
        throw new Error("connection lost");
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(),
    connect: vi.fn(async () => client),
  } as unknown as Pool;
  return { pool, client };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("acquireBootSchemaLock", () => {
  it("takes the session lock on a dedicated client and keeps the client", async () => {
    const { pool, client } = fakePool();
    const lock = await acquireBootSchemaLock(pool, "App");
    expect(lock).toBe(client);
    expect(client.query).toHaveBeenCalledWith("SELECT pg_advisory_lock($1)", [
      BOOT_SCHEMA_LOCK_ID,
    ]);
    expect(client.release).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("gives the client back and boots without the lock when it cannot be taken", async () => {
    const { pool, client } = fakePool({ lockFails: true });
    expect(await acquireBootSchemaLock(pool, "App")).toBeNull();
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });

  it("boots without the lock when no connection can be had", async () => {
    const pool = {
      connect: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    } as unknown as Pool;
    expect(await acquireBootSchemaLock(pool, "App")).toBeNull();
  });
});

describe("releaseBootSchemaLock", () => {
  it("unlocks, then returns the client", async () => {
    const { pool, client } = fakePool();
    const lock = await acquireBootSchemaLock(pool, "App");
    await releaseBootSchemaLock(lock);
    expect(client.query).toHaveBeenLastCalledWith(
      "SELECT pg_advisory_unlock($1)",
      [BOOT_SCHEMA_LOCK_ID],
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("still returns the client when the unlock fails", async () => {
    const { pool, client } = fakePool({ unlockFails: true });
    const lock = await acquireBootSchemaLock(pool, "App");
    await expect(releaseBootSchemaLock(lock)).resolves.toBeUndefined();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a boot that never had the lock", async () => {
    await expect(releaseBootSchemaLock(null)).resolves.toBeUndefined();
  });
});
