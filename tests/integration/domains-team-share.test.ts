import { afterAll, beforeEach, expect, it, vi } from "vitest";
import pool from "@/lib/database/db";
import {
  clearSettings,
  createTeam,
  createUser,
  describeIntegration,
  setSettings,
  unique,
} from "./_db";

/**
 * What a team keeps of a member's things once that member is gone, against
 * the real schema (sec-authz-3, gap-domain-verification-active-gating-3).
 *
 * domains, scheduled_scans and webhooks carry a team_id, and nothing cleared
 * it when the person who shared them left or was removed. The team went on
 * holding a verified domain's active-probing, port-sweep and form-login grant,
 * and reading or editing that person's schedules and hooks. Two halves close
 * it, and both are only real against Postgres:
 *
 *   - the read side: getTeamResourceAccess and findVerifiedDomainForHost ask
 *     whether the row's owner is still on the row's team, an EXISTS a faked
 *     pool answers however it is scripted to;
 *   - the write side: DELETE /api/v3/teams/members clears team_id on the
 *     departing member's rows in the same transaction as the membership
 *     delete.
 *
 * The ownership transfer (PATCH /api/v3/teams { teamId, newOwnerId }) is here
 * too, because its whole claim is about the rows it leaves behind: one owner,
 * teams.owner_id agreeing with team_members, and nothing written at all when
 * the new owner's plan cannot hold the team.
 */

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: () => mockGetSession() };
});
// There is no request scope in a test to read the caller's address from, and
// without one the audit write is skipped (recordTeamAudit swallows it).
vi.mock("@/lib/api/request-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/request-utils")>()),
  getClientIp: async () => "203.0.113.20",
  getUserAgent: async () => "integration-test",
}));
// Mail is not what is under test, and there is no SMTP here.
const mockSendEmail = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return { ...actual, sendEmail: mockSendEmail };
});
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => undefined),
}));

const { getTeamResourceAccess } =
  await import("@/lib/auth/team-resource-access");
const { findVerifiedDomainForHost } = await import("@/lib/domains/scope");
const { DELETE: removeMember } =
  await import("@/app/api/v3/teams/members/route");
const { PATCH: patchTeam } = await import("@/app/api/v3/teams/route");

async function addMember(teamId: number, userId: number, role: string) {
  await pool.query(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)`,
    [teamId, userId, role],
  );
}

/**
 * U verified a domain and shared it, a schedule and a webhook with team T,
 * which X (a member, so allowed to scan under T) is also on.
 */
async function sharedSetup() {
  const owner = await createUser();
  const u = await createUser();
  const x = await createUser();
  const teamId = await createTeam(owner.id);
  await addMember(teamId, owner.id, "owner");
  await addMember(teamId, u.id, "member");
  await addMember(teamId, x.id, "member");

  const host = `${unique("zone")}.example.test`;
  const { rows: d } = await pool.query<{ id: number }>(
    `INSERT INTO domains (user_id, team_id, domain, status, verification_token, verified_at)
     VALUES ($1, $2, $3, 'verified', $4, NOW())
     RETURNING id`,
    [u.id, teamId, host, unique("tok").slice(-60)],
  );
  const { rows: s } = await pool.query<{ id: number }>(
    `INSERT INTO scheduled_scans (user_id, team_id, url, frequency)
     VALUES ($1, $2, $3, 'weekly')
     RETURNING id`,
    [u.id, teamId, `https://${host}/`],
  );
  const { rows: w } = await pool.query<{ id: number }>(
    `INSERT INTO webhooks (user_id, team_id, url, name, type)
     VALUES ($1, $2, 'https://hooks.example.test/x', 'shared hook', 'generic')
     RETURNING id`,
    [u.id, teamId],
  );
  return {
    owner,
    u,
    x,
    teamId,
    host,
    domainId: d[0].id,
    scheduleId: s[0].id,
    webhookId: w[0].id,
  };
}

async function teamIdOf(table: string, id: number) {
  const { rows } = await pool.query<{ team_id: number | null }>(
    `SELECT team_id FROM ${table} WHERE id = $1`,
    [id],
  );
  return rows[0]?.team_id ?? null;
}

