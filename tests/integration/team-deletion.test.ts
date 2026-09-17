import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { describeIntegration, createUser, createTeam, unique } from "./_db";

/**
 * What deleting a team does to the rows that pointed at it.
 *
 * The FK graph here is deliberately split: `team_members` and `team_invites`
 * are ON DELETE CASCADE, because membership of a team that no longer exists
 * is meaningless, while `scan_history`, `webhooks`, `scheduled_scans` and
 * `domains` are ON DELETE SET NULL, because a scan a member ran, a webhook
 * they registered and a schedule they set are theirs. Deleting the team
 * un-shares them; it must not destroy them.
 *
 * That distinction is a property of the schema and nothing else. These
 * columns are added by hand-written ALTER TABLE migrations, where losing
 * "ON DELETE SET NULL" is a one-word edit that turns "delete a team" into
 * "delete every member's scan history", and no unit test can see it: the
 * whole tier fakes pool.query, so the FK is never asked what it does.
 * account-deletion.test.ts already does this for the user graph.
 */
describeIntegration("deleting a team", () => {
  it("cascades membership and un-shares everything else", async () => {
    const owner = await createUser();
    const member = await createUser();
    const teamId = await createTeam(owner.id);

    await pool.query(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'member')`,
      [teamId, member.id],
    );
    await pool.query(
      `INSERT INTO team_invites (team_id, email, role, token, invited_by, expires_at)
       VALUES ($1, $2, 'viewer', $3, $4, NOW() + INTERVAL '7 days')`,
      [teamId, `${unique("invitee")}@example.test`, unique("tok"), owner.id],
    );

    const { rows: scanRows } = await pool.query<{ id: number }>(
      `INSERT INTO scan_history (user_id, team_id, url, status, started_at, scanned_at, scan_type)
       VALUES ($1, $2, $3, 'completed', NOW(), NOW(), 'web')
       RETURNING id`,
      [member.id, teamId, "https://team-scan.example.test/"],
    );
    const scanId = scanRows[0].id;

    const { rows: hookRows } = await pool.query<{ id: number }>(
      `INSERT INTO webhooks (user_id, team_id, url, name, type)
       VALUES ($1, $2, 'https://hooks.example.test/x', 'team hook', 'generic')
       RETURNING id`,
      [member.id, teamId],
    );
    const webhookId = hookRows[0].id;

    const { rows: scheduleRows } = await pool.query<{ id: number }>(
      `INSERT INTO scheduled_scans (user_id, team_id, url, frequency)
       VALUES ($1, $2, 'https://team-scan.example.test/', 'weekly')
       RETURNING id`,
      [member.id, teamId],
    );
    const scheduleId = scheduleRows[0].id;

    await pool.query("DELETE FROM teams WHERE id = $1", [teamId]);

    const countBy = async (table: string, id: number) => {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE id = $1`,
        [id],
      );
      return rows[0].n;
    };
    const teamRefs = async (table: string, id: number) => {
      const { rows } = await pool.query<{ team_id: number | null }>(
        `SELECT team_id FROM ${table} WHERE id = $1`,
        [id],
      );
      return rows[0]?.team_id ?? null;
    };

    // Gone with the team.
    const { rows: membership } = await pool.query<{ n: number }>(
      `SELECT
         (SELECT COUNT(*) FROM team_members WHERE team_id = $1)::int
       + (SELECT COUNT(*) FROM team_invites WHERE team_id = $1)::int AS n`,
      [teamId],
    );
    expect(membership[0].n).toBe(0);

    // Still the member's, just no longer shared.
    expect(await countBy("scan_history", scanId)).toBe(1);
    expect(await countBy("webhooks", webhookId)).toBe(1);
    expect(await countBy("scheduled_scans", scheduleId)).toBe(1);
    expect(await teamRefs("scan_history", scanId)).toBeNull();
    expect(await teamRefs("webhooks", webhookId)).toBeNull();
    expect(await teamRefs("scheduled_scans", scheduleId)).toBeNull();
  });
});
