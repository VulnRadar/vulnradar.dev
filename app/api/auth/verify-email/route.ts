import { NextRequest, NextResponse } from "next/server"
import pool from "@/lib/db"
import { createSession } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json()

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Verification token is required." }, { status: 400 })
    }

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      // Find valid token
      const tokenRes = await client.query(
        `SELECT evt.id, evt.user_id, evt.expires_at, u.email, u.name, u.email_verified_at
         FROM email_verification_tokens evt
         JOIN users u ON evt.user_id = u.id
         WHERE evt.token_hash = $1 AND evt.used_at IS NULL
         FOR UPDATE`,
        [token]
      )

      if (tokenRes.rows.length === 0) {
        await client.query("ROLLBACK")
        // Check if token exists but was already used
        const usedTokenRes = await client.query(
          "SELECT id, used_at FROM email_verification_tokens WHERE token_hash = $1",
          [token]
        )
        if (usedTokenRes.rows.length > 0) {
          return NextResponse.json({ error: "This verification link has already been used." }, { status: 400 })
        }
        return NextResponse.json({ error: "Invalid or expired verification link." }, { status: 400 })
      }

      const verificationToken = tokenRes.rows[0]

      // Check if already verified
      if (verificationToken.email_verified_at) {
        await client.query("ROLLBACK")
        return NextResponse.json({
          message: "Email already verified. You can log in.",
          alreadyVerified: true
        })
      }

      // Check expiration
      if (new Date(verificationToken.expires_at) < new Date()) {
        await client.query("DELETE FROM email_verification_tokens WHERE id = $1", [verificationToken.id])
        await client.query("COMMIT")
        return NextResponse.json({
          error: "This verification link has expired. Please request a new one.",
          expired: true
        }, { status: 400 })
      }

      // Mark email as verified
      await client.query(
        "UPDATE users SET email_verified_at = NOW() WHERE id = $1",
        [verificationToken.user_id]
      )

      // Mark token as used
      await client.query(
        "UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1",
        [verificationToken.id]
      )

      await client.query("COMMIT")

      // Create session for the user (auto-login after verification)
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
      const userAgent = request.headers.get("user-agent") || undefined
      await createSession(verificationToken.user_id, ip, userAgent)

      return NextResponse.json({
        message: "Email verified successfully! You are now logged in.",
        verified: true,
        user: {
          email: verificationToken.email,
          name: verificationToken.name,
        }
      })
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    } finally {
      client.release()
    }
  } catch (error) {
    console.error("Email verification error:", error)
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 })
  }
}

// GET endpoint for when user clicks the link directly
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get("token")

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", request.url))
  }

  // Redirect to the verify-email page which will handle the verification
  return NextResponse.redirect(new URL(`/verify-email?token=${token}`, request.url))
}

