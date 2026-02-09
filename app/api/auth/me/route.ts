import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Get 2FA and admin status
  const result = await pool.query(
    "SELECT totp_enabled, is_admin, onboarding_completed FROM users WHERE id = $1",
    [session.userId],
  )
  const user = result.rows[0]

  return NextResponse.json({
    userId: session.userId,
    email: session.email,
    name: session.name,
    tosAcceptedAt: session.tosAcceptedAt,
    totpEnabled: user?.totp_enabled || false,
    isAdmin: user?.is_admin || false,
    onboardingCompleted: user?.onboarding_completed || false,
  })
}
