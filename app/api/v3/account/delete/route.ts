import { getSession, destroySession, verifyPassword } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES, RATE_LIMITS } from "@/lib/config/constants";
import { getClientIp } from "@/lib/api/request-utils";
import { checkRateLimit } from "@/lib/rate-limiting/rate-limit";
import { deleteAvatarFilesIfLocal } from "@/lib/uploads/avatar-storage";

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
  const parsed = await parseBody<{ currentPassword?: string }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { currentPassword } = parsed.data;
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return ApiResponse.badRequest(
      "Re-enter your password to confirm account deletion.",
    );
  }
  const pwRow = await pool.query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [session.userId],
  );
  if (
    !pwRow.rows[0] ||
    !(await verifyPassword(currentPassword, pwRow.rows[0].password_hash))
  ) {
    return ApiResponse.badRequest("Password is incorrect.");
  }

  // CASCADE (or self-healing ON DELETE SET NULL FKs added in
  // instrumentation.ts, e.g. admin_audit_log.target_user_id and
  // access_rules.created_by) in the DB schema handles almost every
  // related table: sessions, api_keys, api_usage (via api_keys cascade),
  // scan_history, data_requests, teams, notification_preferences, etc.
  //
  // Two columns have no ON DELETE clause at all (default RESTRICT) and no
  // self-healing migration: security_alerts.resolved_by and
  // system_settings.updated_by. Both are nullable, so a staff/admin
  // account that ever resolved a security alert or changed a system
  // setting would otherwise fail this DELETE with an unhandled foreign-key
  // violation and never actually get deleted. Null them out first so the
  // delete can proceed; wrapped in a transaction so a mid-way failure
  // can't null the references without also deleting the account.
  //
  // broadcast_messages.created_by has the same missing ON DELETE clause
  // but is NOT NULL, so it can't be nulled this way -- a staff account
  // that ever created a broadcast still can't self-delete without a
  // schema migration (see the GDPR audit report).
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE security_alerts SET resolved_by = NULL WHERE resolved_by = $1",
      [session.userId],
    );
    await client.query(
      "UPDATE system_settings SET updated_by = NULL WHERE updated_by = $1",
      [session.userId],
    );
    await client.query("DELETE FROM users WHERE id = $1", [session.userId]);
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

  return ApiResponse.success({ message: "Account deleted successfully" });
});
