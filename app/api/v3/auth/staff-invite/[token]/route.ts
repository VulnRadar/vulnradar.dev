import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import pool from "@/lib/database/db";
import { hashPassword, getUserByEmail } from "@/lib/auth";
import { logAction, isSuperAdminRole } from "@/lib/auth/authorization";
import { getClientIp } from "@/lib/api/request-utils";
import {
  analyzePassword,
  checkPasswordRequirements,
  passwordRequirementsMet,
  unmetRequirementLabels,
  meetsMinimumPasswordScore,
} from "@/lib/auth/password-strength";
import {
  ApiResponse,
  parseBody,
  Validate,
  withErrorHandling,
} from "@/lib/api/api-utils";
import { getSetting } from "@/lib/config/runtime-config";
import { STAFF_ROLE_LABELS } from "@/lib/config/constants";

/**
 * Public accept endpoints for a staff invite (AUDIT-010 admin-feature-gap).
 * See app/api/v3/admin/staff-invites/route.ts for how invites are created,
 * and lib/admin/staff-invites.ts for the table shape / token helpers.
 *
 * GET  -- validate a token for the acceptance page, without consuming it.
 * POST -- accept it: promotes an existing account, or creates a brand new
 *         password-based account and sets its role, in one transaction.
 */

// auth: hash the incoming token with the same function used at
// generation time so we never compare raw tokens against the DB.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface StaffInviteRow {
  id: number;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
}

export const GET = withErrorHandling(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ token: string }> },
  ) => {
    const { token } = await params;
    if (!token) return ApiResponse.badRequest("Invite token is required.");

    const tokenHash = hashToken(token);
    const inviteRes = await pool.query<StaffInviteRow>(
      `SELECT id, email, role, expires_at, accepted_at
       FROM staff_invites WHERE token = $1`,
      [tokenHash],
    );
    const invite = inviteRes.rows[0];
    if (!invite) return ApiResponse.notFound("Invalid or expired invite.");
    if (invite.accepted_at) {
      return ApiResponse.badRequest("This invite has already been accepted.");
    }
    if (new Date(invite.expires_at) < new Date()) {
      return ApiResponse.badRequest("This invite has expired.");
    }

    const existingUser = await getUserByEmail(invite.email);

    return ApiResponse.success({
      email: invite.email,
      role: invite.role,
      roleLabel: STAFF_ROLE_LABELS[invite.role] || invite.role,
      hasAccount: !!existingUser,
    });
  },
);

