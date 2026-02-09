import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

export async function POST() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    await pool.query(
      "UPDATE users SET tos_accepted_at = NOW() WHERE id = $1",
      [session.userId],
    )

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Failed to record acceptance." },
      { status: 500 },
    )
  }
}
