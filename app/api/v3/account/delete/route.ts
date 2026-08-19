import { getSession, destroySession, verifyPassword } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getClientIp } from "@/lib/api/request-utils";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { deleteAvatarFilesIfLocal } from "@/lib/uploads/avatar-storage";
import { deleteUserAccountData } from "@/lib/auth/account-deletion";
import { sendEmail, accountDeletedEmail } from "@/lib/email/email";

export const POST = withErrorHandling(async (request: Request) => {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }

  // auth: rate-limit password verification so a stolen session cookie
  // cannot be used to brute-force the account password through this
  // endpoint. Same cap as login (5 attempts / 15 min).
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `account-delete:${session.userId}:${ip}`,
    ...RATE_LIMITS.login,
  });
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60);
    return ApiResponse.tooManyRequests(
      `Too many attempts. Please try again in ${minutes} minute(s).`,
      rl.retryAfterSeconds,
    );
  }

  // account: require the user to re-enter their current password
  // before deletion. Without this, a stolen session cookie is enough
  // to permanently destroy the account. The grace-period follow-up
  // (mark-disabled-then-purge-after-7d) is tracked separately.
  //
  // An OAuth-only account (Google/GitHub/Discord sign-up that never set a
  // password -- see users.password_hash, and the same hasPassword check
  // the Security tab uses) has nothing to re-enter here: skip the
  // password check for it rather than permanently locking it out of
  // deleting its own account. The frontend's "type DELETE to confirm"
  // step is still required either way.
  const pwRow = await pool.query<{
    password_hash: string | null;
    email: string;
    name: string | null;
  }>("SELECT password_hash, email, name FROM users WHERE id = $1", [
    session.userId,
  ]);
  // No row at all (a stale/corrupted session referencing an already-gone
  // user) must fail closed, the same as a wrong password -- distinct from
  // a real row whose password_hash is legitimately null (OAuth-only),
  // which is the only case that skips the check below.
  if (!pwRow.rows[0]) {
    return ApiResponse.badRequest("Password is incorrect.");
  }
  const hasPassword = !!pwRow.rows[0].password_hash;

  if (hasPassword) {
    const parsed = await parseBody<{ currentPassword?: string }>(request);
    if (!parsed.success) return ApiResponse.badRequest(parsed.error);
    const { currentPassword } = parsed.data;
    if (typeof currentPassword !== "string" || currentPassword.length === 0) {
      return ApiResponse.badRequest(
        "Re-enter your password to confirm account deletion.",
      );
    }
    if (
      !(await verifyPassword(currentPassword, pwRow.rows[0]!.password_hash))
    ) {
      return ApiResponse.badRequest("Password is incorrect.");
    }
  }

  // Capture the address and name BEFORE the purge: deleteUserAccountData
  // removes the users row (email included), so the confirmation below has to
  // be built from values read now, while the row still exists.
  const deletedEmail = pwRow.rows[0].email;
  const deletedName = pwRow.rows[0].name;

  // Shares the exact same deletion logic app/api/v3/admin/route.ts's
  // delete_account handler uses -- see lib/auth/account-deletion.ts's own
  // doc comment for why this used to be two independently-maintained
  // lists (this route relied on DB CASCADE almost entirely, admin's did
  // ~24 explicit DELETEs) and why that was a real risk of the two paths
  // leaving different residual data behind.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await deleteUserAccountData(client, session.userId);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Best-effort: the user row is already gone, so an avatar file left on
  // disk would never be referenced again. Not part of the transaction
  // above (filesystem writes don't roll back with SQL).
  await deleteAvatarFilesIfLocal(session.userId);

  // Clear the session cookie
  await destroySession();

  // Final step: confirm the purge to the address captured before it ran.
  // Best-effort -- the account is already gone whether or not this sends, so
  // a mail failure must never turn a successful deletion into an error.
  sendEmail({
    to: deletedEmail,
    ...accountDeletedEmail(deletedName),
  }).catch((err) => console.error("Account deleted email failed:", err));

  return ApiResponse.success({ message: "Account deleted successfully" });
});
