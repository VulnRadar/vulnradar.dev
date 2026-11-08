import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { hashPassword } from "@/lib/auth";
import { OAUTH_IDENTITY_COLUMNS } from "@/lib/auth/auth";
import {
  analyzePassword,
  checkPasswordRequirements,
  passwordRequirementsMet,
  unmetRequirementLabels,
  meetsMinimumPasswordScore,
} from "@/lib/auth/password-strength";
import { revokeDiscordTokens } from "@/lib/discord/revoke";
import { passwordChangedEmail } from "@/lib/email/email";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  getClientIp,
  getUserAgent,
  rateLimitIpKey,
} from "@/lib/api/request-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import {
  ApiResponse,
  parseBody,
  Validate,
  withErrorHandling,
} from "@/lib/api/api-utils";
import { getSetting } from "@/lib/config/runtime-config";
import { authTokenHashCandidates } from "@/lib/auth/token-hash";

// auth: hash the incoming token with the same function used at generation
// time so we never compare raw tokens against the DB. The candidate list is
// the HMAC digest plus the pre-HMAC sha256 one, so a reset link already
// sitting in someone's inbox when the switch to HMAC shipped still works
// (AUDIT-002#secrets-03). Both are derived from the presented token, so
// this widens nothing.

// Every column that describes a linked provider identity, except the one the
// account was created with. Names come from the fixed map, never the request.
function identityColumnsToClear(authProvider: string | null): string[] {
  return Object.entries(OAUTH_IDENTITY_COLUMNS).flatMap(([provider, column]) =>
    provider === authProvider
      ? []
      : [
          column.id,
          column.email,
          column.name,
          column.avatarUrl,
          ...(provider === "github" ? ["github_login"] : []),
        ],
  );
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ip = await getClientIp();
  const userAgent = await getUserAgent();

  // The other half of this flow, forgot-password, is rate limited per IP and
  // per email; this half had nothing. Every call here opens a dedicated pooled
  // client and runs BEGIN / SELECT ... FOR UPDATE / ROLLBACK before it can
  // decide the token is wrong, so an unthrottled caller holds a connection and
  // a row lock per attempt. It is not a brute-force risk - the token is 256
  // bits - it is a way to spend the connection pool for free.
  //
  // Reuses forgotPassword's budget under its own key rather than adding a
  // preset: it is the same flow, the same actor and the same order of
  // magnitude of legitimate attempts, and a second preset would also need its
  // own SETTINGS_REGISTRY entry for a number nobody would tune separately.
  const rl = await checkRateLimit({
    key: `reset:${rateLimitIpKey(ip)}`,
    ...RATE_LIMITS.forgotPassword,
  });
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60);
    return ApiResponse.tooManyRequests(
      ERROR_MESSAGES.TOO_MANY_ATTEMPTS_MINUTES("reset attempts", minutes),
      rl.retryAfterSeconds,
    );
  }

  const parsed = await parseBody<{ token: string; password: string }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { token, password } = parsed.data;

  const minLength = await getSetting("PASSWORD_MIN_LENGTH");
  const validationError = Validate.multiple([
    Validate.required(token, "Token"),
    Validate.required(password, "Password"),
    Validate.password(password, minLength),
  ]);
  if (validationError) return ApiResponse.badRequest(validationError);

  // auth: catch common / low-entropy passwords that pass the length floor
  // but crack in seconds ("Password123!"). Same rule as signup.
  const pwAnalysis = analyzePassword(password);
  if (!meetsMinimumPasswordScore(pwAnalysis.score)) {
    return ApiResponse.badRequest(
      "Password is too weak. " +
        (pwAnalysis.feedback.warnings[0] ||
          "Use a longer phrase or mix character types."),
    );
  }

  const tokenHashes = authTokenHashCandidates(token);

  // Find valid token - atomic check and mark as used in single transaction
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tokenRes = await client.query(
      `SELECT prt.id, prt.user_id, prt.expires_at, u.email, u.name, u.totp_enabled, u.auth_provider
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       WHERE prt.token_hash = ANY($1::text[]) AND prt.used_at IS NULL
       FOR UPDATE`,
      [tokenHashes],
    );

    if (tokenRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return ApiResponse.badRequest("Invalid or expired reset link.");
    }

    const resetToken = tokenRes.rows[0];

    if (new Date(resetToken.expires_at) < new Date()) {
      await client.query("DELETE FROM password_reset_tokens WHERE id = $1", [
        resetToken.id,
      ]);
      await client.query("COMMIT");
      return ApiResponse.badRequest(
        "This reset link has expired. Please request a new one.",
      );
    }

    // auth: hard requirements against the account this token actually
    // belongs to. Only known once the token resolves to a user row, so
    // this check cannot move earlier without a second query for the same
    // information the token lookup already returned.
    const pwRequirements = checkPasswordRequirements(
      password,
      { email: resetToken.email, name: resetToken.name },
      minLength,
    );
    if (!passwordRequirementsMet(pwRequirements)) {
      await client.query("ROLLBACK");
      return ApiResponse.badRequest(
        `Password needs: ${unmetRequirementLabels(pwRequirements).join(", ")}.`,
      );
    }

    // Hash new password and update
    const passwordHash = await hashPassword(password);
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      passwordHash,
      resetToken.user_id,
    ]);

    // Mark token as used immediately to prevent duplicate processing
    await client.query(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1",
      [resetToken.id],
    );

    // session: clear all sessions AND all trusted devices. Without the
    // device_trust wipe, an attacker who previously compromised the
    // device (got the device_trust cookie planted) still bypasses 2FA
    // on subsequent logins even after the password is reset.
    await client.query("DELETE FROM sessions WHERE user_id = $1", [
      resetToken.user_id,
    ]);
    await client.query("DELETE FROM device_trust WHERE user_id = $1", [
      resetToken.user_id,
    ]);
    // An API key outlives every credential the two statements above clear.
    // It is minted from a session, carries no cookie, and validateApiKey
    // checks only revoked_at and the account's disabled_at, so an attacker
    // who reached a session long enough to POST /api/v3/keys keeps the scan
    // API, the full history and DELETE on it after the victim has done the
    // one thing the product tells them to do. Bearer requests are exempt from
    // the CSRF check and carry no Origin, so nothing browser-side would ever
    // show it. This is the statement the admin panel's force_logout_all
    // already runs; the account's own recovery path just never called it.
    await client.query(
      "UPDATE api_keys SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
      [resetToken.user_id],
    );

    // A linked identity signs in with no password, so one an attacker attached
    // would survive everything above and walk straight back in. The identity
    // the account was created with stays: it is the owner's, and for an
    // account that never had a password it was the only way in until now.
    // lib/auth/creating-identity.ts is what keeps those columns the owner's.
    // discord_connections goes regardless, since that row is what
    // /auth/discord?action=login signs in from and it can name a Discord
    // account other than the one that created this one.
    await client.query(
      `UPDATE users SET ${identityColumnsToClear(resetToken.auth_provider)
        .map((column) => `${column} = NULL`)
        .join(", ")} WHERE id = $1`,
      [resetToken.user_id],
    );
    const evictedDiscord = await client.query<{
      access_token: string | null;
      refresh_token: string | null;
    }>(
      "DELETE FROM discord_connections WHERE user_id = $1 RETURNING access_token, refresh_token",
      [resetToken.user_id],
    );

    await client.query("COMMIT");

    // Deleting the row only deletes our copy. After the commit, so a reset
    // that fails keeps a working connection; cannot throw, and has a deadline.
    const evicted = evictedDiscord.rows[0];
    if (evicted) {
      await revokeDiscordTokens(resetToken.user_id, {
        accessToken: evicted.access_token,
        refreshToken: evicted.refresh_token,
      });
    }

    // Send security notification email in background (only after successful commit)
    const emailContent = passwordChangedEmail(resetToken.totp_enabled, {
      ipAddress: ip,
      userAgent: userAgent,
    });

    setImmediate(() => {
      sendNotificationEmail({
        userId: resetToken.user_id,
        userEmail: resetToken.email,
        type: "password_changes",
        emailContent,
      }).catch((err) => {
        console.error(
          "[Email Error] Password change notification failed:",
          err,
        );
      });
    });

    const responseMessage = resetToken.totp_enabled
      ? "Password has been reset successfully. You can now log in with your new password and 2FA code."
      : "Password has been reset successfully. You can now log in.";

    return ApiResponse.success({ message: responseMessage });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});
