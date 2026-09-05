import { it, expect, beforeAll } from "vitest";
import pool from "@/lib/database/db";
import { buildHistoryFilter } from "@/lib/history/list-filter";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The history list's search and tag filter, run as SQL against a real
 * PostgreSQL.
 *
 * This tier exists for exactly this shape of question. The unit suite
 * (tests/app/api/v3/history/route.test.ts) fakes `pool.query`, so it can prove
 * the route builds the clause and binds the caller's own user id, and nothing
 * more: a faked pool answers `url ILIKE '%' ESCAPE '\'` the same way it
 * answers a correct query. Whether `ESCAPE` actually makes a typed "%" a
 * literal, and whether the tag EXISTS can be made to reach another user's
 * scans, are both properties of the database.
 *
 * It calls the production builder rather than a copy of the clause, so a
 * change to the route's WHERE is a change to what these assert.
 */

const OTHER = "https://other.example.test/";

interface Fixture {
  ownerId: number;
  intruderId: number;
  tag: string;
}

let fx: Fixture;

async function insertScan(
  userId: number,
  url: string,
  opts: { tag?: string; ageDays?: number; scanType?: string | null } = {},
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history (user_id, url, status, started_at, scanned_at, scan_type)
     VALUES ($1, $2, 'completed', NOW(), NOW() - ($3 * INTERVAL '1 day'), $4)
     RETURNING id`,
    [userId, url, opts.ageDays ?? 0, opts.scanType ?? null],
  );
  const id = rows[0].id;
  if (opts.tag) {
    await pool.query(
      `INSERT INTO scan_tags (scan_id, user_id, tag, source) VALUES ($1, $2, $3, 'manual')`,
      [id, userId, opts.tag],
    );
  }
  return id;
}

/** Run the production clause and return the matched URLs, newest first. */
async function search(
  userId: number,
  opts: { q?: string | null; tag?: string | null; retentionDays?: number } = {},
): Promise<string[]> {
  const { where, params } = buildHistoryFilter({
    userId,
    retentionDays: opts.retentionDays ?? -1,
    q: opts.q ?? null,
    tag: opts.tag ?? null,
  });
  const { rows } = await pool.query<{ url: string }>(
    `SELECT sh.url FROM scan_history sh WHERE ${where} ORDER BY sh.scanned_at DESC`,
    params,
  );
  return rows.map((r) => r.url);
}

describeIntegration("GET /api/v3/history search, in SQL", () => {
  beforeAll(async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const tag = unique("tag");

    // The owner's scans. The last three are the awkward URLs: LIKE
    // metacharacters typed by a user, and a case difference.
    await insertScan(owner.id, "https://shop.example.test/checkout", { tag });
    await insertScan(owner.id, "https://blog.example.test/post", { tag });
    await insertScan(owner.id, "https://SHOP.example.test/cart");
    await insertScan(owner.id, "https://example.test/100%off");
    await insertScan(owner.id, "https://example.test/a_b");
    await insertScan(owner.id, "https://example.test/axb");
    // Outside a 30-day retention window.
    await insertScan(owner.id, "https://old.example.test/", { ageDays: 400 });
    // A repo scan, which this list excludes: /repos has its own history.
    await insertScan(owner.id, "https://github.example.test/repo", {
      scanType: "github",
    });

    // The other account's scans, including one on a URL the owner also
    // scanned and one carrying the same tag string.
    await insertScan(intruder.id, "https://shop.example.test/checkout", {
      tag,
    });
    await insertScan(intruder.id, OTHER, { tag });

    fx = { ownerId: owner.id, intruderId: intruder.id, tag };
  });

  it("matches a URL substring, case-insensitively", async () => {
    const urls = await search(fx.ownerId, { q: "shop" });
    expect(urls.sort()).toEqual([
      "https://SHOP.example.test/cart",
      "https://shop.example.test/checkout",
    ]);
  });

  it("cannot return another user's scan of the same URL", async () => {
    // Both accounts scanned https://shop.example.test/checkout. The owner sees
    // one row, not two, and the intruder sees their own.
    const owner = await search(fx.ownerId, { q: "shop.example.test/checkout" });
    expect(owner).toHaveLength(1);

    const intruder = await search(fx.intruderId, { q: "shop" });
    expect(intruder).toEqual(["https://shop.example.test/checkout"]);
    expect(intruder).not.toContain("https://SHOP.example.test/cart");
  });

  it("treats a typed % as a literal, not as 'every row I own'", async () => {
    // Unescaped, `%` in the middle of the pattern would match every URL. The
    // ESCAPE clause is what makes this one row.
    expect(await search(fx.ownerId, { q: "%" })).toEqual([
      "https://example.test/100%off",
    ]);
    expect(await search(fx.ownerId, { q: "100%off" })).toEqual([
      "https://example.test/100%off",
    ]);
  });

  it("treats a typed _ as a literal, not as 'any single character'", async () => {
    // Unescaped, "a_b" would also match "axb".
    expect(await search(fx.ownerId, { q: "a_b" })).toEqual([
      "https://example.test/a_b",
    ]);
  });

  it("returns nothing rather than everything for a search that matches nothing", async () => {
    expect(await search(fx.ownerId, { q: unique("nope") })).toEqual([]);
  });

  it("filters on a tag without crossing accounts, even when both users used it", async () => {
    const owner = await search(fx.ownerId, { tag: fx.tag });
    expect(owner.sort()).toEqual([
      "https://blog.example.test/post",
      "https://shop.example.test/checkout",
    ]);
    // The intruder tagged this URL too, and it is not in the owner's results.
    expect(owner).not.toContain(OTHER);

    const intruder = await search(fx.intruderId, { tag: fx.tag });
    expect(intruder.sort()).toEqual([
      OTHER,
      "https://shop.example.test/checkout",
    ]);
  });

  it("combines q and tag as AND, not OR", async () => {
    expect(await search(fx.ownerId, { q: "shop", tag: fx.tag })).toEqual([
      "https://shop.example.test/checkout",
    ]);
    // Tagged but does not match the search.
    expect(
      await search(fx.ownerId, { q: "blog", tag: unique("absent") }),
    ).toEqual([]);
  });

  it("keeps the retention window in front of the filter", async () => {
    // The old scan matches "example.test" but is outside the window, so search
    // cannot reach a scan the unfiltered list would not return either.
    const withinWindow = await search(fx.ownerId, {
      q: "old.example.test",
      retentionDays: 30,
    });
    expect(withinWindow).toEqual([]);
    const unlimited = await search(fx.ownerId, { q: "old.example.test" });
    expect(unlimited).toEqual(["https://old.example.test/"]);
  });

  it("keeps the GitHub exclusion in front of the filter", async () => {
    expect(await search(fx.ownerId, { q: "github.example.test" })).toEqual([]);
  });
});

// Not asserted here: which index the planner picks. The filtered search is
// bounded by idx_scan_history_user_scanned (user_id, scanned_at DESC), so the
// ILIKE is a filter over one account's rows rather than a scan of every scan
// in the deployment. But on a fixture table of a dozen rows Postgres will
// rightly choose a sequential scan, and an EXPLAIN assertion here would be a
// test of the planner's cost model rather than of this query.
