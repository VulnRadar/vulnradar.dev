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
