import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { getSession } from "@/lib/auth"
import { generateSecret, verifyTOTP, generateOtpAuthUri } from "@/lib/totp"
import { sendEmail, twoFactorEnabledEmail } from "@/lib/email"
import pool from "@/lib/db"

function generateBackupCodes(count = 8): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase()
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`)
  }
  return codes
}

// GET: Generate a new secret and return the URI for QR code
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const secret = generateSecret()
  const uri = generateOtpAuthUri(secret, session.email)

  // Store the secret temporarily (not enabled yet until they verify)
  await pool.query("UPDATE users SET totp_secret = $1 WHERE id = $2", [secret, session.userId])

  return NextResponse.json({ secret, uri })
}

// POST: Verify the code and enable 2FA
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { code } = await request.json()
  if (!code || typeof code !== "string" || code.length !== 6) {
    return NextResponse.json({ error: "Valid 6-digit code required" }, { status: 400 })
  }

  // Get the stored secret
  const result = await pool.query("SELECT totp_secret FROM users WHERE id = $1", [session.userId])
  const secret = result.rows[0]?.totp_secret
  if (!secret) {
    return NextResponse.json({ error: "No 2FA setup in progress. Start setup first." }, { status: 400 })
  }

  // Verify the code
  if (!verifyTOTP(secret, code)) {
    return NextResponse.json({ error: "Invalid code. Check your authenticator app and try again." }, { status: 400 })
  }

  // Generate backup codes and enable 2FA
  const backupCodes = generateBackupCodes(8)
  await pool.query(
    "UPDATE users SET totp_enabled = true, backup_codes = $1 WHERE id = $2",
    [JSON.stringify(backupCodes), session.userId],
  )

  // Send security notification email (don't await)
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "Unknown"
  const userAgent = request.headers.get("user-agent") || "Unknown"

  const emailContent = twoFactorEnabledEmail({ ipAddress: ip, userAgent })
  sendEmail({ to: session.email, ...emailContent }).catch(console.error)

  return NextResponse.json({ success: true, backupCodes })
}
