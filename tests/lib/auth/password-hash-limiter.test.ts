import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { availableParallelism } from "node:os";

/**
 * Concurrency cap on scrypt in lib/auth/password-hash.ts.
 *
 * The real-cost behaviour of the hash lives in password-hash.test.ts, against
 * the real primitive. This file replaces scrypt with a fake that takes a few
 * milliseconds and counts how many calls are in flight at once, because the
 * thing under test is how many reach the threadpool together, not what they
 * compute. Everything else in the module runs for real.
 */

let inFlight = 0;
let peak = 0;
const started: string[] = [];

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    scrypt: (...args: unknown[]) => {
      // promisify appends the node-style callback after the supplied arguments.
      const done = args[args.length - 1] as (
        err: Error | null,
        key?: Buffer,
      ) => void;
      const password = args[0] as string;
      started.push(password);
      inFlight++;
      peak = Math.max(peak, inFlight);
      setTimeout(() => {
        inFlight--;
        if (password === "boom") done(new Error("scrypt failed"));
        else done(null, Buffer.alloc(64, 7));
      }, 15);
    },
  };
});

const DIGEST = "07".repeat(64); // what the fake derives, in hex
const SALT = "00112233445566778899aabbccddeeff";
const CURRENT = `131072:8:1:${SALT}:${DIGEST}`;
const LEGACY = `${SALT}:${DIGEST}`;

async function load(cores?: number) {
  vi.resetModules();
  if (cores !== undefined) {
    vi.doMock("node:os", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:os")>()),
      availableParallelism: () => cores,
    }));
  } else {
    vi.doUnmock("node:os");
  }
  return import("@/lib/auth/password-hash");
}

beforeEach(() => {
  inFlight = 0;
  peak = 0;
  started.length = 0;
});

afterEach(() => {
  vi.doUnmock("node:os");
});

describe("scrypt concurrency limit", () => {
  it("is min(2, available parallelism) on this machine", async () => {
    const { SCRYPT_MAX_CONCURRENT } = await load();
    expect(SCRYPT_MAX_CONCURRENT).toBe(Math.min(2, availableParallelism()));
  });

  it.each([
    [1, 1],
    [2, 2],
    [4, 2],
    [64, 2],
  ])("on %i core(s) allows %i at once", async (cores, expected) => {
    const { SCRYPT_MAX_CONCURRENT, hashPassword } = await load(cores);
    expect(SCRYPT_MAX_CONCURRENT).toBe(expected);

    await Promise.all(
      Array.from({ length: 8 }, (_, i) => hashPassword(`pw-${i}`)),
    );

    expect(peak).toBe(expected);
  });

  it("never lets 8 concurrent hashes exceed the limit, and finishes all of them", async () => {
    const { SCRYPT_MAX_CONCURRENT, hashPassword } = await load();

    const hashes = await Promise.all(
      Array.from({ length: 8 }, (_, i) => hashPassword(`pw-${i}`)),
    );

    expect(hashes).toHaveLength(8);
    expect(new Set(hashes).size).toBe(8);
    expect(peak).toBeLessThanOrEqual(SCRYPT_MAX_CONCURRENT);
    expect(started).toHaveLength(8);
  });

  it("covers verification too: current-format and legacy records share the one budget", async () => {
    const { SCRYPT_MAX_CONCURRENT, hashPassword, verifyPassword } =
      await load();

    const results = await Promise.all([
      hashPassword("a"),
      verifyPassword("b", CURRENT),
      verifyPassword("c", LEGACY),
      hashPassword("d"),
      verifyPassword("e", CURRENT),
      verifyPassword("f", LEGACY),
      verifyPassword("g", CURRENT),
      hashPassword("h"),
    ]);

    expect(results[1]).toBe(true);
    expect(results[2]).toBe(true);
    expect(started).toHaveLength(8);
    expect(peak).toBeLessThanOrEqual(SCRYPT_MAX_CONCURRENT);
  });

  it("serves waiting calls in the order they arrived", async () => {
    const { hashPassword } = await load(1);

    await Promise.all(["p1", "p2", "p3", "p4", "p5"].map(hashPassword));

    expect(started).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("frees the slot when scrypt fails, so the queue behind it still runs", async () => {
    const { hashPassword } = await load(1);

    const settled = await Promise.allSettled([
      hashPassword("boom"),
      hashPassword("after-1"),
      hashPassword("after-2"),
    ]);

    expect(settled.map((s) => s.status)).toEqual([
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect(inFlight).toBe(0);

    // And the limiter is back to empty: a later call starts immediately.
    await expect(hashPassword("later")).resolves.toEqual(expect.any(String));
    expect(peak).toBe(1);
  });

  it("does not make a malformed record wait for, or hold, a slot", async () => {
    const { hashPassword, verifyPassword } = await load(1);

    const slow = hashPassword("holds-the-only-slot");
    const malformed = verifyPassword("pw", "999999999:8:1:salt:abcd");

    const first = await Promise.race([
      slow.then(() => "hash"),
      malformed.then(() => "malformed"),
    ]);
    expect(first).toBe("malformed");
    await slow;
    expect(started).toEqual(["holds-the-only-slot"]);
  });
});
