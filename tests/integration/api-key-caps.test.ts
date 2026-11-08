import { it, expect, vi, afterEach } from "vitest";
import pool from "@/lib/database/db";
import {
  generateApiKey,
  checkRateLimit,
  peekRateLimit,
  rotateApiKey,
  validateApiKey,
} from "@/lib/api/api-keys";
import { API_KEY_SCOPES } from "@/lib/api/api-key-scopes";
import { CONFIG_DB_POOL_MAX } from "@/lib/config/config-values";
import {
  describeIntegration,
  createUser,
  setSettings,
  clearSettings,
} from "./_db";

// A request scope is what these two read, and there is none in a test. The
// database stays real; the binding check is what is being exercised.
let clientIp = "203.0.113.10";
vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return {
    ...actual,
    getClientIp: async () => clientIp,
    getUserAgent: async () => "integration-test",
  };
});

vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => {}),
}));

/**
 * The two API-key caps, run concurrently against a real PostgreSQL.
 *
 * Both are guarded by database behaviour a mocked pool cannot express. The
 * unit suite for this module fakes `pool.query` outright, so it can prove
 * which SQL string was sent and nothing at all about whether two callers
 * arriving together can both get past the gate: a dropped lock returns the
 * same green tick as a held one.
 *
 * Every case creates its own throwaway account, so nothing here counts rows
 * another suite in this shared database may have written.
 */
