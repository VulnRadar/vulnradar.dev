import { NextResponse } from "next/server"
import pool from "@/lib/db"
import { hashPassword } from "@/lib/auth"
import { sendEmail, passwordChangedEmail } from "@/lib/email"

export async function POST(request: Request) {
  try {
    const { token, password } = await request.json()

    if (!token || !password) {
      return NextResponse.json({ error: "Token and password are required." }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 })
    }

    // Find valid token - atomic check and mark as used in single transaction
    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      const tokenRes = await client.query(
        `SELECT prt.id, prt.user_id, prt.expires_at, u.email, u.totp_enabled
         FROM password_reset_tokens prt
         JOIN users u ON prt.user_id = u.id
         WHERE prt.token_hash = $1 AND prt.used_at IS NULL
         FOR UPDATE`,
        [token],
      )

      if (tokenRes.rows.length === 0) {
        await client.query("ROLLBACK")
        return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 })
      }

      const resetToken = tokenRes.rows[0]

      if (new Date(resetToken.expires_at) < new Date()) {
        await client.query("DELETE FROM password_reset_tokens WHERE id = $1", [resetToken.id])
        await client.query("COMMIT")
        return NextResponse.json({ error: "This reset link has expired. Please request a new one." }, { status: 400 })
      }

      // Hash new password and update
      const passwordHash = hashPassword(password)
      await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, resetToken.user_id])

      // Mark token as used immediately to prevent duplicate processing
      await client.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1", [resetToken.id])

      // Kill all existing sessions for security
      await client.query("DELETE FROM sessions WHERE user_id = $1", [resetToken.user_id])

      await client.query("COMMIT")

      // Send security notification email in background (only after successful commit)
      const emailContent = passwordChangedEmail(resetToken.totp_enabled)
      const emailTo = resetToken.email

      setImmediate(() => {
        sendEmail({
          to: emailTo,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
        }).catch((err) => {
          console.error("Password change notification email failed:", err)
        })
      })

      const responseMessage = resetToken.totp_enabled
        ? "Password has been reset successfully. You can now log in with your new password and 2FA code."
        : "Password has been reset successfully. You can now log in."

      return NextResponse.json({ message: responseMessage })
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    console.error("Reset password error:", err)
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 })
  }
}