function memberRequest(body: unknown) {
  return new Request("http://localhost/api/v3/teams/members", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function transferRequest(body: unknown) {
  return new Request("http://localhost/api/v3/teams", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describeIntegration(
  "a member's shared domain after they leave the team",
  () => {
    beforeEach(async () => {
      mockGetSession.mockReset();
      mockSendEmail.mockClear();
      await setSettings({ BILLING_ENABLED: false });
    });

    afterAll(async () => {
      await clearSettings();
    });

    it("is the teammate's to use only while its owner is on the team", async () => {
      const s = await sharedSetup();

      // The fixture really does grant X something before U goes.
      expect(
        (await findVerifiedDomainForHost(`app.${s.host}`, s.x.id))?.id,
      ).toBe(s.domainId);
      expect(
        (await getTeamResourceAccess(s.x.id, s.u.id, s.teamId)).canRead,
      ).toBe(true);

      // U goes the way a removal before this fix went: the membership row only,
      // every team_id left where it was. The read side alone has to hold.
      await pool.query(
        `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [s.teamId, s.u.id],
      );

      expect(
        await findVerifiedDomainForHost(`app.${s.host}`, s.x.id),
      ).toBeNull();
      expect(await getTeamResourceAccess(s.x.id, s.u.id, s.teamId)).toEqual({
        canRead: false,
        canWrite: false,
      });
      // U's own access never depended on the team.
      expect(
        (await findVerifiedDomainForHost(`app.${s.host}`, s.u.id))?.id,
      ).toBe(s.domainId);
    });

    it("is un-shared, with the schedule and the webhook, when an admin removes the member", async () => {
      const s = await sharedSetup();
      mockGetSession.mockResolvedValue({ userId: s.owner.id });

      const res = await removeMember(
        memberRequest({ teamId: s.teamId, userId: s.u.id }),
      );

      expect(res.status).toBe(200);
      expect(await teamIdOf("domains", s.domainId)).toBeNull();
      expect(await teamIdOf("scheduled_scans", s.scheduleId)).toBeNull();
      expect(await teamIdOf("webhooks", s.webhookId)).toBeNull();
      expect(
        await findVerifiedDomainForHost(`app.${s.host}`, s.x.id),
      ).toBeNull();
      expect(
        (await getTeamResourceAccess(s.x.id, s.u.id, s.teamId)).canRead,
      ).toBe(false);
    });

    it("is un-shared when the member leaves on their own", async () => {
      const s = await sharedSetup();
      mockGetSession.mockResolvedValue({ userId: s.u.id });

      const res = await removeMember(
        memberRequest({ teamId: s.teamId, userId: "self" }),
      );

      expect(res.status).toBe(200);
      expect(await teamIdOf("domains", s.domainId)).toBeNull();
      expect(await teamIdOf("scheduled_scans", s.scheduleId)).toBeNull();
      expect(await teamIdOf("webhooks", s.webhookId)).toBeNull();
    });

    it("leaves what the member shared with another team alone", async () => {
      const s = await sharedSetup();
      const other = await createTeam(s.owner.id);
      await addMember(other, s.owner.id, "owner");
      await addMember(other, s.u.id, "member");
      await pool.query(`UPDATE webhooks SET team_id = $1 WHERE id = $2`, [
        other,
        s.webhookId,
      ]);
      mockGetSession.mockResolvedValue({ userId: s.owner.id });

      await removeMember(memberRequest({ teamId: s.teamId, userId: s.u.id }));

      expect(await teamIdOf("domains", s.domainId)).toBeNull();
      expect(await teamIdOf("webhooks", s.webhookId)).toBe(other);
    });
  },
);

describeIntegration("transferring a team's ownership", () => {
  beforeEach(async () => {
    mockGetSession.mockReset();
    mockSendEmail.mockClear();
    await setSettings({ BILLING_ENABLED: false });
  });

  afterAll(async () => {
    await clearSettings();
  });

  async function roles(teamId: number) {
    const { rows } = await pool.query<{ user_id: number; role: string }>(
      `SELECT user_id, role FROM team_members WHERE team_id = $1 ORDER BY user_id`,
      [teamId],
    );
    return Object.fromEntries(rows.map((r) => [r.user_id, r.role]));
  }

  async function ownerIdOf(teamId: number) {
    const { rows } = await pool.query<{ owner_id: number }>(
      `SELECT owner_id FROM teams WHERE id = $1`,
      [teamId],
    );
    return rows[0].owner_id;
  }

  it("swaps the two roles, moves owner_id and writes one audit row", async () => {
    const owner = await createUser();
    const next = await createUser();
    const teamId = await createTeam(owner.id);
    await addMember(teamId, owner.id, "owner");
    await addMember(teamId, next.id, "viewer");
    mockGetSession.mockResolvedValue({ userId: owner.id });

    const res = await patchTeam(
      transferRequest({ teamId, newOwnerId: next.id }),
    );

    expect(res.status).toBe(200);
    expect(await roles(teamId)).toEqual({
      [owner.id]: "admin",
      [next.id]: "owner",
    });
    expect(await ownerIdOf(teamId)).toBe(next.id);
    const { rows: audit } = await pool.query<{
      admin_id: number;
      target_user_id: number;
    }>(
      `SELECT admin_id, target_user_id FROM admin_audit_log
        WHERE action = 'team.ownership_transferred' AND target_user_id = $1`,
      [next.id],
    );
    expect(audit).toEqual([{ admin_id: owner.id, target_user_id: next.id }]);
  });

  it("writes nothing when the target is not on the team", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const teamId = await createTeam(owner.id);
    await addMember(teamId, owner.id, "owner");
    mockGetSession.mockResolvedValue({ userId: owner.id });

    const res = await patchTeam(
      transferRequest({ teamId, newOwnerId: stranger.id }),
    );

    expect(res.status).toBe(400);
    expect(await roles(teamId)).toEqual({ [owner.id]: "owner" });
    expect(await ownerIdOf(teamId)).toBe(owner.id);
  });

  it("writes nothing when the team is over the new owner's seat cap", async () => {
    await setSettings({ BILLING_ENABLED: true });
    const owner = await createUser({ plan: "elite_supporter" });
    // pro_supporter: 3 seats, and the team below has 4 members.
    const next = await createUser({ plan: "pro_supporter" });
    const teamId = await createTeam(owner.id);
    await addMember(teamId, owner.id, "owner");
    await addMember(teamId, next.id, "admin");
    for (let i = 0; i < 2; i++) {
      await addMember(teamId, (await createUser()).id, "viewer");
    }
    mockGetSession.mockResolvedValue({ userId: owner.id });

    const res = await patchTeam(
      transferRequest({ teamId, newOwnerId: next.id }),
    );

    expect(res.status).toBe(409);
    expect((await roles(teamId))[owner.id]).toBe("owner");
    expect((await roles(teamId))[next.id]).toBe("admin");
    expect(await ownerIdOf(teamId)).toBe(owner.id);
  });

  it("leaves exactly one owner when two transfers race", async () => {
    const owner = await createUser();
    const a = await createUser();
    const b = await createUser();
    const teamId = await createTeam(owner.id);
    await addMember(teamId, owner.id, "owner");
    await addMember(teamId, a.id, "admin");
    await addMember(teamId, b.id, "admin");
    mockGetSession.mockResolvedValue({ userId: owner.id });

    const results = await Promise.all([
      patchTeam(transferRequest({ teamId, newOwnerId: a.id })),
      patchTeam(transferRequest({ teamId, newOwnerId: b.id })),
    ]);

    // The loser answers 409 when it read the owner's role before the winner
    // committed and then found the lock moved, or 403 when the winner had
    // already committed by the time it read the role. Which one depends on
    // scheduling; what must never happen is two 200s.
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const after = await roles(teamId);
    const owners = Object.entries(after).filter(([, r]) => r === "owner");
    expect(owners).toHaveLength(1);
    expect(await ownerIdOf(teamId)).toBe(Number(owners[0][0]));
  });

  it("never removes the member a racing transfer made the owner", async () => {
    // The admin's removal reads A's role before the transfer commits. Without
    // the locked re-read in the removal, it then deleted the new owner's
    // membership and left teams.owner_id naming someone not on the team.
    const owner = await createUser();
    const admin = await createUser();
    const a = await createUser();
    const teamId = await createTeam(owner.id);
    await addMember(teamId, owner.id, "owner");
    await addMember(teamId, admin.id, "admin");
    await addMember(teamId, a.id, "member");
    mockGetSession
      .mockResolvedValueOnce({ userId: owner.id })
      .mockResolvedValueOnce({ userId: admin.id });

    await Promise.all([
      patchTeam(transferRequest({ teamId, newOwnerId: a.id })),
      removeMember(memberRequest({ teamId, userId: a.id })),
    ]);

    const after = await roles(teamId);
    const owners = Object.entries(after).filter(([, r]) => r === "owner");
    expect(owners).toHaveLength(1);
    expect(await ownerIdOf(teamId)).toBe(Number(owners[0][0]));
  });
});
