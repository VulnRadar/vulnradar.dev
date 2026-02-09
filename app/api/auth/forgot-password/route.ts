import { NextRequest, NextResponse } from "next/server"
import pool from "@/lib/db"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import crypto from "crypto"

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit({ key: `forgot:${ip}`, ...RATE_LIMITS.forgotPassword })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many reset attempts. Please try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
        { status: 429 },
      )
    }

    const { email } = await request.json()
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required." }, { status: 400 })
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Always return success to prevent email enumeration
    const successMsg = { message: "If an account with that email exists, a reset link has been generated." }

    const userRes = await pool.query("SELECT id, totp_enabled FROM users WHERE email = $1", [normalizedEmail])
    if (userRes.rows.length === 0) {
      return NextResponse.json(successMsg)
    }

    const user = userRes.rows[0]

    // Delete any existing tokens for this user
    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [user.id])

    // Generate a secure token
    const token = crypto.randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await pool.query(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [user.id, token, expiresAt],
    )

    // In production you'd send an email here. For now we return the token
    // so the UI can construct the reset link. This simulates the email flow.
    return NextResponse.json({
      ...successMsg,
      // This would normally be sent via email only:
      resetToken: token,
      has2FA: user.totp_enabled,
    })
  } catch {
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 })
  }
}
