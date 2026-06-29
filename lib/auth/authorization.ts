import { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/lib/api/api-utils";
import { STAFF_ROLE_HIERARCHY, TEAM_ROLES } from "@/lib/config/constants";

type AuthError = NextResponse | undefined;

/**
 * R3/D1: Admin role helpers — single source of truth for admin/staff
 * role checks. Returns the session augmented with `id` and `role`, or
 * null when the caller is unauthenticated or lacks the required role.
 *
 * Each handler should pair this with an early-return:
 *   const admin = await requireStaff();
 *   if (!admin) return ApiResponse.forbidden("Staff only");
 */
export async function requireStaff() {
  const session = await getSession();
  if (!session) return null;
  const result = await pool.query("SELECT role FROM users WHERE id = $1", [
    session.userId,
  ]);
  const user = result.rows[0] as { role?: string } | undefined;
  if (!user) return null;
  const role = user.role || "user";
  if ((STAFF_ROLE_HIERARCHY[role] || 0) < (STAFF_ROLE_HIERARCHY.support || 1)) {
    return null;
  }
  return { ...session, role };
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session) return null;
  const result = await pool.query("SELECT id, role FROM users WHERE id = $1", [
    session.userId,
  ]);
  const user = result.rows[0] as { id: number; role?: string } | undefined;
  if (!user) return null;
  const role = user.role || "user";
  if ((STAFF_ROLE_HIERARCHY[role] || 0) < (STAFF_ROLE_HIERARCHY.admin || 3)) {
    return null;
  }
  return { ...session, id: user.id, role };
}

/**
 * audit-log: mask an email before it is persisted into
 * admin_audit_log.details or any other long-retention audit field.
 * The mask is lossy (a***@example.com) but preserves the domain for
 * audit purposes. Avoids storing full plaintext email in a TEXT
 * column with 365-day retention, which leaked old emails even after
 * the user deleted their account or changed their address.
 *
 * Callers should prefer passing user_id and looking up the current
 * email separately. Use this helper only when a human-readable
 * description needs to reference the user inline.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email || typeof email !== "string") return "[unknown]";
  const at = email.indexOf("@");
  if (at <= 0) return "[masked]";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visibleLocal =
    local.length <= 2
      ? local
      : local.slice(0, 1) +
        "*".repeat(Math.max(1, local.length - 2)) +
        local.slice(-1);
  return `${visibleLocal}@${domain}`;
}

/**
 * audit-log: replace any email-like substring in `details` with
 * maskEmail(email). Catches the case where a caller builds a
 * details string via template literal like
 * `Granted admin to ${targetUser.email}` and forgot to mask.
 *
 * The regex matches the RFC-5322-lite pattern (local@domain.tld)
 * and is conservative — false positives are possible but in
 * audit-log context that's preferable to a real email leak.
 */
const EMAIL_PATTERN =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}\b/g;
export function redactEmailsInDetails(
  details: string | null | undefined,
): string | null {
  if (!details) return null;
  return details.replace(EMAIL_PATTERN, (match) => maskEmail(match));
}

/**
 * R3/D1: Audit-log helper — replaces the ~5 local `logAction` copies
 * scattered across admin route files. Callers should use this for any
 * state-changing admin action so the admin_audit_log stays consistent.
 */
export async function logAuditAction(
  adminId: number,
  targetUserId: number | null,
  action: string,
  details?: string,
  ip?: string,
): Promise<void> {
  // audit-log: mask any emails embedded in the details string
  // before persisting.
  await pool.query(
    "INSERT INTO admin_audit_log (admin_id, target_user_id, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)",
    [adminId, targetUserId, action, redactEmailsInDetails(details), ip || null],
  );
}

// R3/D1: backward-compatible alias — admin route files already import
// `logAction`. Keep the call-site name identical so callers don't need
// to rename 60+ invocations.
export { logAuditAction as logAction };

