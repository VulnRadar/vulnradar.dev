import { it, expect, vi, afterEach } from "vitest";
import pool from "@/lib/database/db";
import { checkRateLimit } from "@/lib/rate-limiting/rate-limit";
import { describeIntegration, unique } from "./_db";

/**
 * checkRateLimit's guarded upsert, evaluated by Postgres.
 *
 * The unit tier can only say which statement ran and what a fake returned. The
 * two claims that matter are about the real ON CONFLICT: that the WHERE on the
 * DO UPDATE is re-checked against the locked row, so concurrent attempts
 * cannot overshoot, and that a refused attempt writes nothing and returns no
 * row. A faked pool answers both whatever the SQL says.
 */

const WINDOW_SECONDS = 3600;

function currentBucket(windowSeconds = WINDOW_SECONDS): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(Date.now() / windowMs) * windowMs);
}

async function rowsFor(key: string) {
  const { rows } = await pool.query<{ count: number; window_start: Date }>(
    `SELECT "count", window_start FROM rate_limits
      WHERE key = $1 ORDER BY window_start`,
    [key],
  );
  return rows;
}

async function seed(key: string, count: number, windowStart: Date) {
  await pool.query(
    `INSERT INTO rate_limits (key, "count", window_start) VALUES ($1, $2, $3)`,
    [key, count, windowStart],
  );
}

function attempt(key: string, maxAttempts: number) {
  return checkRateLimit({ key, maxAttempts, windowSeconds: WINDOW_SECONDS });
}

afterEach(() => {
  vi.useRealTimers();
});

describeIntegration("checkRateLimit against the real table", () => {
  it("allows exactly the cap across concurrent attempts and never overshoots", async () => {
    const key = unique("rl-concurrent");
    const results = await Promise.all(
      Array.from({ length: 25 }, () => attempt(key, 5)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.filter((r) => !r.allowed)).toHaveLength(20);
    const rows = await rowsFor(key);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(5);
  });

  it("counts remaining down to zero and then refuses without moving the row", async () => {
    const key = unique("rl-sequence");

    expect((await attempt(key, 2)).remaining).toBe(1);
    expect((await attempt(key, 2)).remaining).toBe(0);

    const refused = await attempt(key, 2);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect((await rowsFor(key))[0].count).toBe(2);
  });

  it("refuses a bucket already past a cap an admin has since lowered, and leaves it", async () => {
    const key = unique("rl-lowered");
    await seed(key, 10, currentBucket());

    expect((await attempt(key, 5)).allowed).toBe(false);
    expect((await rowsFor(key))[0].count).toBe(10);
  });

  it("refuses a cap of zero and creates no row", async () => {
    const key = unique("rl-zero");

    expect((await attempt(key, 0)).allowed).toBe(false);
    expect(await rowsFor(key)).toEqual([]);
  });

  it("trims this key's older buckets on the attempt that opens a new one", async () => {
    const key = unique("rl-trim");
    const other = unique("rl-trim-other");
    const old = new Date(currentBucket().getTime() - 3 * WINDOW_SECONDS * 1000);
    await seed(key, 3, old);
    await seed(other, 3, old);

    expect((await attempt(key, 5)).allowed).toBe(true);

    const rows = await rowsFor(key);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1);
    expect(await rowsFor(other)).toHaveLength(1);
  });

  it("leaves older buckets alone on an attempt that only increments", async () => {
    const key = unique("rl-no-trim");
    expect((await attempt(key, 5)).allowed).toBe(true);

    const old = new Date(currentBucket().getTime() - 3 * WINDOW_SECONDS * 1000);
    await seed(key, 3, old);

    expect((await attempt(key, 5)).allowed).toBe(true);

    expect(await rowsFor(key)).toHaveLength(2);
  });

  it("gives a new bucket the full cap again", async () => {
    const key = unique("rl-rollover");
    expect((await attempt(key, 1)).allowed).toBe(true);
    expect((await attempt(key, 1)).allowed).toBe(false);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + WINDOW_SECONDS * 1000));

    expect((await attempt(key, 1)).allowed).toBe(true);
  });
});
