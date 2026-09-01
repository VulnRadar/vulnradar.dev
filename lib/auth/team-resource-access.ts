import pool from "@/lib/database/db";
import { hasTeamPermission } from "@/lib/config/constants";
import { hasGodMode } from "@/lib/auth/permissions-client";

export interface TeamResourceAccess {
  canRead: boolean;
  canWrite: boolean;
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

export type ResolvedTeamAssignment =
  { ok: true; teamId: number | null } | { ok: false; error: string };

/**
 * Validate a caller-supplied `teamId` for a resource that is being CREATED,
 * the counterpart to the PATCH-time check in
 * app/api/v3/history/[id]/route.ts.
 *
 * Until this existed no scan-creation path wrote scan_history.team_id at
 * all, so every team read path (GET /api/v3/teams/member-scans, every
 * getTeamResourceAccess team branch) matched zero rows and team scan
 * sharing was dead end to end.
 *
 * Omitted/null means a personal scan, which stays the default: a scan is
 * only ever shared with a team because the request said so, never because
 * the caller happens to be in one. A supplied id is checked against
 * getAssignableTeamIds rather than trusted, since assigning a scan to a
 * team the caller does not manage would publish it to strangers.
 */
export async function resolveNewResourceTeamId(
  callerId: number,
  requested: unknown,
): Promise<ResolvedTeamAssignment> {
  if (requested === undefined || requested === null) {
    return { ok: true, teamId: null };
  }
  if (!Number.isInteger(requested) || (requested as number) <= 0) {
    return {
      ok: false,
      error: "Invalid teamId. Use a team id, or omit it for a personal scan.",
    };
  }
  const teamId = requested as number;
  const assignable = await getAssignableTeamIds(callerId);
  if (!assignable.includes(teamId)) {
    return { ok: false, error: "You cannot assign scans to that team." };
  }
  return { ok: true, teamId };
}
