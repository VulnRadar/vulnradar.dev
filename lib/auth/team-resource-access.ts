import pool from "@/lib/database/db";
import { TEAM_ROLE_PERMISSIONS } from "@/lib/config/constants";
import { hasGodMode } from "@/lib/auth/permissions-client";

export interface TeamResourceAccess {
  canRead: boolean;
  canWrite: boolean;
}

/**
 * Whether a team role grants a given team permission. Uses the existing
 * TEAM_ROLE_PERMISSIONS map (lib/config/constants.ts) -- defined for the
 * client-side teams UI but never actually wired into a server-side check
 * until this. "manage_scans" is granted to owner/admin/member, not viewer;
 * "view_reports" is granted to all four roles.
 */
function hasTeamPermission(
  role: string | undefined,
  permission: string,
): boolean {
  if (!role) return false;
  const perms =
    TEAM_ROLE_PERMISSIONS[role as keyof typeof TEAM_ROLE_PERMISSIONS];
  return Array.isArray(perms) && perms.includes(permission);
}

/**
 * Whether `callerId` may read/write a resource (a scan, API key, webhook,
 * or scheduled scan) created by `resourceOwnerId` and optionally assigned
 * to `resourceTeamId`.
 *
 * - The resource's own creator always has full access, independent of
 *   team membership.
 * - `resourceTeamId` null: only the owner has access -- personal
 *   resources are unaffected by any of this.
 * - `resourceTeamId` set: any co-member of that team can read
 *   ("view_reports", granted to all 4 team roles including viewer);
 *   owner/admin/member-role co-members (everyone except viewer, via
 *   "manage_scans") can also write.
 * - GOD_MODE exception: if the resource's owner is a super_admin, no
 *   team role grants write access to anyone but the owner -- team
 *   sharing must never become a side-channel for altering a
 *   super_admin's own resources. Read access is unaffected; sharing a
 *   resource into a team is what makes it visible to that team at all.
 */
export async function getTeamResourceAccess(
  callerId: number,
  resourceOwnerId: number,
  resourceTeamId: number | null,
): Promise<TeamResourceAccess> {
  if (callerId === resourceOwnerId) return { canRead: true, canWrite: true };
  if (!resourceTeamId) return { canRead: false, canWrite: false };

  const memberRes = await pool.query<{ role: string }>(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [resourceTeamId, callerId],
  );
  const callerRole = memberRes.rows[0]?.role;
  if (!callerRole) return { canRead: false, canWrite: false };

  const canRead = hasTeamPermission(callerRole, "view_reports");
  if (!canRead) return { canRead: false, canWrite: false };

  const ownerRes = await pool.query<{ role: string | null }>(
    "SELECT role FROM users WHERE id = $1",
    [resourceOwnerId],
  );
  if (hasGodMode(ownerRes.rows[0]?.role)) {
    return { canRead: true, canWrite: false };
  }

  return {
    canRead: true,
    canWrite: hasTeamPermission(callerRole, "manage_scans"),
  };
}

/**
 * Every team_id the caller may assign a NEW resource to: teams where
 * their own role grants "manage_scans" (owner/admin/member -- a viewer
 * can see team-scoped resources but never create one under the team).
 */
export async function getAssignableTeamIds(
  callerId: number,
): Promise<number[]> {
  const res = await pool.query<{ team_id: number; role: string }>(
    "SELECT team_id, role FROM team_members WHERE user_id = $1",
    [callerId],
  );
  return res.rows
    .filter((r) => hasTeamPermission(r.role, "manage_scans"))
    .map((r) => r.team_id);
}
