import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import {
  requireAdmin,
  logAction,
  isSuperAdminRole,
} from "@/lib/auth/authorization";
import { getClientIp } from "@/lib/api/request-utils";
import { sendEmail, staffInviteEmail } from "@/lib/email/email";
import {
  ApiResponse,
  parseBody,
  Validate,
  withErrorHandling,
} from "@/lib/api/api-utils";
import {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  APP_URL,
} from "@/lib/config/constants";
import {
  ensureStaffInvitesTable,
  generateStaffInviteToken,
  hashStaffInviteToken,
  staffInviteExpiresAt,
} from "@/lib/admin/staff-invites";

/**
 * POST /api/v3/admin/staff-invites -- create + email a staff invite
 * (AUDIT-010 admin-feature-gap). Admin-gated: only an admin (or the
 * super_admin) may hand out staff roles this way.
 *
 * Roles an admin can invite someone directly into. super_admin is
 * deliberately excluded, same as app/api/v3/admin/route.ts's set_role
 * case -- it is only ever granted by the first-user bootstrap in
 * lib/auth/auth.ts::createUser.
 */
const INVITABLE_ROLES: string[] = [
  STAFF_ROLES.SUPPORT,
  STAFF_ROLES.BILLING,
  STAFF_ROLES.SECURITY_ANALYST,
  STAFF_ROLES.CONTENT_MANAGER,
  STAFF_ROLES.OPS,
  STAFF_ROLES.MODERATOR,
  STAFF_ROLES.ADMIN,
];

