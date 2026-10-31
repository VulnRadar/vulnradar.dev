import { it, expect, afterAll } from "vitest";
import pool from "@/lib/database/db";
import {
  PUBLIC_HOST_SQL,
  URL_ORIGIN_PATH_SQL,
} from "@/lib/database/sql-fragments";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The two URL expressions queries and indexes share, run by Postgres.
 *
 * tests/lib/database/sql-fragments.test.ts proves the patterns in JavaScript.
 * This proves the server agrees, and proves the thing a unit test cannot: that
 * the planner will actually use the expression indexes for a query written
 * with the shared constants. An expression index that is not matched is not an
 * error, it is a sequential scan nobody notices, so the plan is asserted.
 */
const seeded: number[] = [];

async function seedScan(
  userId: number,
  url: string,
  isPublic = true,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history (user_id, url, status, started_at, scanned_at, scan_type, is_public)
     VALUES ($1, $2, 'completed', NOW(), NOW(), 'web', $3)
     RETURNING id`,
    [userId, url, isPublic],
  );
  seeded.push(rows[0].id);
  return rows[0].id;
}

function label(prefix: string): string {
  return unique(prefix).replace(/[^a-z0-9]/g, "");
}

describeIntegration("scan_history URL expressions", () => {
  afterAll(async () => {
    if (seeded.length > 0) {
      await pool.query("DELETE FROM scan_history WHERE id = ANY($1::int[])", [
        seeded,
      ]);
    }
  });

  it("matches a stored URL by origin and path with the query and fragment cut off", async () => {
    const host = `${label("path")}.example.test`;
    const owner = await createUser();

    const expected = [
      await seedScan(owner.id, `https://${host}/page`),
      await seedScan(owner.id, `https://${host}/page?utm_source=mail`),
      await seedScan(owner.id, `https://${host}/page#section`),
      await seedScan(owner.id, `https://${host}/page?a=1&b=2#section`),
      // The trailing-slash variant is its own value: the caller asks for both.
      await seedScan(owner.id, `https://${host}/page/`),
    ];
    const notExpected = [
      await seedScan(owner.id, `https://${host}/other?x=1`),
      await seedScan(owner.id, `https://${host}/page-two`),
      await seedScan(owner.id, `https://${host}/pageextra?x=1`),
      // A private scan of the same page is never returned by a public lookup.
      await seedScan(owner.id, `https://${host}/page?private=1`, false),
    ];

    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM scan_history
        WHERE is_public = true AND status = 'completed'
          AND ${URL_ORIGIN_PATH_SQL} = ANY($1::text[])`,
      [[`https://${host}/page`, `https://${host}/page/`]],
    );
    const found = rows.map((r) => r.id).sort((a, b) => a - b);
    expect(found).toEqual([...expected].sort((a, b) => a - b));
    for (const id of notExpected) expect(found).not.toContain(id);
  });

  it("reads www and bare hosts as one site and rejects lookalikes", async () => {
    const site = `${label("host")}.example.test`;
    const owner = await createUser();

    const expected = [
      await seedScan(owner.id, `https://${site}/`),
      await seedScan(owner.id, `https://www.${site}/`),
      await seedScan(owner.id, `http://WWW.${site.toUpperCase()}/Path`),
      await seedScan(owner.id, `https://${site}:8443/x`),
      await seedScan(owner.id, `https://${site}?x=1`),
      await seedScan(owner.id, `https://user:pw@${site}/`),
    ];
    const notExpected = [
      await seedScan(owner.id, `https://evil.${site}/`),
      await seedScan(owner.id, `https://${site}.attacker.test/`),
      await seedScan(owner.id, `https://not${site}/`),
      await seedScan(owner.id, `https://other.example.test/?next=${site}`),
      await seedScan(owner.id, `https://other.example.test/${site}`),
      // Same site, but the scan is private.
      await seedScan(owner.id, `https://${site}/private`, false),
    ];

    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM scan_history
        WHERE is_public = true AND status = 'completed'
          AND ${PUBLIC_HOST_SQL} = $1`,
      [site],
    );
    const found = rows.map((r) => r.id).sort((a, b) => a - b);
    expect(found).toEqual([...expected].sort((a, b) => a - b));
    for (const id of notExpected) expect(found).not.toContain(id);
  });

  it("builds the indexes the lookups rely on", async () => {
    const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE indexname = ANY($1::text[])`,
      [
        [
          "idx_webhook_deliveries_attempted_at",
          "idx_scan_history_user_shared",
          "idx_scan_history_user_url_completed",
          "idx_scan_history_public_host",
          "idx_scan_history_public_origin_path",
        ],
      ],
    );
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect([...byName.keys()].sort()).toEqual([
      "idx_scan_history_public_host",
      "idx_scan_history_public_origin_path",
      "idx_scan_history_user_shared",
      "idx_scan_history_user_url_completed",
      "idx_webhook_deliveries_attempted_at",
    ]);
    // Partial on the privacy predicate, so a private scan is not in them.
    expect(byName.get("idx_scan_history_public_host")).toContain(
      "is_public = true",
    );
    expect(byName.get("idx_scan_history_public_origin_path")).toContain(
      "is_public = true",
    );
    expect(byName.get("idx_scan_history_user_shared")).toContain(
      "share_token IS NOT NULL",
    );
  });

  it.each([
    [
      "idx_scan_history_public_host",
      `SELECT id FROM scan_history
        WHERE is_public = true AND status = 'completed'
          AND ${PUBLIC_HOST_SQL} = 'example.test'
        ORDER BY scanned_at DESC LIMIT 30`,
    ],
    [
      "idx_scan_history_public_origin_path",
      `SELECT id FROM scan_history
        WHERE is_public = true AND status = 'completed'
          AND ${URL_ORIGIN_PATH_SQL} = ANY(ARRAY['https://example.test/a', 'https://example.test/a/'])
        ORDER BY scanned_at DESC LIMIT 1`,
    ],
  ])(
    "plans a query written with the shared expression onto %s",
    async (indexName, query) => {
      // Sequential scans are switched off for the transaction so that the
      // answer does not depend on how many rows this suite happens to have
      // written: the question is whether the index CAN be matched, not whether
      // the planner prefers it on a nearly empty table.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL enable_seqscan = off");
        const plan = await client.query<{ "QUERY PLAN": string }>(
          `EXPLAIN ${query}`,
        );
        const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
        expect(text).toContain(indexName);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    },
  );
});
