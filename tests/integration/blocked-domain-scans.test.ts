import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import {
  normalizeBlockedDomain,
  findScansForBlockedDomain,
  deleteScansForBlockedDomain,
} from "@/lib/admin/blocked-domain-scans";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The blocked-domain purge, matched by Postgres rather than by a mock.
 *
 * This action deletes rows belonging to every user at once, which is what it
 * is for, so the only thing standing between "purge evil.com" and "purge half
 * the database" is a regex that extracts the hostname and a LIKE pattern with
 * its metacharacters escaped. Both live in SQL. The unit tier fakes
 * pool.query, so it answers a weakened pattern exactly as it answers this
 * one, and the failure it would miss is silent, cross-tenant and permanent.
 */
async function seedScan(userId: number, url: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history (user_id, url, status, started_at, scanned_at, scan_type)
     VALUES ($1, $2, 'completed', NOW(), NOW(), 'web')
     RETURNING id`,
    [userId, url],
  );
  return rows[0].id;
}

async function stillThere(id: number): Promise<boolean> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM scan_history WHERE id = $1",
    [id],
  );
  return rows[0].n === 1;
}

describeIntegration("purging the scans of a blocked domain", () => {
  it("normalizes a pasted URL down to its hostname", () => {
    expect(normalizeBlockedDomain("  HTTPS://Evil.com/some/path?q=1  ")).toBe(
      "evil.com",
    );
    expect(normalizeBlockedDomain("evil.com")).toBe("evil.com");
  });

  it("takes the domain and its subdomains, across every account, and nothing else", async () => {
    // A unique label keeps this independent of whatever other suites have
    // written into the shared scan_history table.
    const label = unique("blk").replace(/[^a-z0-9]/g, "");
    const domain = `${label}.example.test`;
    const owner = await createUser();
    const other = await createUser();

    const doomed = [
      await seedScan(owner.id, `https://${domain}/`),
      await seedScan(owner.id, `http://${domain}/deep/path?q=1`),
      // Another account's scan of the same host: this action is deliberately
      // cross-tenant, because a blocked domain should not stay in anyone's
      // history.
      await seedScan(other.id, `https://sub.${domain}/`),
    ];
    const spared = [
      // Same suffix, different host: "notLABEL.example.test" must not be
      // taken by the subdomain arm, which anchors on the leading dot.
      await seedScan(owner.id, `https://not${domain}/`),
      await seedScan(other.id, "https://unrelated.example.test/"),
    ];

    const found = await findScansForBlockedDomain(domain);
    expect(found.map((r) => r.id).sort()).toEqual([...doomed].sort());
    // The search is what an admin reads before clicking delete, so it also
    // has to name the account each row belongs to.
    expect(found.every((r) => typeof r.user_email === "string")).toBe(true);

    expect(await deleteScansForBlockedDomain(domain)).toBe(doomed.length);
    for (const id of doomed) expect(await stillThere(id)).toBe(false);
    for (const id of spared) expect(await stillThere(id)).toBe(true);

    await pool.query("DELETE FROM scan_history WHERE id = ANY($1::int[])", [
      spared,
    ]);
  });

  it("treats LIKE metacharacters as characters, not wildcards", async () => {
    const owner = await createUser();
    const label = unique("wild").replace(/[^a-z0-9]/g, "");
    const kept = [
      await seedScan(owner.id, `https://a.${label}.example.test/`),
      await seedScan(owner.id, `https://b.${label}.example.test/`),
    ];

    // The pattern an escaping regression would turn into "every host ending
    // in .example.test", which is every row above and every row every other
    // suite wrote.
    expect(await deleteScansForBlockedDomain("%.example.test")).toBe(0);
    // And the underscore form, which matches exactly one character when it
    // escapes into the pattern.
    expect(await deleteScansForBlockedDomain(`${label}_example.test`)).toBe(0);
    for (const id of kept) expect(await stillThere(id)).toBe(true);

    await pool.query("DELETE FROM scan_history WHERE id = ANY($1::int[])", [
      kept,
    ]);
  });
});
