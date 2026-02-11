import { NextRequest, NextResponse } from "next/server"
import { createSession } from "@/lib/auth"
import { verifyTOTP } from "@/lib/totp"
import pool from "@/lib/db"

// POST: Verify 2FA code during login
export async function POST(request: NextRequest) {
  try {
    const { userId, code, backupCode } = await request.json()

    if (!userId || (!code && !backupCode)) {
      return NextResponse.json({ error: "User ID and code required." }, { status: 400 })
    }

    // Verify the pending 2FA token
    const pending = request.cookies.get("vulnradar_2fa_pending")?.value
    if (!pending || pending !== String(userId)) {
      return NextResponse.json({ error: "Invalid or expired 2FA session. Please log in again." }, { status: 401 })
    }

    // Get user's TOTP secret and backup codes
    const result = await pool.query(
      "SELECT totp_secret, totp_enabled, backup_codes FROM users WHERE id = $1",
      [userId],
    )
    const user = result.rows[0]
    if (!user || !user.totp_enabled || !user.totp_secret) {
      return NextResponse.json({ error: "2FA is not enabled for this account." }, { status: 400 })
    }

    let verified = false

    if (backupCode) {
      // Verify backup code
      const normalizedInput = backupCode.trim().toUpperCase().replace(/\s/g, "")
      const storedCodes: string[] = user.backup_codes ? JSON.parse(user.backup_codes) : []
      const matchIndex = storedCodes.findIndex(
        (c: string) => c.replace(/-/g, "") === normalizedInput.replace(/-/g, ""),
      )
      if (matchIndex >= 0) {
        verified = true
        // Consume the backup code (one-time use)
        storedCodes.splice(matchIndex, 1)
        await pool.query("UPDATE users SET backup_codes = $1 WHERE id = $2", [
          JSON.stringify(storedCodes),
          userId,
        ])
      }
    } else if (code) {
      // Verify TOTP code
      if (typeof code !== "string" || code.length !== 6) {
        return NextResponse.json({ error: "Valid 6-digit code required." }, { status: 400 })
      }
      verified = verifyTOTP(user.totp_secret, code)
    }

    if (!verified) {
      return NextResponse.json({ error: "Invalid code. Please try again." }, { status: 400 })
    }

    // Create session with IP and user agent
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const userAgent = request.headers.get("user-agent") || undefined
    await createSession(userId, ip, userAgent)

    // Clear the pending cookie
    const response = NextResponse.json({ success: true })
    response.cookies.delete("vulnradar_2fa_pending")
    return response
  } catch (error) {
    console.error("2FA verify error:", error)
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 })
  }
}
