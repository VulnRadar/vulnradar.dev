import { it, expect, beforeAll } from "vitest";
import pool from "@/lib/database/db";
import { resolvePublicIdForCaller } from "@/lib/history/resolve-public-id";
import { describeIntegration, createUser, createTeam } from "./_db";

/**
 * Turning an old numeric scan id into the public one, against a real database.
 *
 * The unit suite (tests/lib/history/resolve-public-id.test.ts) fakes the row
 * lookup and the access check, so it proves the decision logic and nothing
 * about the two things the decision rests on: that the resolver finds the row
 * by its sequential id, and that the team-read check really is "this scan is
 * shared with a team the caller sits in". Here both run as SQL.
 *
 * The property that matters is negative. A scan that is public, even listed,
 * must not give its public id to someone who does not own it and does not read
 * it through a team: a numeric-to-public map for other people's scans is the
 * enumeration oracle the opaque id exists to prevent.
 */

interface Fixture {
  ownerId: number;
  readerId: number;
  strangerId: number;
  sharedScan: { id: number; publicId: string };
  personalScan: { id: number; publicId: string };
}

let fx: Fixture;

async function insertScan(
  userId: number,
  url: string,
): Promise<{ id: number; publicId: string }> {
  const { rows } = await pool.query<{ id: number; public_id: string }>(
    `INSERT INTO scan_history (user_id, url, status, started_at, scanned_at, scan_type, is_public)
     VALUES ($1, $2, 'completed', NOW(), NOW(), 'web', TRUE)
     RETURNING id, public_id`,
    [userId, url],
  );
  return { id: rows[0].id, publicId: rows[0].public_id };
}

describeIntegration("resolvePublicIdForCaller, against the real tables", () => {
  beforeAll(async () => {
    const owner = await createUser();
    const reader = await createUser();
    const stranger = await createUser();

    const teamId = await createTeam(owner.id);
    await pool.query(
      "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'viewer')",
      [teamId, owner.id, teamId, reader.id],
    );

    const sharedScan = await insertScan(
      owner.id,
      "https://shared.example.test/",
    );
    await pool.query(
      "INSERT INTO scan_history_teams (scan_id, team_id) VALUES ($1, $2)",
      [sharedScan.id, teamId],
    );
    const personalScan = await insertScan(
      owner.id,
      "https://personal.example.test/",
    );

    fx = {
      ownerId: owner.id,
      readerId: reader.id,
      strangerId: stranger.id,
      sharedScan,
      personalScan,
    };
  });

  it("gives the owner the public id from the numeric id", async () => {
    expect(
      await resolvePublicIdForCaller(fx.ownerId, String(fx.sharedScan.id)),
    ).toBe(fx.sharedScan.publicId);
    expect(
      await resolvePublicIdForCaller(fx.ownerId, String(fx.personalScan.id)),
    ).toBe(fx.personalScan.publicId);
  });

  it("gives a team reader the public id of a scan shared with their team", async () => {
    expect(
      await resolvePublicIdForCaller(fx.readerId, String(fx.sharedScan.id)),
    ).toBe(fx.sharedScan.publicId);
  });

  it("gives a team member nothing for the owner's personal scan, which no team holds", async () => {
    expect(
      await resolvePublicIdForCaller(fx.readerId, String(fx.personalScan.id)),
    ).toBeNull();
  });

  it("gives a stranger nothing, although both scans are public", async () => {
    expect(
      await resolvePublicIdForCaller(fx.strangerId, String(fx.sharedScan.id)),
    ).toBeNull();
    expect(
      await resolvePublicIdForCaller(fx.strangerId, String(fx.personalScan.id)),
    ).toBeNull();
  });

  it("answers a stranger and a missing scan the same way", async () => {
    const missing = await resolvePublicIdForCaller(
      fx.strangerId,
      String(fx.sharedScan.id + 1_000_000),
    );
    const notTheirs = await resolvePublicIdForCaller(
      fx.strangerId,
      String(fx.sharedScan.id),
    );

    expect(missing).toBeNull();
    expect(notTheirs).toBe(missing);
  });

  it("hands the public id back to a caller who already holds it and may read it", async () => {
    expect(
      await resolvePublicIdForCaller(fx.ownerId, fx.sharedScan.publicId),
    ).toBe(fx.sharedScan.publicId);
    expect(
      await resolvePublicIdForCaller(fx.strangerId, fx.sharedScan.publicId),
    ).toBeNull();
  });
});
