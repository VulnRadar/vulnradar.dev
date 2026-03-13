import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ERROR_MESSAGES } from "@/lib/constants"

export async function POST() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })
  }

  await pool.query(
    "UPDATE users SET onboarding_completed = true WHERE id = $1",
    [session.userId],
  )

  return NextResponse.json({ success: true })
}
