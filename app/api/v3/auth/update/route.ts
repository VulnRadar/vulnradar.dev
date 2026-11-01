import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  hashPassword,
  deleteAllSessions,
  createSession,
} from "@/lib/auth";
import { verifyReauthPassword } from "@/lib/auth/reauth";
import {
  analyzePassword,
  checkPasswordRequirements,
  passwordRequirementsMet,
  unmetRequirementLabels,
  meetsMinimumPasswordScore,
} from "@/lib/auth/password-strength";
import {
  profileNameChangedEmail,
  profileEmailChangedEmail,
  profilePasswordChangedEmail,
} from "@/lib/email/email";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import pool from "@/lib/database/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { Validate } from "@/lib/api/api-utils";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import {
  AUTH_SESSION_COOKIE_NAME,
  ERROR_MESSAGES,
} from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { sendEmailVerification } from "@/lib/auth/email-verification";
import { refuseWhileImpersonating } from "@/lib/auth/impersonation-guard";
import { cookiesRequireHttps } from "@/lib/auth/cookie-secure";

/**
 * The current-password check an email or password change has to pass, or the
 * response that refuses it.
 *
 * The strict login bucket (5 / 15 min) gates it rather than the broad
 * profile-update `api` bucket (100/hr), or a stolen session cookie gets about
 * 20x more online guesses against this exact check. An account with no
 * password (OAuth-only, see createOAuthUser) passes on the session alone,
 * which also lets it set its first password; a users row that cannot be read
 * fails closed.
 */
