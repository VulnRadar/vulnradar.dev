import { afterEach, expect, it } from "vitest";
import type { PoolClient } from "pg";

import { isPublicScanId } from "@/lib/api/path-id";
import pool from "@/lib/database/db";
import {
  reserveConcurrentScanBatch,
  reserveConcurrentScanSlot,
} from "@/lib/rate-limiting/concurrent-scans";
import {
  clearSettings,
  createUser,
  describeIntegration,
  setSettings,
} from "./_db";

/**
 * The reservation hands back the row's opaque id. That id is a database
 * default no caller writes, read inside the same transaction that inserted the
 * row, which is exactly what a faked pool cannot prove: it would answer for a
 * row that does not exist as readily as for one that does.
 */
async function insertOne(client: PoolClient, userId: number): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO scan_history (user_id, url, status)
     VALUES ($1, 'https://example.test/one', 'pending') RETURNING id`,
    [userId],
  );
  return rows[0].id;
}

async function storedPublicId(id: number): Promise<string> {
  const { rows } = await pool.query<{ public_id: string }>(
    "SELECT public_id FROM scan_history WHERE id = $1",
    [id],
  );
  return rows[0].public_id;
}

describeIntegration("concurrent-scan reservation ids", () => {
  afterEach(async () => {
    await clearSettings();
  });

  it("returns the public id of a row reserved under a cap", async () => {
    await setSettings({
      BILLING_ENABLED: true,
      BILLING_FREE_CONCURRENT_SCANS: 2,
    });
    const user = await createUser();
    const result = await reserveConcurrentScanSlot(user.id, (client) =>
      insertOne(client, user.id),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPublicScanId(result.publicId)).toBe(true);
    expect(result.publicId).toBe(await storedPublicId(result.scanId));
  });

  it("returns the public id when there is no cap to reserve against", async () => {
    await setSettings({ BILLING_ENABLED: false });
    const user = await createUser();
    const result = await reserveConcurrentScanSlot(user.id, (client) =>
      insertOne(client, user.id),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.publicId).toBe(await storedPublicId(result.scanId));
  });

  it("pairs each batch row with its own public id", async () => {
    await setSettings({
      BILLING_ENABLED: true,
      BILLING_FREE_CONCURRENT_SCANS: 2,
    });
    const user = await createUser();
    const result = await reserveConcurrentScanBatch(user.id, async (client) => {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO scan_history (user_id, url, status)
         SELECT $1, 'https://example.test/' || n, 'pending'
         FROM generate_series(1, 3) AS n
         RETURNING id`,
        [user.id],
      );
      // Reversed so the pairing cannot pass by following insert order.
      return rows.map((row) => row.id).reverse();
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.publicIds).toHaveLength(3);
    expect(new Set(result.publicIds).size).toBe(3);
    for (const [index, id] of result.scanIds.entries()) {
      expect(result.publicIds[index]).toBe(await storedPublicId(id));
    }
  });

  it("inserts nothing and returns no id when the account is at capacity", async () => {
    await setSettings({
      BILLING_ENABLED: true,
      BILLING_FREE_CONCURRENT_SCANS: 2,
    });
    const user = await createUser();
    await pool.query(
      `INSERT INTO scan_history (user_id, url, status)
       SELECT $1, 'https://example.test/full', 'running'
       FROM generate_series(1, 2)`,
      [user.id],
    );

    const result = await reserveConcurrentScanSlot(user.id, (client) =>
      insertOne(client, user.id),
    );

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("publicId");
  });
});
