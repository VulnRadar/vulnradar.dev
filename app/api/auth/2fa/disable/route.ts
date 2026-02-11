import { NextRequest, NextResponse } from "next/server"
import { getSession, verifyPassword } from "@/lib/auth"
import { twoFactorDisabledEmail } from "@/lib/email"
import { sendNotificationEmail } from "@/lib/notifications"
import pool from "@/lib/db"
import { ERROR_MESSAGES } from "@/lib/constants"

// POST: Disable 2FA (requires current password)
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })

  const { password } = await request.json()
  if (!password) {
    return NextResponse.json({ error: "Current password is required to disable 2FA." }, { status: 400 })
  }

  // Verify password
  const result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [session.userId])
  const user = result.rows[0]
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 })
  }

  // Disable 2FA and clear backup codes
  await pool.query(
    "UPDATE users SET totp_enabled = false, totp_secret = NULL, backup_codes = NULL WHERE id = $1",
    [session.userId],
  )

  // Send security notification email (don't await)
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "Unknown"
  const userAgent = request.headers.get("user-agent") || "Unknown"

  const emailContent = twoFactorDisabledEmail({ ipAddress: ip, userAgent })
  sendNotificationEmail({
    userId: session.userId,
    userEmail: session.email,
    type: "security",
    emailContent,
  }).catch((err) => console.error("Failed to send 2FA disabled notification:", err))

  return NextResponse.json({ success: true })
}
