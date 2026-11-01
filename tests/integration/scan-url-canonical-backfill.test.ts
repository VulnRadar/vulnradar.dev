import { it, expect, afterAll } from "vitest";
import pool from "@/lib/database/db";
import { canonicalizeStoredScanUrls } from "@/lib/database/boot/backfills";
import { hostOfUrlSql } from "@/lib/database/sql-fragments";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The boot rewrite of scan URLs stored before normalizeUrl stored the parsed
 * form, run against a real PostgreSQL.
 *
 * The candidate filter (strpos with chr(92), the [[:cntrl:]] class), the
 * keyset walk by id and the guarded UPDATE are all evaluated by the server, so
 * a fake pool would answer a wrong class or a wrong page boundary with a
 * green tick.
 */
const BACKSLASH = "\\";
const seeded: number[] = [];

async function seedScan(userId: number, url: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history (user_id, url, status, started_at, scanned_at, scan_type)
     VALUES ($1, $2, 'completed', NOW(), NOW(), 'web')
     RETURNING id`,
    [userId, url],
  );
  seeded.push(rows[0].id);
  return rows[0].id;
}

async function urlOf(id: number): Promise<string> {
  const { rows } = await pool.query<{ url: string }>(
    "SELECT url FROM scan_history WHERE id = $1",
    [id],
  );
  return rows[0].url;
}

describeIntegration("stored scan URL rewrite", () => {
  afterAll(async () => {
    if (seeded.length > 0) {
      await pool.query("DELETE FROM scan_history WHERE id = ANY($1::int[])", [
        seeded,
      ]);
    }
  });

  it("rewrites backslash and control-character URLs to what was fetched, and nothing else", async () => {
    const owner = await createUser();
    const site = `${unique("canon").replace(/[^a-z0-9]/g, "")}.example.test`;

    const spoof = await seedScan(
      owner.id,
      `https://${site}${BACKSLASH}@victim.example.test/`,
    );
    const tabbed = await seedScan(owner.id, `https://${site}/a\tb`);
    const plain = await seedScan(owner.id, `https://${site}/page?x=1`);
    const refused = await seedScan(
      owner.id,
      `https://exa\u0001mple.test${BACKSLASH}x`,
    );

    await canonicalizeStoredScanUrls(pool);

    expect(await urlOf(spoof)).toBe(`https://${site}/@victim.example.test/`);
    expect(await urlOf(tabbed)).toBe(`https://${site}/ab`);
    expect(await urlOf(plain)).toBe(`https://${site}/page?x=1`);
    expect(await urlOf(refused)).toBe(
      `https://exa\u0001mple.test${BACKSLASH}x`,
    );

    // The rewritten row now reads as the site that was scanned.
    const { rows } = await pool.query<{ host: string | null }>(
      `SELECT ${hostOfUrlSql("url")} AS host FROM scan_history WHERE id = $1`,
      [spoof],
    );
    expect(rows[0].host).toBe(site);

    // A second boot finds nothing left to change.
    await canonicalizeStoredScanUrls(pool);
    expect(await urlOf(spoof)).toBe(`https://${site}/@victim.example.test/`);
  });

  it("walks past the first page of candidates", async () => {
    const owner = await createUser();
    const tag = unique("page").replace(/[^a-z0-9]/g, "");
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO scan_history (user_id, url, status, started_at, scanned_at, scan_type)
       SELECT $1::int,
              'https://' || $2::text || g || '.example.test' || chr(92) || 'x',
              'completed', NOW(), NOW(), 'web'
         FROM generate_series(1, 520) AS g
       RETURNING id`,
      [owner.id, tag],
    );
    seeded.push(...rows.map((r) => r.id));

    await canonicalizeStoredScanUrls(pool);

    const left = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM scan_history
        WHERE id = ANY($1::int[]) AND strpos(url, chr(92)) > 0`,
      [rows.map((r) => r.id)],
    );
    expect(Number(left.rows[0].n)).toBe(0);
  });
});
