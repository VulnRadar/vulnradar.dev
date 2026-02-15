import { NextRequest, NextResponse } from "next/server"
import { getSession, hashPassword, verifyPassword } from "@/lib/auth"
import { profileNameChangedEmail, profileEmailChangedEmail, profilePasswordChangedEmail } from "@/lib/email"
import { sendNotificationEmail } from "@/lib/notifications"
import pool from "@/lib/db"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { getClientIp } from "@/lib/request-utils"
import { ERROR_MESSAGES } from "@/lib/constants"

export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })
  }

  // Rate limit profile updates to prevent password brute-force
  const clientIp = await getClientIp()
  const rl = await checkRateLimit({ key: `profile-update:${session.userId}:${clientIp}`, ...RATE_LIMITS.api })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many update attempts. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
      { status: 429 },
    )
  }

  try {
    const body = await request.json()
    const { name, email, currentPassword, newPassword, avatarUrl } = body

    // Get IP and user agent for security emails
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "Unknown"
    const userAgent = request.headers.get("user-agent") || "Unknown"

    // Get current user info for comparison
    const currentUser = await pool.query(
      "SELECT name, email FROM users WHERE id = $1",
      [session.userId]
    )
    const currentName = currentUser.rows[0]?.name || ""
    const currentEmail = currentUser.rows[0]?.email || ""

    // Update name
    if (typeof name === "string") {
      const trimmed = name.trim()
      if (!trimmed) {
        return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 })
      }

      if (trimmed !== currentName) {
        await pool.query("UPDATE users SET name = $1 WHERE id = $2", [trimmed, session.userId])

        // Send security email via notifications helper so user preferences are respected
        const emailContent = profileNameChangedEmail(currentName || "Not set", trimmed, { ipAddress: ip, userAgent })
        sendNotificationEmail({
          userId: session.userId,
          userEmail: currentEmail,
          type: "security",
          emailContent,
        }).catch((err) => console.error("Failed to send profile name change notification:", err))
      }
    }

    // Update email
    if (typeof email === "string") {
      const trimmedEmail = email.toLowerCase().trim()
      if (!trimmedEmail || !trimmedEmail.includes("@")) {
        return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 })
      }

      if (trimmedEmail !== currentEmail) {
        // Check if email is already taken by another user
        const existing = await pool.query(
          "SELECT id FROM users WHERE email = $1 AND id != $2",
          [trimmedEmail, session.userId],
        )
        if (existing.rows.length > 0) {
          return NextResponse.json({ error: "Email is already in use." }, { status: 409 })
        }

        await pool.query("UPDATE users SET email = $1 WHERE id = $2", [trimmedEmail, session.userId])

        // Send security email to BOTH old and new email addresses via notifications helper
        const emailContent = profileEmailChangedEmail(currentEmail, trimmedEmail, { ipAddress: ip, userAgent })
        sendNotificationEmail({
          userId: session.userId,
          userEmail: currentEmail,
          type: "security",
          emailContent,
        }).catch((err) => console.error("Failed to send profile email change (old) notification:", err))
        sendNotificationEmail({
          userId: session.userId,
          userEmail: trimmedEmail,
          type: "security",
          emailContent,
        }).catch((err) => console.error("Failed to send profile email change (new) notification:", err))
      }
    }

    // Update avatar
    if (typeof avatarUrl === "string") {
      // Allow clearing avatar (empty string) or setting a data URL
      if (avatarUrl && !avatarUrl.startsWith("data:image/")) {
        return NextResponse.json({ error: "Invalid avatar format." }, { status: 400 })
      }
      // Limit to ~5MB base64 (base64 is ~33% larger than raw)
      if (avatarUrl.length > 7_000_000) {
        return NextResponse.json({ error: "Avatar is too large. Please use an image under 5MB." }, { status: 400 })
      }
      await pool.query("UPDATE users SET avatar_url = $1 WHERE id = $2", [avatarUrl || null, session.userId])
    }

    // Update password
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: "Current password is required to set a new password." },
          { status: 400 },
        )
      }

      if (newPassword.length < 8) {
        return NextResponse.json(
          { error: "New password must be at least 8 characters." },
          { status: 400 },
        )
      }

      // Verify current password
      const userResult = await pool.query(
        "SELECT password_hash FROM users WHERE id = $1",
        [session.userId],
      )
      if (userResult.rows.length === 0) {
        return NextResponse.json({ error: "User not found." }, { status: 404 })
      }

      const isValid = verifyPassword(currentPassword, userResult.rows[0].password_hash)
      if (!isValid) {
        return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 })
      }

      const newHash = hashPassword(newPassword)
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, session.userId])

      // Send security email via notifications helper (respects user prefs)
      const emailContent = profilePasswordChangedEmail({ ipAddress: ip, userAgent })
      sendNotificationEmail({
        userId: session.userId,
        userEmail: currentEmail,
        type: "security",
        emailContent,
      }).catch((err) => console.error("Failed to send password change notification:", err))
    }

    // Fetch updated user info
    const updated = await pool.query(
      "SELECT id, email, name, avatar_url FROM users WHERE id = $1",
      [session.userId],
    )

    return NextResponse.json({
      userId: updated.rows[0].id,
      email: updated.rows[0].email,
      name: updated.rows[0].name,
      avatarUrl: updated.rows[0].avatar_url || null,
      message: "Profile updated successfully.",
    })
  } catch {
    return NextResponse.json({ error: "Failed to update profile." }, { status: 500 })
  }
}
