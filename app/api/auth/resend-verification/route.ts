import { NextRequest, NextResponse } from "next/server"
import pool from "@/lib/db"
import { sendEmail, emailVerificationEmail, APP_URL } from "@/lib/email"
import { checkRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit"
import crypto from "crypto"

export async function POST(request: NextRequest) {
  try {
    const ip = await getClientIP()
    const rl = await checkRateLimit({ key: `resend-verify:${ip}`, ...RATE_LIMITS.forgotPassword })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Please try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
        { status: 429 }
      )
    }

    const { email } = await request.json()

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required." }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Find user (case-insensitive)
    const userRes = await pool.query(
      "SELECT id, name, email_verified_at FROM users WHERE LOWER(email) = $1",
      [normalizedEmail]
    )

    // Don't reveal if user exists or not
    if (userRes.rows.length === 0) {
      return NextResponse.json({
        message: "If an account exists with this email, a verification link has been sent."
      })
    }

    const user = userRes.rows[0]

    // Check if already verified
    if (user.email_verified_at) {
      return NextResponse.json({
        message: "If an account exists with this email, a verification link has been sent."
      })
    }

    // Delete existing tokens
    await pool.query("DELETE FROM email_verification_tokens WHERE user_id = $1", [user.id])

    // Generate new token
    const token = crypto.randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    await pool.query(
      "INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [user.id, token, expiresAt]
    )

    // Send verification email in background (don't block the response)
    const verifyLink = `${APP_URL}/verify-email?token=${token}`
    const emailContent = emailVerificationEmail(user.name || "there", verifyLink)

    setImmediate(() => {
      sendEmail({
        to: normalizedEmail,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      }).catch((err) => {
        console.error("Failed to send verification email:", err)
      })
    })

    return NextResponse.json({
      success: true,
      message: "If an account exists with this email, a verification link has been sent."
    })
  } catch (error) {
    console.error("Resend verification error:", error)
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 })
  }
}

