import { it, expect, vi } from "vitest";
import pool from "@/lib/database/db";
import { describeIntegration, createUser, createTeam } from "./_db";
import { seedTicket } from "./_tickets";

/**
 * Who may read a support ticket, against the real schema.
 *
 * A ticket shared with a teammate is readable on the strength of two rows: the
 * support_ticket_shares row the owner wrote, and a team_members join that says
 * the two are STILL on a team together. Nothing deletes the share row when the
 * membership ends, so the join is the only thing that makes "removed from the
 * team" mean "can no longer read the thread". The unit tier fakes pool.query,
 * so it can show the SQL names team_members and cannot show that Postgres
 * answers an ex-teammate with no row.
 */

vi.mock("server-only", () => ({}));
// ticket-access imports the staff gate from here for viewerIsSupportStaff,
// which this suite does not call; the real module drags in the session layer.
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: async () => null,
}));

const { resolveTicketAccess } = await import("@/lib/support/ticket-access");

async function addMember(teamId: number, userId: number): Promise<void> {
  await pool.query(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'member')`,
    [teamId, userId],
  );
}

async function share(
  ticketId: number,
  withUserId: number,
  byUserId: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO support_ticket_shares (ticket_id, shared_with_user_id, shared_by_user_id)
     VALUES ($1, $2, $3)`,
    [ticketId, withUserId, byUserId],
  );
}

function accessFor(
  ticketId: number,
  ownerId: number,
  viewerId: number,
  isStaff = false,
) {
  return resolveTicketAccess({
    ticketOwnerId: ownerId,
    ticketId,
    viewerId,
    isStaff,
  });
}

/** An owner, a teammate on the same team, and a ticket shared with that teammate. */
async function sharedTicket() {
  const owner = await createUser();
  const mate = await createUser();
  const teamId = await createTeam(owner.id);
  await addMember(teamId, owner.id);
  await addMember(teamId, mate.id);
  const ticketId = await seedTicket(owner.id, {
    subject: "private thread",
    lastMessageAt: "2026-03-01 10:00:00+00",
  });
  await share(ticketId, mate.id, owner.id);
  return { owner, mate, teamId, ticketId };
}

describeIntegration("ticket access for a teammate it was shared with", () => {
  it("lets a current teammate read and reply", async () => {
    const { owner, mate, ticketId } = await sharedTicket();

    const access = await accessFor(ticketId, owner.id, mate.id);

    expect(access).toEqual({
      isOwner: false,
      isStaff: false,
      isShared: true,
      canView: true,
    });
  });

  it("loses access once the teammate is removed from team_members", async () => {
    const { owner, mate, teamId, ticketId } = await sharedTicket();
    expect((await accessFor(ticketId, owner.id, mate.id)).canView).toBe(true);

    await pool.query(
      `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, mate.id],
    );

    const access = await accessFor(ticketId, owner.id, mate.id);
    expect(access.isShared).toBe(false);
    expect(access.canView).toBe(false);
    // The share row is still there: it is the membership that decides.
    const { rows } = await pool.query(
      `SELECT 1 FROM support_ticket_shares WHERE ticket_id = $1 AND shared_with_user_id = $2`,
      [ticketId, mate.id],
    );
    expect(rows).toHaveLength(1);
  });

  it("loses access when it is the owner who leaves the team", async () => {
    const { owner, mate, teamId, ticketId } = await sharedTicket();

    await pool.query(
      `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, owner.id],
    );

    expect((await accessFor(ticketId, owner.id, mate.id)).canView).toBe(false);
  });

  it("loses access when the team itself is deleted", async () => {
    const { owner, mate, teamId, ticketId } = await sharedTicket();

    await pool.query(`DELETE FROM teams WHERE id = $1`, [teamId]);

    expect((await accessFor(ticketId, owner.id, mate.id)).canView).toBe(false);
  });

  it("keeps access while they still share a different team", async () => {
    const { owner, mate, teamId, ticketId } = await sharedTicket();
    const second = await createTeam(owner.id);
    await addMember(second, owner.id);
    await addMember(second, mate.id);

    await pool.query(
      `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, mate.id],
    );

    expect((await accessFor(ticketId, owner.id, mate.id)).canView).toBe(true);
  });

  it("gives a teammate nothing when no share row names them", async () => {
    const { owner, teamId, ticketId } = await sharedTicket();
    const other = await createUser();
    await addMember(teamId, other.id);

    const access = await accessFor(ticketId, owner.id, other.id);

    expect(access.canView).toBe(false);
  });

  it("gives a share row nothing when the two never shared a team", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const ticketId = await seedTicket(owner.id, {
      subject: "shared across no team",
      lastMessageAt: "2026-03-01 10:00:00+00",
    });
    await share(ticketId, stranger.id, owner.id);

    expect((await accessFor(ticketId, owner.id, stranger.id)).canView).toBe(
      false,
    );
  });

  it("always lets the owner and the staff in, with no share or team involved", async () => {
    const owner = await createUser();
    const staff = await createUser();
    const ticketId = await seedTicket(owner.id, {
      subject: "mine",
      lastMessageAt: "2026-03-01 10:00:00+00",
    });

    expect((await accessFor(ticketId, owner.id, owner.id)).canView).toBe(true);
    expect((await accessFor(ticketId, owner.id, staff.id, true)).canView).toBe(
      true,
    );
  });
});
