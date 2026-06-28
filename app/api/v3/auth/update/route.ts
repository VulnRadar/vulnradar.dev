import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  hashPassword,
  verifyPassword,
  deleteAllSessions,
  createSession,
} from "@/lib/auth";
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

    // H-4: Any sensitive profile change (name, email, avatar, password)
    // requires the user to re-authenticate with their current password.
    // Without this, a stolen session cookie is enough to take over the
    // account by changing the email and then triggering a password reset.
    const sensitiveChangeRequested =
      (typeof name === "string" && name.trim()) ||
      (typeof email === "string" && email.trim()) ||
      typeof avatarUrl === "string" ||
      Boolean(newPassword);
    if (sensitiveChangeRequested) {
      if (typeof currentPassword !== "string" || !currentPassword) {
        return NextResponse.json(
          {
            error: "Current password is required to change profile details.",
          },
          { status: 403 },
        );
      }
      const pwResult = await pool.query(
        "SELECT password_hash FROM users WHERE id = $1",
        [session.userId],
      );
      if (
        pwResult.rows.length === 0 ||
        !verifyPassword(currentPassword, pwResult.rows[0].password_hash)
      ) {
        return NextResponse.json(
          { error: "Current password is incorrect." },
          { status: 403 },
        );
      }
    }

    // Get IP and user agent for security emails
    // SECURITY-AUDIT-2026-06-28 / M-7: getClientIp respects
    // TRUSTED_PROXY_CIDR so a forged X-Forwarded-For from an
    // untrusted client can't poison the audit-log IP or the
    // "password changed from 127.0.0.1" email.
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

        await pool.query("UPDATE users SET email = $1 WHERE id = $2", [
          trimmedEmail,
          session.userId,
        ]);

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
      if (avatarUrl === "") {
        // Allowed: user is clearing the avatar.
      } else if (avatarUrl.startsWith("https://cdn.discordapp.com/")) {
        // Allowed: pre-cleared Discord CDN URL from OAuth.
      } else {
        const { validateAvatarDataUrl } = await import("@/lib/uploads/avatar");
        const result = validateAvatarDataUrl(avatarUrl);
        if (!result.valid) {
          return NextResponse.json({ error: result.reason }, { status: 400 });
        }
      }
      await pool.query("UPDATE users SET avatar_url = $1 WHERE id = $2", [
        avatarUrl || null,
        session.userId,
      ]);
    }

    // Update password
    if (newPassword) {
      // H-4: current password has already been verified above.
      if (newPassword.length < 8) {
        return NextResponse.json(
          { error: "New password must be at least 8 characters." },
          { status: 400 },
        );
      }

      const newHash = hashPassword(newPassword);
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
        newHash,
        session.userId,
      ]);

      // SECURITY-AUDIT-2026-06-28 / H-2: invalidate ALL other sessions
      // for this user when the password changes. The previous behavior
      // kept stolen session cookies alive for the full 7-day TTL even
      // after a password rotation, allowing an attacker who had a
      // cookie to retain access indefinitely. We mirror the
      // reset-password flow: kill all sessions, then re-create the
      // current session so the user is not immediately logged out.
      await deleteAllSessions(session.userId);
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
      response.cookies.set(AUTH_SESSION_COOKIE_NAME, newSessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60,
      });
      return response;
    }

    // Fetch updated user info
    const updated = await pool.query(
      "SELECT id, email, name, avatar_url FROM users WHERE id = $1",
      [session.userId],
    );

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
