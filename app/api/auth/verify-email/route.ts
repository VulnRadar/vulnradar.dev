import { NextRequest, NextResponse } from "next/server"
import pool from "@/lib/db"
import { createSession } from "@/lib/auth"
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api-utils"
import { getClientIp, getUserAgent } from "@/lib/request-utils"
import { SUCCESS_MESSAGES, ERROR_MESSAGES } from "@/lib/constants"

export const POST = withErrorHandling(async (request: NextRequest) => {
  const parsed = await parseBody<{ token: string }>(request)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const { token } = parsed.data

  if (!token || typeof token !== "string") {
    return ApiResponse.badRequest("Verification token is required.")
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
        return ApiResponse.badRequest("This verification link has already been used.")
      }
      return ApiResponse.badRequest("Invalid or expired verification link.")
    }

    const verificationToken = tokenRes.rows[0]

    // Check if already verified
    if (verificationToken.email_verified_at) {
      await client.query("ROLLBACK")
      return ApiResponse.success({
        message: "Email already verified. You can log in.",
        alreadyVerified: true
      })
    }

    // Check expiration
    if (new Date(verificationToken.expires_at) < new Date()) {
      await client.query("DELETE FROM email_verification_tokens WHERE id = $1", [verificationToken.id])
      await client.query("COMMIT")
      return ApiResponse.badRequest("This verification link has expired. Please request a new one.", 400)
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
    const ip = await getClientIp()
    const userAgent = await getUserAgent()
    await createSession(verificationToken.user_id, ip, userAgent)

    return ApiResponse.success({
      message: SUCCESS_MESSAGES.EMAIL_VERIFIED,
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
})

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

