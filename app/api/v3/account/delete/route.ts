import { getSession, destroySession, verifyPassword } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES, RATE_LIMITS } from "@/lib/config/constants";
import { getClientIp } from "@/lib/api/request-utils";
import { checkRateLimit } from "@/lib/rate-limiting/rate-limit";

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
    !verifyPassword(currentPassword, pwRow.rows[0].password_hash)
  ) {
    return ApiResponse.badRequest("Password is incorrect.");
  }

  // CASCADE in the DB schema will delete all related data:
  // sessions, api_keys, api_usage (via api_keys cascade), scan_history, data_requests
  await pool.query("DELETE FROM users WHERE id = $1", [session.userId]);

  // Clear the session cookie
  await destroySession();

  return ApiResponse.success({ message: "Account deleted successfully" });
});