export const POST = withErrorHandling(async (request: NextRequest) => {
  const admin = await requireAdmin();
  // Match the 401 convention every other admin-only route file in this
  // codebase uses for requireAdmin()/requireStaff() (see
  // app/api/v3/admin/blocked-data/route.ts) -- requireAdmin() already
  // collapses "not logged in" and "insufficient role" into the same null
  // return, so both cases read the same to the caller.
  if (!admin) return ApiResponse.unauthorized("Admins only.");

  const parsed = await parseBody<{ email?: string; role?: string }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);

  const email =
    typeof parsed.data.email === "string"
      ? parsed.data.email.trim().toLowerCase()
      : "";
  const role = typeof parsed.data.role === "string" ? parsed.data.role : "";

  const validationError = Validate.multiple([
    Validate.required(email, "Email"),
    Validate.email(email),
  ]);
  if (validationError) return ApiResponse.badRequest(validationError);
  if (!INVITABLE_ROLES.includes(role)) {
    return ApiResponse.badRequest("Invalid staff role.");
  }

  await ensureStaffInvitesTable();

  const existingUser = await pool.query<{ id: number; role: string }>(
    "SELECT id, role FROM users WHERE email = $1",
    [email],
  );
  // super-admin: same blanket protection app/api/v3/admin/route.ts's PATCH
  // handler gives the designated first-user account -- no admin-panel path
  // may modify it except the super_admin acting on themselves. Without this,
  // any plain admin could invite the super_admin's own email into a lower
  // INVITABLE_ROLES tier and, if the invite is ever accepted, silently
  // demote them (accepting an invite for an existing account doesn't
  // require re-authenticating as that account, see the POST handler in
  // app/api/v3/auth/staff-invite/[token]/route.ts).
  if (isSuperAdminRole(existingUser.rows[0]?.role)) {
    return ApiResponse.forbidden("This account cannot be modified.");
  }
  if (existingUser.rows[0]?.role === role) {
    return ApiResponse.badRequest("This user already holds that role.");
  }

  const existingInvite = await pool.query(
    `SELECT id FROM staff_invites
     WHERE email = $1 AND accepted_at IS NULL AND expires_at > NOW()`,
    [email],
  );
  if (existingInvite.rows.length > 0) {
    return ApiResponse.badRequest(
      "An invite is already pending for this email.",
    );
  }

  const token = generateStaffInviteToken();
  const tokenHash = hashStaffInviteToken(token);
  const expiresAt = staffInviteExpiresAt();

  const insertRes = await pool.query<{ id: number }>(
    `INSERT INTO staff_invites (token, email, role, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tokenHash, email, role, admin.id, expiresAt],
  );
  const inviteId = insertRes.rows[0].id;

  // audit-log: trusted client IP only.
  const ip = (await getClientIp()) || undefined;
  await logAction(
    admin.id,
    existingUser.rows[0]?.id ?? null,
    "staff_invite_sent",
    `Invited ${email} to staff role "${role}"`,
    ip,
  );

  const inviterRes = await pool.query<{ name: string | null; email: string }>(
    "SELECT name, email FROM users WHERE id = $1",
    [admin.id],
  );
  const invitedByName =
    inviterRes.rows[0]?.name || inviterRes.rows[0]?.email || "An administrator";
  const inviteLink = `${APP_URL}/staff-invite/${token}`;
  const emailPayload = staffInviteEmail(
    STAFF_ROLE_LABELS[role] || role,
    inviteLink,
    invitedByName,
  );

  // Failure to send the email shouldn't fail the whole request -- the
  // invite row already exists and the admin can see it failed via the
  // system error log (see instrumentation.ts's installErrorLogCapture).
  try {
    await sendEmail({ to: email, ...emailPayload });
  } catch (err) {
    console.error("Staff invite email failed:", err);
  }

  return ApiResponse.success({ success: true, inviteId, expiresAt });
});

interface PendingInviteRow {
  id: number;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  invited_by_name: string | null;
  invited_by_email: string | null;
}

/**
 * GET /api/v3/admin/staff-invites -- list the invites that are still
 * outstanding (never accepted, not yet expired). Same admin gate the POST
 * uses: only an admin (or the super_admin) can see who has a pending staff
 * invite, since the list is a map of who is about to gain a staff role.
 *
 * Accepted or expired rows are deliberately omitted -- there is nothing to
 * act on for them, and an accepted invite's role change already shows up in
 * the staff directory.
 */
export const GET = withErrorHandling(async () => {
  const admin = await requireAdmin();
  if (!admin) return ApiResponse.unauthorized("Admins only.");

  await ensureStaffInvitesTable();

  const { rows } = await pool.query<PendingInviteRow>(
    `SELECT si.id, si.email, si.role, si.created_at, si.expires_at,
            u.name AS invited_by_name, u.email AS invited_by_email
       FROM staff_invites si
       LEFT JOIN users u ON u.id = si.invited_by
      WHERE si.accepted_at IS NULL AND si.expires_at > NOW()
      ORDER BY si.created_at DESC`,
  );

  return ApiResponse.success({ invites: rows });
});

/**
 * DELETE /api/v3/admin/staff-invites -- revoke a pending invite by id. The
 * emailed token is single-use and only ever validated against the row (its
 * SHA-256 hash), so deleting the row is the revoke: the link in the email
 * stops resolving the moment the row is gone. Same admin gate as POST/GET.
 *
 * Only a still-pending row can be revoked -- an already-accepted invite has
 * nothing left to cancel (the role was granted at accept time, and undoing
 * that is a separate staff-directory action, not an invite revoke).
 */
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const admin = await requireAdmin();
  if (!admin) return ApiResponse.unauthorized("Admins only.");

  const parsed = await parseBody<{ id?: number }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);

  const id =
    typeof parsed.data.id === "number" ? parsed.data.id : Number(parsed.data.id);
  if (!Number.isInteger(id) || id <= 0) {
    return ApiResponse.badRequest("A valid invite id is required.");
  }

  await ensureStaffInvitesTable();

  const deleted = await pool.query<{ email: string; role: string }>(
    `DELETE FROM staff_invites
      WHERE id = $1 AND accepted_at IS NULL
      RETURNING email, role`,
    [id],
  );
  if (deleted.rows.length === 0) {
    return ApiResponse.notFound("No pending invite with that id.");
  }

  const { email, role } = deleted.rows[0];
  const ip = (await getClientIp()) || undefined;
  await logAction(
    admin.id,
    null,
    "staff_invite_revoked",
    `Revoked pending staff invite for ${email} (role "${role}")`,
    ip,
  );

  return ApiResponse.success({ success: true, id });
});