async function confirmCurrentPassword(
  userId: number,
  clientIp: string,
  currentPassword: unknown,
): Promise<NextResponse | null> {
  const rl = await checkRateLimit({
    key: `profile-reauth:${userId}:${clientIp}`,
    ...RATE_LIMITS.login,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      },
      { status: 429 },
    );
  }

  const reauth = await verifyReauthPassword(userId, currentPassword, {
    missing: "Current password is required to change profile details.",
    wrong: "Current password is incorrect.",
  });
  if (!reauth.ok) {
    return NextResponse.json({ error: reauth.error }, { status: 403 });
  }
  return null;
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  // Rate limit profile updates to prevent password brute-force
  const clientIp = await getClientIp();
  const rl = await checkRateLimit({
    key: `profile-update:${session.userId}:${clientIp}`,
    ...RATE_LIMITS.api,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Too many update attempts. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      },
      { status: 429 },
    );
  }

  try {
    const body = await request.json();
    const { name, email, currentPassword, newPassword, avatarUrl } = body;

    // Changing the email redirects every future password reset, which is
    // account takeover in one step: the admin panel says so in as many words
    // and puts it behind a password prompt. Through an impersonation session
    // it needed no password and left no record, because this route writes no
    // audit row at all. Neither it nor a password change belongs to a session
    // staff opened to look at a bug. Name and avatar are deliberately not
    // covered: they are cosmetic, and staff reproducing a problem should not
    // be stopped from touching them.
    if (email !== undefined || newPassword !== undefined) {
      const refused = refuseWhileImpersonating(
        session,
        email !== undefined
          ? "Changing the account's email address"
          : "Changing the account's password",
      );
      if (refused) return refused;
    }

    // auth: changing email or password requires re-authentication with the
    // current password. Without this, a stolen session cookie is enough to
    // take over the account by changing the email and then triggering a
    // password reset. Name and avatar are NOT account-takeover vectors on
    // their own (there's no follow-up step that turns "I can rename you"
    // into "I own your account" the way there is for email), so they don't
    // require it -- and no UI in the general profile tab collects a
    // password for them, unlike the dedicated change-password form, which
    // has its own current-password field wired up.
    //
    // These two predicates are the gate AND the only way into the email and
    // password writes below, so no request can skip the check and still
    // reach a write.
    const wantsEmailChange = typeof email === "string" && email.trim() !== "";
    const wantsPasswordChange = Boolean(newPassword);
    if (wantsEmailChange || wantsPasswordChange) {
      const refused = await confirmCurrentPassword(
        session.userId,
        clientIp,
        currentPassword,
      );
      if (refused) return refused;
    }

    // Get IP and user agent for security emails
    // audit-log: getClientIp respects TRUSTED_PROXY_CIDR so a forged
    // X-Forwarded-For from an untrusted client can't poison the
    // audit-log IP or the "password changed from 127.0.0.1" email.
    const ip = (await getClientIp()) || "Unknown";
    const userAgent = request.headers.get("user-agent") || "Unknown";

    // Get current user info for comparison
    const currentUser = await pool.query(
      "SELECT name, email FROM users WHERE id = $1",
      [session.userId],
    );
    const currentName = currentUser.rows[0]?.name || "";
    const currentEmail = currentUser.rows[0]?.email || "";

    // Update name
    if (typeof name === "string") {
      const trimmed = name.trim();
      if (!trimmed) {
        return NextResponse.json(
          { error: "Name cannot be empty." },
          { status: 400 },
        );
      }

      if (trimmed !== currentName) {
        await pool.query("UPDATE users SET name = $1 WHERE id = $2", [
          trimmed,
          session.userId,
        ]);

        // Send account changes notification (non-blocking)
        const emailContent = profileNameChangedEmail(
          currentName || "Not set",
          trimmed,
          { ipAddress: ip, userAgent },
        );
        setImmediate(() => {
          sendNotificationEmail({
            userId: session.userId,
            userEmail: currentEmail,
            type: "account_changes",
            emailContent,
          }).catch((err) =>
            console.error(
              "Failed to send profile name change notification:",
              err,
            ),
          );
        });
      }
    }

    // Set when the account's email address actually changes. Changing the
    // login identifier is as much of a takeover-relevant event as changing
    // the password, so it rotates sessions and trusted devices the same way
    // (handled after the password branch below, which already does its own
    // rotation and returns early).
    let emailChanged = false;

    // Update email. A blank string is a malformed email (400), not a request
    // that skipped the re-auth above.
    if (typeof email === "string" && !wantsEmailChange) {
      return NextResponse.json(
        { error: "Please enter a valid email." },
        { status: 400 },
      );
    }
    if (wantsEmailChange) {
      const trimmedEmail = email.toLowerCase().trim();
      // The new-address rule is for a new address. Sending back the one the
      // account already holds, stored under the old any-@ rule (a self-hosted
      // admin@localhost), is not new input and is not refused.
      if (
        trimmedEmail !== currentEmail.toLowerCase() &&
        Validate.email(trimmedEmail)
      ) {
        return NextResponse.json(
          { error: "Please enter a valid email." },
          { status: 400 },
        );
      }

      if (trimmedEmail !== currentEmail) {
        // Taken by another account, compared the way the unique index on
        // LOWER(email) compares. A case-sensitive check let a stored
        // mixed-case address through to the UPDATE, which then hit the index
        // and failed as a 500 instead of this 409.
        const existing = await pool.query(
          "SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2",
          [trimmedEmail, session.userId],
        );
        if (existing.rows.length > 0) {
          return NextResponse.json(
            { error: "Email is already in use." },
            { status: 409 },
          );
        }

        // auth: reset email_verified_at on email change so the new address
        // must be verified before login is permitted. Without this, the new
        // email is implicitly "verified" by the previous verification, and
        // an attacker who knows the current password can change the email
        // to attacker@evil.com and then trigger forgot-password (which
        // only requires the email) to take over the account.
        //
        // The links already mailed to the old address die in the same
        // transaction. As separate steps, a link clicked between them, or one
        // left behind because issuing the new link threw, verified the NEW
        // address for someone who only ever read the old inbox. The DELETE
        // goes first so this locks the token rows and then the user row, the
        // order verify-email locks them in, and a racing click waits instead
        // of deadlocking.
        const tx = await pool.connect();
        try {
          await tx.query("BEGIN");
          await tx.query(
            "DELETE FROM email_verification_tokens WHERE user_id = $1",
            [session.userId],
          );
          await tx.query(
            "UPDATE users SET email = $1, email_verified_at = NULL, updated_at = NOW() WHERE id = $2",
            [trimmedEmail, session.userId],
          );
          await tx.query("COMMIT");
        } catch (err) {
          await tx.query("ROLLBACK");
          throw err;
        } finally {
          tx.release();
        }
        emailChanged = true;

        // Send a verification link to the new address immediately. Without
        // this the account was left with email_verified_at NULL and no token
        // ever issued, so the user was stranded (locked out at next login)
        // until they manually found and hit resend-verification. A failure
        // here is logged, not thrown: the address has already changed, and
        // the session rotation below must run for it either way. Resend
        // covers the missing link.
        try {
          await sendEmailVerification(
            session.userId,
            currentName,
            trimmedEmail,
          );
        } catch (err) {
          console.error(
            "Failed to issue the verification link after an email change:",
            err,
          );
        }

        // Send account changes email to BOTH old and new email addresses (non-blocking)
        const emailContent = profileEmailChangedEmail(
          currentEmail,
          trimmedEmail,
          { ipAddress: ip, userAgent },
        );
        setImmediate(() => {
          sendNotificationEmail({
            userId: session.userId,
            userEmail: currentEmail,
            type: "account_changes",
            emailContent,
          }).catch((err) =>
            console.error(
              "Failed to send profile email change (old) notification:",
              err,
            ),
          );
          sendNotificationEmail({
            userId: session.userId,
            userEmail: trimmedEmail,
            type: "account_changes",
            emailContent,
          }).catch((err) =>
            console.error(
              "Failed to send profile email change (new) notification:",
              err,
            ),
          );
        });
      }
    }

    // Update avatar
    if (typeof avatarUrl === "string") {
      // strict avatar validation. The previous
      // check only verified the data: URL prefix — it would happily accept
      // `data:image/svg+xml;base64,<SVG with inline script>` and store it
      // in the DB, ready to render as XSS. Now uses lib/uploads/avatar.ts
      // to enforce MIME allowlist (png/jpeg only — SVG is rejected),
      // magic-bytes check, and a 5 MiB cap.
      const { deleteAvatarFilesIfLocal, saveAvatarFile } =
        await import("@/lib/uploads/avatar-storage");

      let storedValue: string | null;
      if (avatarUrl === "") {
        // Clearing: drop any stored avatar row and null the column so
        // nothing is left behind.
        await deleteAvatarFilesIfLocal(session.userId);
        storedValue = null;
      } else if (avatarUrl.startsWith("https://cdn.discordapp.com/")) {
        // Pre-cleared Discord CDN URL from OAuth: an external reference we
        // store as-is. Drop any previously uploaded avatar so it doesn't
        // linger.
        await deleteAvatarFilesIfLocal(session.userId);
        storedValue = avatarUrl;
      } else {
        const { validateAvatarDataUrl } = await import("@/lib/uploads/avatar");
        const result = validateAvatarDataUrl(avatarUrl);
        if (!result.valid) {
          return NextResponse.json({ error: result.reason }, { status: 400 });
        }
        // The validated bytes go into the user_avatars table (Postgres);
        // avatar_url holds the same-origin path the GET /api/v3/avatar
        // route resolves back to them.
        storedValue = await saveAvatarFile(
          session.userId,
          result.mime,
          result.bytes,
        );
      }
      await pool.query("UPDATE users SET avatar_url = $1 WHERE id = $2", [
        storedValue,
        session.userId,
      ]);
    }

    // Update password
    if (wantsPasswordChange) {
      // auth: current password already verified above (sensitive-change branch).
      // Advisory strength gate first (common/low-entropy passwords), matching
      // signup and reset-password -- the profile change was the one path that
      // let a user rotate to "Password1!".
      const pwAnalysis = analyzePassword(newPassword);
      if (!meetsMinimumPasswordScore(pwAnalysis.score)) {
        return NextResponse.json(
          {
            error:
              "Password is too weak. " +
              (pwAnalysis.feedback.warnings[0] ||
                "Use a longer phrase or mix character types."),
          },
          { status: 400 },
        );
      }

      // Same hard requirements signup and reset-password enforce (length,
      // case, digit, symbol, not built from the account's own email/name).
      const minLength = await getSetting("PASSWORD_MIN_LENGTH");
      const pwRequirements = checkPasswordRequirements(
        newPassword,
        { email: currentEmail, name: currentName },
        minLength,
      );
      if (!passwordRequirementsMet(pwRequirements)) {
        return NextResponse.json(
          {
            error: `Password needs: ${unmetRequirementLabels(pwRequirements).join(", ")}.`,
          },
          { status: 400 },
        );
      }

      const newHash = await hashPassword(newPassword);
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
        newHash,
        session.userId,
      ]);

      // session: invalidate ALL other sessions on password change.
      // A stolen session cookie would otherwise stay valid for the
      // full 7-day TTL even after a legitimate password rotation.
      // Mirror the reset-password flow: kill all sessions, then
      // re-create the current session so the user is not
      // immediately logged out.
      await deleteAllSessions(session.userId);
      // Also clear trusted devices, exactly as reset-password does: someone
      // rotating their password on suspicion of compromise must not leave a
      // planted device_trust row that keeps skipping 2FA on the attacker's
      // machine.
      await pool.query("DELETE FROM device_trust WHERE user_id = $1", [
        session.userId,
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
      await pool.query(
        "UPDATE api_keys SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
        [session.userId],
      );
      // A password-reset token outlives the password it was issued against.
      // Those rows reference no hash, and nothing here cleared them, so an
      // unclicked emailed link stayed live after a voluntary change. The
      // realistic path is the one the comments above already describe: a user
      // rotates their password BECAUSE they suspect compromise, and the link
      // sitting in their mailbox resets it again. Every other path that needs
      // to already does this (account deletion, the admin reset, and
      // forgot-password on re-issue).
      await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [
        session.userId,
      ]);
      const uaForSession = await getUserAgent();
      const newSessionId = await createSession(
        session.userId,
        ip,
        uaForSession,
      );

      // Send password change notification (non-blocking, respects user prefs)
      const emailContent = profilePasswordChangedEmail({
        ipAddress: ip,
        userAgent,
      });
      setImmediate(() => {
        sendNotificationEmail({
          userId: session.userId,
          userEmail: currentEmail,
          type: "password_changes",
          emailContent,
        }).catch((err) =>
          console.error("Failed to send password change notification:", err),
        );
      });

      // Fetch updated user info
      const updated = await pool.query(
        "SELECT id, email, name, avatar_url FROM users WHERE id = $1",
        [session.userId],
      );

      const response = NextResponse.json({
        userId: updated.rows[0].id,
        email: updated.rows[0].email,
        name: updated.rows[0].name,
        avatarUrl: updated.rows[0].avatar_url || null,
        message:
          "Profile updated successfully. All other sessions have been signed out for security.",
        sessionInvalidated: true,
      });
      // Replace the rotated session cookie with the freshly-issued one.
      // auth: use the live SESSION_MAX_AGE_DAYS setting (converted to
      // seconds) so this matches what createSession sets — a hardcoded
      // literal here would drift from the admin-configured value.
      const sessionMaxAgeDays = await getSetting("SESSION_MAX_AGE_DAYS");
      response.cookies.set(AUTH_SESSION_COOKIE_NAME, newSessionId, {
        httpOnly: true,
        secure: cookiesRequireHttps(),
        sameSite: "lax",
        path: "/",
        maxAge: sessionMaxAgeDays * 24 * 60 * 60,
      });
      return response;
    }

    // Fetch updated user info
    const updated = await pool.query(
      "SELECT id, email, name, avatar_url FROM users WHERE id = $1",
      [session.userId],
    );

    // session: an email change rotates sessions and trusted devices too.
    // Only the password branch above used to do this, so an attacker holding
    // a stolen cookie could move the account to their own address and keep
    // every other session (and every device_trust row that skips 2FA) alive
    // for the full session TTL. Reached only when no password was changed:
    // that branch returns above after doing exactly this.
    if (emailChanged) {
      await deleteAllSessions(session.userId);
      await pool.query("DELETE FROM device_trust WHERE user_id = $1", [
        session.userId,
      ]);
      const uaForSession = await getUserAgent();
      const newSessionId = await createSession(
        session.userId,
        ip,
        uaForSession,
      );
      const response = NextResponse.json({
        userId: updated.rows[0].id,
        email: updated.rows[0].email,
        name: updated.rows[0].name,
        avatarUrl: updated.rows[0].avatar_url || null,
        message:
          "Profile updated successfully. All other sessions have been signed out for security.",
        sessionInvalidated: true,
      });
      const sessionMaxAgeDays = await getSetting("SESSION_MAX_AGE_DAYS");
      response.cookies.set(AUTH_SESSION_COOKIE_NAME, newSessionId, {
        httpOnly: true,
        secure: cookiesRequireHttps(),
        sameSite: "lax",
        path: "/",
        maxAge: sessionMaxAgeDays * 24 * 60 * 60,
      });
      return response;
    }

    return NextResponse.json({
      userId: updated.rows[0].id,
      email: updated.rows[0].email,
      name: updated.rows[0].name,
      avatarUrl: updated.rows[0].avatar_url || null,
      message: "Profile updated successfully.",
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to update profile." },
      { status: 500 },
    );
  }
}
