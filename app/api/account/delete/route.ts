import { NextResponse } from "next/server"
import { getSession, destroySession } from "@/lib/auth"
import pool from "@/lib/db"
import { ERROR_MESSAGES } from "@/lib/constants"

export async function POST() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })
  }

  // CASCADE in the DB schema will delete all related data:
  // sessions, api_keys, api_usage (via api_keys cascade), scan_history, data_requests
  await pool.query("DELETE FROM users WHERE id = $1", [session.userId])

  // Clear the session cookie
  await destroySession()

  return NextResponse.json({ success: true })
}
