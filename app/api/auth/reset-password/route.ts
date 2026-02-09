import { NextResponse } from "next/server"
import pool from "@/lib/db"
import { hashPassword } from "@/lib/auth"

export async function POST(request: Request) {
  try {
    const { token, password } = await request.json()

    if (!token || !password) {
      return NextResponse.json({ error: "Token and password are required." }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 })
    }

    // Find valid token
    const tokenRes = await pool.query(
      `SELECT prt.id, prt.user_id, prt.expires_at, u.email, u.totp_enabled
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       WHERE prt.token_hash = $1 AND prt.used_at IS NULL`,
      [token],
    )

    if (tokenRes.rows.length === 0) {
      return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 })
    }

    const resetToken = tokenRes.rows[0]

    if (new Date(resetToken.expires_at) < new Date()) {
      await pool.query("DELETE FROM password_reset_tokens WHERE id = $1", [resetToken.id])
      return NextResponse.json({ error: "This reset link has expired. Please request a new one." }, { status: 400 })
    }

    // If user has 2FA, they cannot reset password this way
    if (resetToken.totp_enabled) {
      return NextResponse.json({
        error: "This account has two-factor authentication enabled. Password cannot be reset via this method for security reasons. Please contact support.",
      }, { status: 403 })
    }

    // Hash new password and update
    const passwordHash = hashPassword(password)
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, resetToken.user_id])

    // Mark token as used
    await pool.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1", [resetToken.id])

    // Kill all existing sessions for security
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [resetToken.user_id])

    return NextResponse.json({ message: "Password has been reset successfully. You can now log in." })
  } catch (err) {
    console.error("Reset password error:", err)
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 })
  }
}
