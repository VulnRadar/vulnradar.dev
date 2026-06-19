import { NextRequest, NextResponse } from "next/server"
import { randomInt } from "node:crypto"
import { getSession } from "@/lib/auth"
import pool from "@/lib/database/db"
import { billingVerificationCodeEmail, sendEmail } from "@/lib/email/email"

// POST /api/v2/billing/verify/send - Send billing verification code
export async function POST(_request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Get user email
    const userResult = await pool.query("SELECT email FROM users WHERE id = $1", [session.userId])
    const user = userResult.rows[0]
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Check if a code was recently sent (rate limit: 1 per 60 seconds)
    const recentCode = await pool.query(
      `SELECT created_at FROM billing_verification_codes 
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '60 seconds' 
       ORDER BY created_at DESC LIMIT 1`,
      [session.userId],
    )
    if (recentCode.rows.length > 0) {
      const createdAt = new Date(recentCode.rows[0].created_at)
      const secondsRemaining = Math.ceil(60 - (Date.now() - createdAt.getTime()) / 1000)
      return NextResponse.json(
        { error: `Please wait ${secondsRemaining} seconds before requesting another code.` },
        { status: 429 }
      )
    }

    // Delete old codes for this user
    await pool.query("DELETE FROM billing_verification_codes WHERE user_id = $1", [session.userId])

    // Generate 6-digit code
    const code = randomInt(100000, 999999).toString()

    // Store hashed code with 5 min expiry
    await pool.query(
      `INSERT INTO billing_verification_codes (user_id, code_hash, expires_at) 
       VALUES ($1, encode(sha256($2::bytea), 'hex'), NOW() + INTERVAL '5 minutes')`,
      [session.userId, code],
    )

    // Send the email
    const emailContent = billingVerificationCodeEmail(code)
    await sendEmail({
      to: user.email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    })

    // Mask email for UI
    const parts = user.email.split("@")
    const masked = parts[0].substring(0, 2) + "***@" + parts[1]

    return NextResponse.json({ 
      success: true, 
      message: "Verification code sent to your email.",
      maskedEmail: masked 
    })
  } catch (error) {
    console.error("[Billing] Error sending verification code:", error)
    return NextResponse.json({ error: "Failed to send verification code" }, { status: 500 })
  }
}
