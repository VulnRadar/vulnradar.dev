import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  hashPassword,
  verifyPassword,
  deleteAllSessions,
  createSession,
} from "@/lib/auth";
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
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import {
  AUTH_SESSION_COOKIE_NAME,
  ERROR_MESSAGES,
} from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { sendEmailVerification } from "@/lib/auth/email-verification";

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

    // auth: changing email or password requires re-authentication with the
    // current password. Without this, a stolen session cookie is enough to
    // take over the account by changing the email and then triggering a
    // password reset. Name and avatar are NOT account-takeover vectors on
    // their own (there's no follow-up step that turns "I can rename you"
    // into "I own your account" the way there is for email), so they don't
    // require it -- and no UI in the general profile tab collects a
    // password for them, unlike the dedicated change-password form, which
    // has its own current-password field wired up.
    const sensitiveChangeRequested =
      (typeof email === "string" && email.trim()) || Boolean(newPassword);
    if (sensitiveChangeRequested) {
      // A sensitive change (email/password) verifies currentPassword below, so
      // gate it with the strict login bucket (5 / 15 min), not the broad
      // profile-update `api` bucket (100/hr) -- otherwise a stolen session
      // cookie gets ~20x more online guesses against this exact re-auth check.
      const sensitiveRl = await checkRateLimit({
        key: `profile-reauth:${session.userId}:${clientIp}`,
        ...RATE_LIMITS.login,
      });
      if (!sensitiveRl.allowed) {
        return NextResponse.json(
          {
            error: `Too many attempts. Try again in ${Math.ceil(sensitiveRl.retryAfterSeconds / 60)} minute(s).`,
          },
          { status: 429 },
        );
      }

      const pwResult = await pool.query(
        "SELECT password_hash FROM users WHERE id = $1",
        [session.userId],
      );
      const hasPassword = Boolean(pwResult.rows[0]?.password_hash);

      if (hasPassword) {
        if (typeof currentPassword !== "string" || !currentPassword) {
          return NextResponse.json(
            {
              error: "Current password is required to change profile details.",
            },
            { status: 403 },
          );
        }
        if (
          pwResult.rows.length === 0 ||
          !(await verifyPassword(
            currentPassword,
            pwResult.rows[0].password_hash,
          ))
        ) {
          return NextResponse.json(
            { error: "Current password is incorrect." },
            { status: 403 },
          );
        }
      }
      // else: an OAuth-only account (see lib/auth/auth.ts's
      // createOAuthUser) has no password to re-enter as proof of intent.
      // The signed-in session itself is the re-auth signal for these
      // accounts -- same trust boundary getSession() already enforces for
      // every other authenticated route. This also lets such an account
      // set its first password below (newPassword branch) without a
      // chicken-and-egg "enter the password you don't have yet."
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

    // Update email
    if (typeof email === "string") {
      const trimmedEmail = email.toLowerCase().trim();
      if (!trimmedEmail || !trimmedEmail.includes("@")) {
        return NextResponse.json(
          { error: "Please enter a valid email." },
          { status: 400 },
        );
      }

      if (trimmedEmail !== currentEmail) {
        // Check if email is already taken by another user
        const existing = await pool.query(
          "SELECT id FROM users WHERE email = $1 AND id != $2",
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
        await pool.query(
          "UPDATE users SET email = $1, email_verified_at = NULL, updated_at = NOW() WHERE id = $2",
          [trimmedEmail, session.userId],
        );
        emailChanged = true;

        // Send a verification link to the new address immediately. Without
        // this the account was left with email_verified_at NULL and no token
        // ever issued, so the user was stranded (locked out at next login)
        // until they manually found and hit resend-verification.
        await sendEmailVerification(session.userId, currentName, trimmedEmail);

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
    if (newPassword) {
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
        secure: process.env.NODE_ENV === "production",
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
        secure: process.env.NODE_ENV === "production",
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