/**
 * Whitelist of resources that can be checked for ownership.
 * Adding a new resource here is the ONLY way to introduce a new
 * table/column pair to verifyOwnership — there is no longer any
 * way for callers to interpolate arbitrary SQL identifiers.
 */
const OWNERSHIP = {
  scan_history: { ownerCol: "user_id" },
  api_keys: { ownerCol: "user_id" },
  shares: { ownerCol: "user_id" },
  schedules: { ownerCol: "user_id" },
  webhooks: { ownerCol: "user_id" },
  notifications: { ownerCol: "user_id" },
  sessions: { ownerCol: "user_id" },
  teams: { ownerCol: "owner_id" },
} as const satisfies Record<string, { ownerCol: string }>;

export type OwnableResource = keyof typeof OWNERSHIP;

/**
 * Common authorization checks for resource ownership
 */

/**
 * Verify user owns a resource (scan history, team, etc.).
 *
 * Security: resource must be one of the whitelisted OwnableResource
 * keys; userIdColumn is derived from the whitelist (no caller
 * interpolation). This eliminates the SQL-injection vector that
 * existed when both arguments were concatenated as raw SQL.
 */
export async function verifyOwnership(
  resource: OwnableResource,
  resourceId: number,
  userId: number,
): Promise<{ owned: boolean; error?: AuthError }> {
  const { ownerCol } = OWNERSHIP[resource];
  try {
    const result = await pool.query(
      `SELECT id FROM ${resource} WHERE id = $1 AND ${ownerCol} = $2`,
      [resourceId, userId],
    );

    return {
      owned: result.rows.length > 0,
    };
  } catch (error) {
    return {
      owned: false,
      error: ApiResponse.serverError("Failed to verify ownership"),
    };
  }
}

/**
 * Verify user is member of a team
 */
export async function verifyTeamMembership(
  teamId: number,
  userId: number,
  requiredRole?: string,
): Promise<{ isMember: boolean; role?: string; error?: AuthError }> {
  try {
    const result = await pool.query(
      `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId],
    );

    if (result.rows.length === 0) {
      return { isMember: false };
    }

    const { role } = result.rows[0] as { role?: string };

    if (requiredRole) {
      const roleHierarchy: Record<string, number> = {
        [TEAM_ROLES.OWNER]: 3,
        [TEAM_ROLES.ADMIN]: 2,
        [TEAM_ROLES.MEMBER]: 1,
      };

      if (
        (roleHierarchy[role || ""] || 0) < (roleHierarchy[requiredRole] || 0)
      ) {
        return {
          isMember: true,
          role,
          error: ApiResponse.forbidden(`Requires ${requiredRole} role`),
        };
      }
    }

    return { isMember: true, role };
  } catch (error) {
    return {
      isMember: false,
      error: ApiResponse.serverError("Failed to verify team membership"),
    };
  }
}

/**
 * Verify user has permission (owner/admin) in team
 */
export async function verifyTeamAdmin(
  teamId: number,
  userId: number,
): Promise<{ isAdmin: boolean; error?: AuthError }> {
  const result = await verifyTeamMembership(teamId, userId, TEAM_ROLES.ADMIN);
  return {
    isAdmin:
      result.isMember &&
      [TEAM_ROLES.OWNER, TEAM_ROLES.ADMIN].includes(result.role || ""),
    error: result.error,
  };
}

/**
 * Verify user is team owner
 */
export async function verifyTeamOwner(
  teamId: number,
  userId: number,
): Promise<{ isOwner: boolean; error?: AuthError }> {
  const result = await verifyTeamMembership(teamId, userId, TEAM_ROLES.OWNER);
  return {
    isOwner: result.isMember && result.role === TEAM_ROLES.OWNER,
    error: result.error,
  };
}

/**
 * Get user's role in a team
 */
export async function getUserTeamRole(
  teamId: number,
  userId: number,
): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId],
    );
    return result.rows[0]?.role || null;
  } catch {
    return null;
  }
}