describeIntegration("API key caps, under real contention", () => {
  it("never leaves an account holding more keys than its plan cap", async () => {
    const user = await createUser();
    const CAP = 3;
    const CALLERS = 6;

    const created = await Promise.all(
      Array.from({ length: CALLERS }, (_unused, i) =>
        generateApiKey(
          user.id,
          `race-${i}`,
          100,
          [API_KEY_SCOPES.SCAN_READ],
          CAP,
        ),
      ),
    );

    // Returned rows and stored rows, because a create that reported a refusal
    // while still inserting is the failure this guard exists to prevent, and
    // it is invisible from the return values alone.
    expect(created.filter(Boolean)).toHaveLength(CAP);

    const { rows } = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM api_keys
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    expect(rows[0]?.count).toBe(CAP);
  });

  it("counts only live keys, so revoking one frees a slot", async () => {
    const user = await createUser();
    const first = await generateApiKey(
      user.id,
      "first",
      100,
      [API_KEY_SCOPES.SCAN_READ],
      1,
    );
    expect(first).not.toBeNull();

    // At the cap: refused rather than thrown, which is what lets the route
    // answer with its own plan-limit message.
    expect(
      await generateApiKey(
        user.id,
        "second",
        100,
        [API_KEY_SCOPES.SCAN_READ],
        1,
      ),
    ).toBeNull();

    await pool.query("UPDATE api_keys SET revoked_at = NOW() WHERE id = $1", [
      first!.id,
    ]);

    expect(
      await generateApiKey(
        user.id,
        "third",
        100,
        [API_KEY_SCOPES.SCAN_READ],
        1,
      ),
    ).not.toBeNull();
  });

  it("never records more API requests than the key's daily limit", async () => {
    const user = await createUser();
    const key = await generateApiKey(
      user.id,
      "usage",
      5,
      [API_KEY_SCOPES.SCAN_READ],
      null,
    );
    expect(key).not.toBeNull();

    const LIMIT = 3;
    const CALLERS = 6;
    const results = await Promise.all(
      Array.from({ length: CALLERS }, () => checkRateLimit(key!.id, LIMIT)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(LIMIT);

    // api_usage is what the next request counts, so an allowed call that did
    // not insert, or a refused one that did, both break the cap for the rest
    // of the day even though the return values looked right.
    const { rows } = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM api_usage
        WHERE api_key_id = $1 AND used_at > NOW() - INTERVAL '24 hours'`,
      [key!.id],
    );
    expect(rows[0]?.count).toBe(LIMIT);
  });

  it("meters more concurrent callers than the pool has connections", async () => {
    // Each caller holds a client for its whole transaction. If any of them
    // needs a second connection before releasing the first, every client ends
    // up held by a caller waiting for one and this fails on a connect timeout.
    const user = await createUser();
    const key = await generateApiKey(
      user.id,
      "fan-out",
      5,
      [API_KEY_SCOPES.SCAN_READ],
      null,
    );
    const LIMIT = 4;
    const CALLERS = CONFIG_DB_POOL_MAX * 3;

    const results = await Promise.all(
      Array.from({ length: CALLERS }, () => checkRateLimit(key!.id, LIMIT)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(LIMIT);
    expect(
      results
        .filter((r) => r.allowed)
        .map((r) => r.used)
        .sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4]);
    for (const refused of results.filter((r) => !r.allowed)) {
      expect(refused.used).toBe(LIMIT);
      expect(refused.remaining).toBe(0);
    }

    const { rows } = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM api_usage WHERE api_key_id = $1",
      [key!.id],
    );
    expect(rows[0]?.count).toBe(LIMIT);
  });

  it("resets 24 hours after the oldest request still in the window", async () => {
    const user = await createUser();
    const key = await generateApiKey(
      user.id,
      "window",
      5,
      [API_KEY_SCOPES.SCAN_READ],
      null,
    );
    const { rows: seeded } = await pool.query<{ used_at: Date }>(
      `INSERT INTO api_usage (api_key_id, used_at)
       VALUES ($1, NOW() - INTERVAL '30 hours'),
              ($1, NOW() - INTERVAL '10 hours'),
              ($1, NOW() - INTERVAL '2 hours')
       RETURNING used_at`,
      [key!.id],
    );
    const oldestInWindow = seeded[1].used_at.getTime();
    const expected = new Date(oldestInWindow + 86_400_000).toISOString();

    // The row from 30 hours ago is outside the window: not counted, and not
    // the row the reset time comes from.
    const allowed = await checkRateLimit(key!.id, 3);
    expect(allowed).toMatchObject({ allowed: true, used: 3, remaining: 0 });
    expect(allowed.resetsAt).toBe(expected);

    const refused = await checkRateLimit(key!.id, 3);
    expect(refused).toMatchObject({ allowed: false, used: 3, remaining: 0 });
    expect(refused.resetsAt).toBe(expected);

    const peeked = await peekRateLimit(key!.id, 3);
    expect(peeked).toMatchObject({ allowed: false, used: 3, remaining: 0 });
    expect(peeked.resetsAt).toBe(expected);
  });

  it("takes the reset time from its own row on a key's first request", async () => {
    const user = await createUser();
    const key = await generateApiKey(
      user.id,
      "first-use",
      5,
      [API_KEY_SCOPES.SCAN_READ],
      null,
    );

    const result = await checkRateLimit(key!.id, 3);

    const { rows } = await pool.query<{ used_at: Date }>(
      "SELECT used_at FROM api_usage WHERE api_key_id = $1",
      [key!.id],
    );
    expect(rows).toHaveLength(1);
    expect(result.resetsAt).toBe(
      new Date(rows[0].used_at.getTime() + 86_400_000).toISOString(),
    );
  });

  it("stamps last_used_at on an allowed request and on a refused one", async () => {
    const user = await createUser();
    const key = await generateApiKey(
      user.id,
      "stamp",
      5,
      [API_KEY_SCOPES.SCAN_READ],
      null,
    );
    const readStamp = async () => {
      const { rows } = await pool.query<{ last_used_at: Date | null }>(
        "SELECT last_used_at FROM api_keys WHERE id = $1",
        [key!.id],
      );
      return rows[0]?.last_used_at ?? null;
    };

    await checkRateLimit(key!.id, 1);
    expect(await readStamp()).not.toBeNull();

    await pool.query("UPDATE api_keys SET last_used_at = NULL WHERE id = $1", [
      key!.id,
    ]);
    const refused = await checkRateLimit(key!.id, 1);
    expect(refused.allowed).toBe(false);
    expect(await readStamp()).not.toBeNull();
  });

  it("refuses a key that no longer exists rather than throwing", async () => {
    const result = await checkRateLimit(2_147_483_000, 5);
    expect(result).toMatchObject({ allowed: false, used: 0, remaining: 0 });
  });
});

describeIntegration("API key rotation and IP binding", () => {
  afterEach(async () => {
    await clearSettings();
  });

  const boundIpOf = async (keyId: number) => {
    const { rows } = await pool.query<{ bound_ip: string | null }>(
      "SELECT bound_ip FROM api_keys WHERE id = $1",
      [keyId],
    );
    return rows[0]?.bound_ip ?? null;
  };

  it("lets a rotated key be used from a new subnet, and binds it there", async () => {
    await setSettings({ API_KEY_IP_BINDING_ENABLED: true });
    const user = await createUser();
    const key = await generateApiKey(
      user.id,
      "bound",
      100,
      [API_KEY_SCOPES.SCAN_READ],
      null,
    );

    // First use adopts this network.
    clientIp = "203.0.113.10";
    expect((await validateApiKey(key!.raw_key))?.keyId).toBe(key!.id);
    expect(await boundIpOf(key!.id)).toBe("203.0.113.10");

    // The move that locks it out.
    clientIp = "198.51.100.20";
    expect(await validateApiKey(key!.raw_key)).toBeNull();

    const rotated = await rotateApiKey(key!.id, user.id);
    expect(rotated?.id).toBe(key!.id);
    expect(await boundIpOf(key!.id)).toBeNull();

    // The new secret works from where the owner is now, and only there.
    expect((await validateApiKey(rotated!.raw_key))?.keyId).toBe(key!.id);
    expect(await boundIpOf(key!.id)).toBe("198.51.100.20");

    clientIp = "203.0.113.10";
    expect(await validateApiKey(rotated!.raw_key)).toBeNull();

    // The old secret is dead from anywhere, including the network it adopted.
    expect(await validateApiKey(key!.raw_key)).toBeNull();
  });

  it("does not clear another account's binding", async () => {
    await setSettings({ API_KEY_IP_BINDING_ENABLED: true });
    const owner = await createUser();
    const stranger = await createUser();
    const key = await generateApiKey(
      owner.id,
      "theirs",
      100,
      [API_KEY_SCOPES.SCAN_READ],
      null,
    );
    clientIp = "203.0.113.10";
    await validateApiKey(key!.raw_key);

    expect(await rotateApiKey(key!.id, stranger.id)).toBeNull();
    expect(await boundIpOf(key!.id)).toBe("203.0.113.10");
  });
});
