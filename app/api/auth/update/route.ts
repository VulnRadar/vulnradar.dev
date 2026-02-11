import { NextRequest, NextResponse } from "next/server"
import { getSession, hashPassword, verifyPassword } from "@/lib/auth"
import { sendEmail, profileNameChangedEmail, profileEmailChangedEmail, profilePasswordChangedEmail } from "@/lib/email"
import pool from "@/lib/db"

export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { name, email, currentPassword, newPassword } = body

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

        // Send security email (don't await to avoid blocking)
        const emailContent = profileNameChangedEmail(currentName || "Not set", trimmed, { ipAddress: ip, userAgent })
        sendEmail({ to: currentEmail, ...emailContent }).catch(console.error)
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

        // Send security email to BOTH old and new email addresses (don't await)
        const emailContent = profileEmailChangedEmail(currentEmail, trimmedEmail, { ipAddress: ip, userAgent })
        sendEmail({ to: currentEmail, ...emailContent }).catch(console.error)
        sendEmail({ to: trimmedEmail, ...emailContent }).catch(console.error)
      }
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

      // Send security email (don't await)
      const emailContent = profilePasswordChangedEmail({ ipAddress: ip, userAgent })
      sendEmail({ to: currentEmail, ...emailContent }).catch(console.error)
    }

    // Fetch updated user info
    const updated = await pool.query(
      "SELECT id, email, name FROM users WHERE id = $1",
      [session.userId],
    )

    return NextResponse.json({
      userId: updated.rows[0].id,
      email: updated.rows[0].email,
      name: updated.rows[0].name,
      message: "Profile updated successfully.",
    })
  } catch {
    return NextResponse.json({ error: "Failed to update profile." }, { status: 500 })
  }
}
