/**
 * Database-backed team avatar storage.
 *
 * The team half of lib/uploads/avatar-storage.ts, and deliberately the same
 * mechanism rather than a second one: validated PNG/JPEG bytes (see
 * lib/uploads/avatar.ts) go into Postgres as BYTEA, one row per team, and are
 * served back through GET /api/v3/teams/avatar/[teamId]. Nothing touches the
 * filesystem, so self-hosted Docker and serverless behave identically.
 *
 * One difference from the user table, and it is the reason there is no
 * `teams.avatar_url` column to go with `users.avatar_url`: a user's avatar can
 * be an EXTERNAL url that OAuth handed us (cdn.discordapp.com, Google, GitHub),
 * so that column has to hold a value we did not generate. A team has no such
 * source. Its avatar is always these bytes or nothing, so the URL is derived
 * from the row's own updated_at instead of being stored a second time, and the
 * two can never disagree about whether a team has a picture.
 */

import { Buffer } from "node:buffer";
import pool from "@/lib/database/db";

/**
 * Same-origin path the GET route resolves back to a team's stored bytes, or
 * null when the team has no avatar row.
 *
 * `updatedAt` becomes a cache-busting `v` param exactly like saveAvatarFile's
 * `Date.now()` does, so replacing a team picture doesn't keep showing the
 * browser-cached old one at the same URL.
 */
export function teamAvatarUrl(
  teamId: number,
  updatedAt: Date | string | null | undefined,
): string | null {
  if (!updatedAt) return null;
  const stamp = new Date(updatedAt).getTime();
  return `/api/v3/teams/avatar/${teamId}?v=${Number.isNaN(stamp) ? 0 : stamp}`;
}

/**
 * `team_id -> updated_at` for the teams that have an avatar, so a list of teams
 * can be decorated with avatar URLs in one round trip.
 *
 * Never throws. The table is created at boot with onError: "warn" (see
 * lib/database/schema), which means a deployment where that create failed keeps
 * running; the teams list must still list teams there rather than 500ing over a
 * missing picture. An error is logged, and every team simply falls back to its
 * initial.
 */
export async function readTeamAvatarStamps(
  teamIds: number[],
): Promise<Map<number, Date>> {
  if (teamIds.length === 0) return new Map();
  try {
    const res = await pool.query<{ team_id: number; updated_at: Date }>(
      `SELECT team_id, updated_at FROM team_avatars WHERE team_id = ANY($1::int[])`,
      [teamIds],
    );
    return new Map(res.rows.map((r) => [r.team_id, r.updated_at]));
  } catch (err) {
    console.error(
      "[team-avatar-storage] Failed to read team avatar timestamps:",
      err,
    );
    return new Map();
  }
}

/**
 * Upsert validated image bytes for `teamId` (one row per team, so a re-upload
 * -- even one that changes format, PNG to JPEG -- overwrites in place and never
 * orphans anything). Returns the URL to render.
 */
export async function saveTeamAvatarFile(
  teamId: number,
  mime: "image/png" | "image/jpeg",
  bytes: Buffer,
): Promise<string> {
  const res = await pool.query<{ updated_at: Date }>(
    `INSERT INTO team_avatars (team_id, image_data, content_type, updated_at)
       VALUES ($1, $2, $3, NOW())
     ON CONFLICT (team_id) DO UPDATE
       SET image_data = EXCLUDED.image_data,
           content_type = EXCLUDED.content_type,
           updated_at = NOW()
     RETURNING updated_at`,
    [teamId, bytes, mime],
  );
  // RETURNING, not Date.now(): the stamp in the URL then matches the row the
  // teams list will read back on its next load, so the freshly uploaded image
  // and the listed one resolve to the same URL instead of two.
  return teamAvatarUrl(teamId, res.rows[0]?.updated_at) ?? "";
}

/**
 * Read a team's stored avatar bytes and content type, or null when the team has
 * no uploaded avatar. Mirrors readAvatarFile.
 */
export async function readTeamAvatarFile(
  teamId: number,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const res = await pool.query<{
    image_data: Buffer;
    content_type: string | null;
  }>(`SELECT image_data, content_type FROM team_avatars WHERE team_id = $1`, [
    teamId,
  ]);
  const row = res.rows[0];
  if (!row?.image_data) return null;
  return {
    bytes: row.image_data,
    mime: row.content_type || "image/png",
  };
}

/** Remove a team's stored avatar row, if any. */
export async function deleteTeamAvatarFile(teamId: number): Promise<void> {
  await pool.query("DELETE FROM team_avatars WHERE team_id = $1", [teamId]);
}
