import type { NextRequest, NextResponse } from "next/server";
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
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import {
  recordUnverifiedInviteRefusal,
  STAFF_INVITE_REFUSED_MESSAGE,
} from "@/lib/auth/staff-invite-refusal";

/**
 * Public accept endpoints for a staff invite (AUDIT-010 admin-feature-gap).
 * See app/api/v3/admin/staff-invites/route.ts for how invites are created,
 * and lib/admin/staff-invites.ts for the table shape / token helpers.
 *
 * GET  -- validate a token for the acceptance page, without consuming it.
 * POST -- accept it: promotes an existing account, or creates a brand new
 *         password-based account and sets its role, in one transaction.
 *
 * An existing account is the invitee only when it has VERIFIED the invited
 * address. PATCH /api/v3/auth/update lets any account move to an address no
 * other account holds and only clears email_verified_at, so "the row whose
 * email matches" used to mean whoever typed the address in last: a plain user
 * could become staff, up to admin, and the real invitee was locked out.
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

/** Why an invite row cannot be used, or null when it can. Shared by GET, the
 *  POST's read before its transaction, and the locked re-read inside it. */
function inviteProblem(
  invite: StaffInviteRow | undefined,
): "missing" | "accepted" | "expired" | null {
  if (!invite) return "missing";
  if (invite.accepted_at) return "accepted";
  if (new Date(invite.expires_at) < new Date()) return "expired";
  return null;
}

function inviteProblemResponse(
  problem: "missing" | "accepted" | "expired",
  missing: () => NextResponse,
): NextResponse {
  if (problem === "missing") return missing();
  if (problem === "accepted") {
    return ApiResponse.badRequest("This invite has already been accepted.");
  }
  return ApiResponse.badRequest("This invite has expired.");
}

/** The signup rules for a password that creates a staff account, or the
 *  message to answer with when it falls short. */
