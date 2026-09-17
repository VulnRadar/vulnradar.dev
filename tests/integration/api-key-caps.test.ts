import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { generateApiKey, checkRateLimit } from "@/lib/api/api-keys";
import { API_KEY_SCOPES } from "@/lib/api/api-key-scopes";
import { describeIntegration, createUser } from "./_db";

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
    const CALLERS = 8;

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

    const LIMIT = 5;
    const CALLERS = 20;
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
});
