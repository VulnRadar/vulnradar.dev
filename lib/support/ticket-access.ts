import "server-only";

import pool from "@/lib/database/db";
import {
  hasStaffPermission,
  STAFF_PERMISSIONS,
} from "@/lib/auth/permissions-client";

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
 */
export async function resolveTicketAccess(opts: {
  ticketOwnerId: number;
  ticketId: number;
  viewerId: number;
  viewerRole: string;
}): Promise<TicketAccess> {
  const isOwner = opts.ticketOwnerId === opts.viewerId;
  const isStaff = hasStaffPermission(
    opts.viewerRole,
    STAFF_PERMISSIONS.MANAGE_SUPPORT_TICKETS,
  );
  let isShared = false;
  if (!isOwner && !isStaff) {
    const r = await pool.query(
      `SELECT 1 FROM support_ticket_shares
       WHERE ticket_id = $1 AND shared_with_user_id = $2 LIMIT 1`,
      [opts.ticketId, opts.viewerId],
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
