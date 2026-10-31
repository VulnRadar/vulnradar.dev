import { it, expect, afterAll } from "vitest";
import pool from "@/lib/database/db";
import {
  listDomainScans,
  applyDomainScanAction,
} from "@/lib/domains/owner-control";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * Which scans a verified domain owner can see and withdraw, matched by
 * Postgres.
 *
 * A domain owner acts on OTHER accounts' public scans, so the host match is the
 * whole boundary of that power: too loose and an owner unpublishes a stranger's
 * report of a different site, too tight and a report of their own site stays
 * live on /host. The unit tier fakes pool.query and cannot tell the two apart.
 */
const seeded: number[] = [];

async function seedScan(
  userId: number,
  url: string,
  opts: { isPublic?: boolean; shared?: boolean } = {},
): Promise<string> {
  const { rows } = await pool.query<{ id: number; public_id: string }>(
    `INSERT INTO scan_history
       (user_id, url, status, started_at, scanned_at, scan_type, is_public, share_token)
     VALUES ($1, $2, 'completed', NOW(), NOW(), 'web', $3, $4)
     RETURNING id, public_id`,
    [userId, url, opts.isPublic ?? true, opts.shared ? unique("share") : null],
  );
  seeded.push(rows[0].id);
  return rows[0].public_id;
}

async function isPublic(publicId: string): Promise<boolean> {
  const { rows } = await pool.query<{ is_public: boolean }>(
    "SELECT is_public FROM scan_history WHERE public_id = $1",
    [publicId],
  );
  return rows[0].is_public;
}

describeIntegration(
  "domain owner control over other accounts' public scans",
  () => {
    afterAll(async () => {
      if (seeded.length > 0) {
        await pool.query("DELETE FROM scan_history WHERE id = ANY($1::int[])", [
          seeded,
        ]);
      }
    });

    it("lists the covered public scans whatever follows the host, and none of the lookalikes", async () => {
      const label = unique("own").replace(/[^a-z0-9]/g, "");
      const domain = `${label}.example.test`;
      const owner = await createUser();
      const stranger = await createUser();

      const covered = [
        await seedScan(stranger.id, `https://${domain}/`),
        await seedScan(stranger.id, `https://www.${domain}/page?x=1`),
        await seedScan(stranger.id, `https://sub.${domain}/`),
        await seedScan(stranger.id, `https://${domain}:8443/x`),
        await seedScan(stranger.id, `https://${domain}?utm=1`),
        await seedScan(stranger.id, `https://${domain}#frag`),
        await seedScan(stranger.id, `https://user:pw@${domain}/`),
        await seedScan(stranger.id, `HTTPS://${domain.toUpperCase()}/Path`),
        // Not public, but an unlisted share link makes it publicly reachable.
        await seedScan(stranger.id, `https://${domain}/shared`, {
          isPublic: false,
          shared: true,
        }),
        await seedScan(owner.id, `https://${domain}/mine`),
      ];
      const lookalikes = [
        await seedScan(stranger.id, `https://not${domain}/`),
        await seedScan(stranger.id, `https://${domain}.attacker.test/`),
        await seedScan(
          stranger.id,
          `https://other.example.test/?next=${domain}`,
        ),
        await seedScan(stranger.id, `https://other.example.test/${domain}`),
        await seedScan(stranger.id, `https://user@not${domain}/`),
        // The userinfo names the owner's domain; the host does not.
        await seedScan(
          stranger.id,
          `https://sub.${domain}:pw@other.example.test/`,
        ),
        await seedScan(
          stranger.id,
          `https://www.${domain}:x@other.example.test/`,
        ),
        // On the domain, but private and unshared: not publicly reachable.
        await seedScan(stranger.id, `https://${domain}/private`, {
          isPublic: false,
        }),
      ];

      const listed = await listDomainScans(domain, owner.id, 100);
      const listedIds = listed.map((s) => s.publicId).sort();
      expect(listedIds).toEqual([...covered].sort());
      for (const id of lookalikes) expect(listedIds).not.toContain(id);

      // The owner is told which one is theirs and nothing else about who ran it.
      const mine = listed.filter((s) => s.isOwnScan);
      expect(mine.map((s) => s.url)).toEqual([`https://${domain}/mine`]);
    });

    it("unpublishes exactly the covered public scans and leaves a lookalike public", async () => {
      const label = unique("act").replace(/[^a-z0-9]/g, "");
      const domain = `${label}.example.test`;
      const stranger = await createUser();

      const covered = [
        await seedScan(stranger.id, `https://${domain}/`),
        await seedScan(stranger.id, `https://${domain}:8443/x`),
        await seedScan(stranger.id, `https://user:pw@sub.${domain}/`),
      ];
      const lookalikes = [
        await seedScan(stranger.id, `https://not${domain}/`),
        await seedScan(
          stranger.id,
          `https://sub.${domain}:pw@other.example.test/`,
        ),
        await seedScan(
          stranger.id,
          `https://other.example.test/?next=${domain}`,
        ),
      ];

      const result = await applyDomainScanAction(domain, "unpublish", null);
      expect(result.affected).toBe(covered.length);

      for (const id of covered) expect(await isPublic(id)).toBe(false);
      for (const id of lookalikes) expect(await isPublic(id)).toBe(true);

      // Running it again changes nothing: the precondition skips rows that are
      // already private.
      expect(
        (await applyDomainScanAction(domain, "unpublish", null)).affected,
      ).toBe(0);
    });
  },
);
