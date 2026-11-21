import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";

/**
 * The per-address sign-in lock: the bucket key the login route fills and the
 * password reset empties, and the one combination that may pass a full
 * bucket (the right password from a device the account already trusts).
 */

const queries: { sql: string; params: unknown[] }[] = [];
// "<userId>:<sha256(cookie)>" for every unexpired device_trust row.
const trustedRows = new Set<string>();

vi.mock("@/lib/database/db", () => ({
  default: {
    query: async (sql: string, params: unknown[] = []) => {
      const s = sql.trim();
      queries.push({ sql: s, params });
      if (s.startsWith("SELECT 1 FROM device_trust")) {
        return trustedRows.has(`${params[0]}:${params[1]}`)
          ? { rows: [{ "?column?": 1 }] }
          : { rows: [] };
      }
      return { rows: [] };
    },
  },
}));

const { loginLockKey, passesAccountLock } =
  await import("@/lib/auth/login-lock");
const { hashDeviceFingerprint } = await import("@/lib/auth/device-trust");

const deviceLookups = () =>
  queries.filter((q) => q.sql.startsWith("SELECT 1 FROM device_trust"));

beforeEach(() => {
  queries.length = 0;
  trustedRows.clear();
});

describe("loginLockKey", () => {
  it("is the sha256 of the lower-cased, trimmed address under login-fail:", () => {
    expect(loginLockKey("  Owner@Example.COM ")).toBe(
      `login-fail:${createHash("sha256").update("owner@example.com").digest("hex")}`,
    );
  });

  it("is the same bucket however the address is typed", () => {
    expect(loginLockKey("owner@example.com")).toBe(
      loginLockKey("OWNER@example.com "),
    );
  });

  it("never carries the address itself", () => {
    const key = loginLockKey("owner@example.com");
    expect(key).not.toContain("owner");
    expect(key).not.toContain("example");
    expect(key).toMatch(/^login-fail:[0-9a-f]{64}$/);
  });
});

describe("passesAccountLock", () => {
  const cookie = randomBytes(32).toString("hex");

  beforeEach(() => {
    trustedRows.add(`7:${hashDeviceFingerprint(cookie)}`);
  });

  it("passes the right password from a device this account trusts", async () => {
    expect(
      await passesAccountLock({
        userId: 7,
        passwordValid: true,
        deviceCookie: cookie,
      }),
    ).toBe(true);
  });

  it("refuses the right password with no device cookie", async () => {
    expect(
      await passesAccountLock({
        userId: 7,
        passwordValid: true,
        deviceCookie: undefined,
      }),
    ).toBe(false);
  });

  it("refuses the right password with a device another account trusts", async () => {
    expect(
      await passesAccountLock({
        userId: 8,
        passwordValid: true,
        deviceCookie: cookie,
      }),
    ).toBe(false);
  });

  it("refuses a device whose trust was revoked", async () => {
    trustedRows.clear();
    expect(
      await passesAccountLock({
        userId: 7,
        passwordValid: true,
        deviceCookie: cookie,
      }),
    ).toBe(false);
  });

  it("refuses a trusted device with the wrong password", async () => {
    expect(
      await passesAccountLock({
        userId: 7,
        passwordValid: false,
        deviceCookie: cookie,
      }),
    ).toBe(false);
  });

  it("refuses an address with no account", async () => {
    expect(
      await passesAccountLock({
        userId: null,
        passwordValid: false,
        deviceCookie: cookie,
      }),
    ).toBe(false);
  });

  // Looking the device up only after a correct password would make a locked
  // address answer a right guess one query slower than a wrong one, which is
  // the brute force the lock is there to stop, just timed instead of read.
  it("looks the device up whatever the password was, when a cookie is sent", async () => {
    for (const passwordValid of [true, false]) {
      queries.length = 0;
      await passesAccountLock({
        userId: 7,
        passwordValid,
        deviceCookie: cookie,
      });
      expect(deviceLookups()).toHaveLength(1);
    }
    queries.length = 0;
    await passesAccountLock({
      userId: null,
      passwordValid: false,
      deviceCookie: cookie,
    });
    expect(deviceLookups()).toHaveLength(1);
  });

  it("makes no lookup at all without a cookie", async () => {
    await passesAccountLock({
      userId: 7,
      passwordValid: true,
      deviceCookie: undefined,
    });
    expect(deviceLookups()).toHaveLength(0);
  });
});