async function newAccountPasswordError(
  password: unknown,
  email: string,
  name: string,
): Promise<string | null> {
  const minLength = await getSetting("PASSWORD_MIN_LENGTH");
  const validationError = Validate.multiple([
    Validate.required(password, "Password"),
    Validate.password(typeof password === "string" ? password : "", minLength),
  ]);
  if (validationError) return validationError;

  // auth: same weak/low-entropy password check used at signup and
  // password reset.
  const pwAnalysis = analyzePassword(password as string);
  if (!meetsMinimumPasswordScore(pwAnalysis.score)) {
    return (
      "Password is too weak. " +
      (pwAnalysis.feedback.warnings[0] ||
        "Use a longer phrase or mix character types.")
    );
  }

  const pwRequirements = checkPasswordRequirements(
    password as string,
    { email, name },
    minLength,
  );
  if (!passwordRequirementsMet(pwRequirements)) {
    return `Password needs: ${unmetRequirementLabels(pwRequirements).join(", ")}.`;
  }
  return null;
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
    const problem = inviteProblem(invite);
    if (problem) {
      return inviteProblemResponse(problem, () =>
        ApiResponse.notFound("Invalid or expired invite."),
      );
    }

    const existingUser = await getUserByEmail(invite.email);

    // Refused here as well as in POST: the account that claimed the address
    // has no token, so the invitee opening the link is usually the only
    // request this case ever produces, and it is where the alert has to come
    // from.
    if (existingUser && !existingUser.email_verified_at) {
      await recordUnverifiedInviteRefusal({
        userId: existingUser.id,
        inviteId: invite.id,
        role: invite.role,
      });
      return ApiResponse.badRequest(STAFF_INVITE_REFUSED_MESSAGE);
    }

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
    const trimmedName = typeof name === "string" ? name.trim() : "";

    // The language of the browser accepting the invite, saved with the
    // account like the password signup route does, so the mail that follows is
    // written in it rather than defaulting to English.
    const locale = resolveLocale({
      cookie: request.cookies.get(LOCALE_COOKIE)?.value,
      acceptLanguage: request.headers.get("accept-language"),
    });

    const tokenHash = hashToken(token);
    const missingInvite = () =>
      ApiResponse.badRequest("Invalid or expired invite.");

    // Everything slow happens before the transaction. hashPassword waits on
    // the scrypt limiter (two at a time) and then hashes; doing that inside
    // the transaction held a pool connection and the invite row lock for the
    // whole wait. So: read the invite and the account unlocked, validate and
    // hash a new account's password, and only then open the transaction,
    // which re-reads both under lock and decides. A read here that the locked
    // read contradicts is handled below, never trusted.
    const preInviteRes = await pool.query<StaffInviteRow>(
      `SELECT id, email, role, expires_at, accepted_at
       FROM staff_invites WHERE token = $1`,
      [tokenHash],
    );
    const preInvite = preInviteRes.rows[0];
    const preProblem = inviteProblem(preInvite);
    if (preProblem) return inviteProblemResponse(preProblem, missingInvite);

    const preUserRes = await pool.query<{ id: number }>(
      "SELECT id FROM users WHERE email = $1",
      [preInvite.email],
    );
    let passwordHash: string | null = null;
    if (preUserRes.rows.length === 0) {
      const passwordError = await newAccountPasswordError(
        password,
        preInvite.email,
        trimmedName,
      );
      if (passwordError) return ApiResponse.badRequest(passwordError);
      passwordHash = await hashPassword(password as string);
    }

    type Outcome =
      | { kind: "accepted"; userId: number; createdAccount: boolean }
      | { kind: "refused"; unverifiedUserId: number | null }
      | { kind: "invite-problem"; problem: "missing" | "accepted" | "expired" }
      | { kind: "changed" };

    let invite: StaffInviteRow = preInvite;
    let outcome: Outcome;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const inviteRes = await client.query<StaffInviteRow>(
        `SELECT id, email, role, expires_at, accepted_at
         FROM staff_invites WHERE token = $1 FOR UPDATE`,
        [tokenHash],
      );
      const lockedInvite = inviteRes.rows[0];
      const problem = inviteProblem(lockedInvite);

      if (problem) {
        await client.query("ROLLBACK");
        outcome = { kind: "invite-problem", problem };
      } else {
        invite = lockedInvite;
        // FOR UPDATE: PATCH /api/v3/auth/update changes the address with an
        // UPDATE on this row, so it waits until the promotion below commits
        // instead of moving the address away between this check and it.
        const existingUserRes = await client.query<{
          id: number;
          role: string;
          email_verified_at: string | null;
        }>(
          "SELECT id, role, email_verified_at FROM users WHERE email = $1 FOR UPDATE",
          [invite.email],
        );
        const existing = existingUserRes.rows[0];

        if (existing && isSuperAdminRole(existing.role)) {
          // super-admin: defense in depth against the same account-integrity
          // invariant app/api/v3/admin/route.ts's PATCH handler enforces (no
          // admin-panel path may modify the designated first-user account
          // except the super_admin acting on themselves). The create-invite
          // endpoint already refuses to invite a super_admin's email, but
          // this guards any invite that slipped through before that check
          // existed, or a role change that landed between invite creation
          // and acceptance.
          await client.query("ROLLBACK");
          outcome = { kind: "refused", unverifiedUserId: null };
        } else if (existing && !existing.email_verified_at) {
          await client.query("ROLLBACK");
          outcome = { kind: "refused", unverifiedUserId: existing.id };
        } else if (existing) {
          // Promote the existing account. Knowledge of the token already
          // proves control of the invited inbox, and the verified address
          // proves this account is that inbox's owner -- same trust model
          // app/api/v3/auth/reset-password/route.ts uses to let a token
          // holder set a brand new password with no active session -- so
          // this doesn't additionally require the invitee to be logged in.
          await client.query("UPDATE users SET role = $1 WHERE id = $2", [
            invite.role,
            existing.id,
          ]);
          await client.query(
            "UPDATE staff_invites SET accepted_at = NOW() WHERE id = $1",
            [invite.id],
          );
          await client.query("COMMIT");
          outcome = {
            kind: "accepted",
            userId: existing.id,
            createdAccount: false,
          };
        } else if (passwordHash === null) {
          // The read before the transaction found an account, so no password
          // was taken, and it is gone now. Hashing here is exactly what this
          // structure avoids; the page reloads into the create-account form.
          await client.query("ROLLBACK");
          outcome = { kind: "changed" };
        } else {
          // No account yet: create one straight from the invite. This is
          // the whole point of the feature (AUDIT-010) -- promoting someone
          // no longer requires they self-register first.
          //
          // email_verified_at is set immediately: the invite token already
          // proved control of this inbox, same reasoning
          // lib/auth/auth.ts::createOAuthUser uses for its own immediate
          // verification.
          const insertRes = await client.query<{ id: number }>(
            `INSERT INTO users
               (email, password_hash, name, plan, beta_access, role, auth_provider, email_verified_at, locale)
             VALUES ($1, $2, $3, 'free', false, $4, 'password', NOW(), $5)
             RETURNING id`,
            [
              invite.email,
              passwordHash,
              trimmedName || null,
              invite.role,
              locale,
            ],
          );
          await client.query(
            "UPDATE staff_invites SET accepted_at = NOW() WHERE id = $1",
            [invite.id],
          );
          await client.query("COMMIT");
          outcome = {
            kind: "accepted",
            userId: insertRes.rows[0].id,
            createdAccount: true,
          };
        }
      }
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // audit-log: trusted client IP only. Everything below runs after the
    // connection is released, same as reset-password's notification email --
    // a failure here shouldn't undo the account change that already
    // succeeded, and the alert write must not queue behind the row lock.
    const ip = (await getClientIp()) || undefined;

    if (outcome.kind === "invite-problem") {
      return inviteProblemResponse(outcome.problem, missingInvite);
    }
    if (outcome.kind === "changed") {
      return ApiResponse.conflict(
        "This invite changed while it was being accepted. Reload the page and try again.",
      );
    }
    if (outcome.kind === "refused") {
      if (outcome.unverifiedUserId !== null) {
        await recordUnverifiedInviteRefusal({
          userId: outcome.unverifiedUserId,
          inviteId: invite.id,
          role: invite.role,
        });
      }
      return ApiResponse.badRequest(STAFF_INVITE_REFUSED_MESSAGE);
    }

    const { userId, createdAccount } = outcome;
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
