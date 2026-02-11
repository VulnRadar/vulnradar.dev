import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { getSession, verifyPassword } from "@/lib/auth"
import { sendEmail, backupCodesRegeneratedEmail } from "@/lib/email"
import pool from "@/lib/db"

function generateBackupCodes(count = 8): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase()
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`)
  }
  return codes
}

// GET: Get remaining backup code count
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const result = await pool.query("SELECT backup_codes, totp_enabled FROM users WHERE id = $1", [session.userId])
  const user = result.rows[0]
  if (!user || !user.totp_enabled) {
    return NextResponse.json({ remaining: 0 })
  }

  const codes: string[] = user.backup_codes ? JSON.parse(user.backup_codes) : []
  return NextResponse.json({ remaining: codes.length })
}

// POST: Regenerate backup codes (requires password)
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { password } = await request.json()
  if (!password) {
    return NextResponse.json({ error: "Password is required to regenerate backup codes." }, { status: 400 })
  }

  const result = await pool.query("SELECT password_hash, totp_enabled FROM users WHERE id = $1", [session.userId])
  const user = result.rows[0]
  if (!user || !user.totp_enabled) {
    return NextResponse.json({ error: "2FA is not enabled." }, { status: 400 })
  }

  if (!verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 })
  }

  const backupCodes = generateBackupCodes(8)
  await pool.query("UPDATE users SET backup_codes = $1 WHERE id = $2", [JSON.stringify(backupCodes), session.userId])

  // Send security notification email (don't await)
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "Unknown"
  const userAgent = request.headers.get("user-agent") || "Unknown"

  const emailContent = backupCodesRegeneratedEmail({ ipAddress: ip, userAgent })
  sendEmail({ to: session.email, ...emailContent }).catch(console.error)

  return NextResponse.json({ backupCodes })
}