export const POST = withErrorHandling(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ token: string }> },
  ) => {
    const { token } = await params;
    if (!token) return ApiResponse.badRequest("Invite token is required.");

    const parsed = await parseBody<{ password?: string; name?: string }>(
      request,
    );
    if (!parsed.success) return ApiResponse.badRequest(parsed.error);
    const { password, name } = parsed.data;

    const tokenHash = hashToken(token);
    const client = await pool.connect();
    let userId: number;
    let createdAccount: boolean;
    let invite: StaffInviteRow;
    try {
      await client.query("BEGIN");

      const inviteRes = await client.query<StaffInviteRow>(
        `SELECT id, email, role, expires_at, accepted_at
         FROM staff_invites WHERE token = $1 FOR UPDATE`,
        [tokenHash],
      );
      const foundInvite = inviteRes.rows[0];
      if (!foundInvite) {
        await client.query("ROLLBACK");
        return ApiResponse.badRequest("Invalid or expired invite.");
      }
      invite = foundInvite;
      if (invite.accepted_at) {
        await client.query("ROLLBACK");
        return ApiResponse.badRequest("This invite has already been accepted.");
      }
      if (new Date(invite.expires_at) < new Date()) {
        await client.query("ROLLBACK");
        return ApiResponse.badRequest("This invite has expired.");
      }

      const existingUserRes = await client.query<{
        id: number;
        role: string;
      }>("SELECT id, role FROM users WHERE email = $1", [invite.email]);
      createdAccount = existingUserRes.rows.length === 0;

      // super-admin: defense in depth against the same account-integrity
      // invariant app/api/v3/admin/route.ts's PATCH handler enforces (no
      // admin-panel path may modify the designated first-user account
      // except the super_admin acting on themselves). The create-invite
      // endpoint already refuses to invite a super_admin's email, but this
      // guards any invite that slipped through before that check existed,
      // or a role change that landed between invite creation and
      // acceptance.
      if (!createdAccount && isSuperAdminRole(existingUserRes.rows[0].role)) {
        await client.query("ROLLBACK");
        return ApiResponse.badRequest("This invite can no longer be accepted.");
      }

      if (!createdAccount) {
        // Promote the existing account. Knowledge of the token already
        // proves control of the invited inbox -- same trust model
        // app/api/v3/auth/reset-password/route.ts uses to let a token
        // holder set a brand new password with no active session -- so
        // this doesn't additionally require the invitee to be logged in.
        userId = existingUserRes.rows[0].id;
        await client.query("UPDATE users SET role = $1 WHERE id = $2", [
          invite.role,
          userId,
        ]);
      } else {
        // No account yet: create one straight from the invite. This is
        // the whole point of the feature (AUDIT-010) -- promoting someone
        // no longer requires they self-register first.
        const minLength = await getSetting("PASSWORD_MIN_LENGTH");
        const trimmedName = typeof name === "string" ? name.trim() : "";

        const validationError = Validate.multiple([
          Validate.required(password, "Password"),
          Validate.password(password || "", minLength),
        ]);
        if (validationError) {
          await client.query("ROLLBACK");
          return ApiResponse.badRequest(validationError);
        }

        // auth: same weak/low-entropy password check used at signup and
        // password reset.
        const pwAnalysis = analyzePassword(password as string);
        if (!meetsMinimumPasswordScore(pwAnalysis.score)) {
          await client.query("ROLLBACK");
          return ApiResponse.badRequest(
            "Password is too weak. " +
              (pwAnalysis.feedback.warnings[0] ||
                "Use a longer phrase or mix character types."),
          );
        }

        const pwRequirements = checkPasswordRequirements(
          password as string,
          { email: invite.email, name: trimmedName },
          minLength,
        );
        if (!passwordRequirementsMet(pwRequirements)) {
          await client.query("ROLLBACK");
          return ApiResponse.badRequest(
            `Password needs: ${unmetRequirementLabels(pwRequirements).join(", ")}.`,
          );
        }

        const passwordHash = await hashPassword(password as string);
        // email_verified_at is set immediately: the invite token already
        // proved control of this inbox, same reasoning
        // lib/auth/auth.ts::createOAuthUser uses for its own immediate
        // verification.
        const insertRes = await client.query<{ id: number }>(
          `INSERT INTO users
             (email, password_hash, name, plan, beta_access, role, auth_provider, email_verified_at)
           VALUES ($1, $2, $3, 'free', false, $4, 'password', NOW())
           RETURNING id`,
          [invite.email, passwordHash, trimmedName || null, invite.role],
        );
        userId = insertRes.rows[0].id;
      }

      await client.query(
        "UPDATE staff_invites SET accepted_at = NOW() WHERE id = $1",
        [invite.id],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // audit-log: trusted client IP only. Logged after commit, same as
    // reset-password's notification email -- a failure here shouldn't
    // undo the account change that already succeeded.
    const ip = (await getClientIp()) || undefined;
    await logAction(
      userId,
      userId,
      "staff_invite_accepted",
      createdAccount
        ? `Created staff account with role "${invite.role}" via staff invite`
        : `Promoted own account to "${invite.role}" via staff invite`,
      ip,
    );

    return ApiResponse.success({
      success: true,
      email: invite.email,
      role: invite.role,
      createdAccount,
    });
  },
);
