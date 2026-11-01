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

/** Rows loaded inside the plan tests' transaction so the planner has statistics to decide on. */
const PLAN_FILLER_ROWS = 5000;

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
      // Sequential scans are switched off for the transaction so the answer
      // does not turn on a seq-versus-index trade the CI machine happens to
      // make. That alone is not enough: the two expression indexes share one
      // partial predicate, so on a nearly empty table a full scan of the OTHER
      // one plus a plain Filter costs the same as one index probe, and the
      // planner picked it (a two-element = ANY(...) costs two probes, which
      // made the origin-path index look dearer than scanning the host index).
      // So the table is given production-like volume and statistics inside the
      // transaction, where a selective probe beats scanning thousands of
      // entries and filtering them. ROLLBACK removes the rows and the
      // statistics with them.
      const owner = await createUser();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL enable_seqscan = off");
        await client.query(
          `INSERT INTO scan_history (user_id, url, status, started_at, scanned_at, scan_type, is_public)
           SELECT $1::int,
                  'https://site' || g || '.example.test/page' || (g % 7) || '?q=' || g,
                  'completed', NOW(), NOW() - (g * INTERVAL '1 second'), 'web', true
             FROM generate_series(1, $2::int) AS g`,
          [owner.id, PLAN_FILLER_ROWS],
        );
        await client.query("ANALYZE scan_history");
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
