import "server-only";

import pool from "@/lib/database/db";

export interface TicketAccess {
  isOwner: boolean;
  isStaff: boolean;
  /** A teammate the owner explicitly shared this ticket with. */
  isShared: boolean;
  /** May read the thread and reply. (Only owner/staff may change status/shares.) */
  canView: boolean;
}

/**
 * Who the viewer is relative to one ticket: its owner, a staffer with
 * MANAGE_SUPPORT_TICKETS, and/or a teammate it was explicitly shared with.
 * The shares lookup is skipped when the viewer is already owner or staff.
 *
 * `isStaff` is passed in, already decided, rather than derived here from a raw
 * session role. Deciding it here with a bare hasStaffPermission(role, ...) call
 * skipped passesTwoFactorEnforcement, so with ENFORCE_STAFF_2FA on, a staff
 * account with no 2FA was locked out of /api/v3/admin entirely yet could still
 * read every customer's full support thread (owner email included) and send
 * outbound mail to customers under the product's support identity. Callers must
 * compute it with requirePermission(STAFF_PERMISSIONS.MANAGE_SUPPORT_TICKETS),
 * which applies that gate; the raw-role path deliberately no longer exists.
 */
export async function resolveTicketAccess(opts: {
  ticketOwnerId: number;
  ticketId: number;
  viewerId: number;
  isStaff: boolean;
}): Promise<TicketAccess> {
  const isOwner = opts.ticketOwnerId === opts.viewerId;
  const isStaff = opts.isStaff;
  let isShared = false;
  if (!isOwner && !isStaff) {
    // The teammate relationship is re-checked HERE, not just at share time.
    // Sharing is restricted to teammates when the row is written, but nothing
    // deletes the row when the membership that justified it ends: removing
    // someone from a team (or deleting the team) touches team_members only,
    // and support_ticket_shares has no team column for the cascade to reach.
    // Granting access on the bare existence of the row let an ex-teammate keep
    // reading and replying to a private ticket forever, still appearing to the
    // owner as a current teammate. Same self-join areTeammates uses.
    const r = await pool.query(
      `SELECT 1 FROM support_ticket_shares s
        WHERE s.ticket_id = $1
          AND s.shared_with_user_id = $2
          AND EXISTS (
                SELECT 1 FROM team_members a
                JOIN team_members b ON a.team_id = b.team_id
                WHERE a.user_id = $3 AND b.user_id = $2
              )
        LIMIT 1`,
      [opts.ticketId, opts.viewerId, opts.ticketOwnerId],
    );
    isShared = r.rows.length > 0;
  }
  return {
    isOwner,
    isStaff,
    isShared,
    canView: isOwner || isStaff || isShared,
  };
}

/**
 * True when two users share at least one team. Every team member (owner
 * included) has a team_members row, so a self-join on team_id captures the
 * full set of teammates. Used to gate who a ticket can be shared with: only a
 * teammate, never an arbitrary account, and the owner picks each one.
 */
export async function areTeammates(
  userA: number,
  userB: number,
): Promise<boolean> {
  if (userA === userB) return false;
  const r = await pool.query(
    `SELECT 1 FROM team_members a
     JOIN team_members b ON a.team_id = b.team_id
     WHERE a.user_id = $1 AND b.user_id = $2 LIMIT 1`,
    [userA, userB],
  );
  return r.rows.length > 0;
}
