import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ERROR_MESSAGES } from "@/lib/constants"

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })
  }

  const result = await pool.query(
    `SELECT data FROM data_requests
     WHERE user_id = $1 AND downloaded_at IS NOT NULL AND data IS NOT NULL
     ORDER BY downloaded_at DESC
     LIMIT 1`,
    [session.userId],
  )

  if (result.rows.length === 0 || !result.rows[0].data) {
    return NextResponse.json(
      { error: "No data export found." },
      { status: 404 },
    )
  }

  return NextResponse.json(result.rows[0].data)
}
