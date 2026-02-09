import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import crypto from "crypto"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  // Check that the scan belongs to this user
  const existing = await pool.query(
    "SELECT id, share_token FROM scan_history WHERE id = $1 AND user_id = $2",
    [id, session.userId],
  )

  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 })
  }

  // If already has a share token, return it
  if (existing.rows[0].share_token) {
    return NextResponse.json({ token: existing.rows[0].share_token })
  }

  // Generate a new share token
  const token = crypto.randomBytes(32).toString("hex")

  await pool.query(
    "UPDATE scan_history SET share_token = $1 WHERE id = $2 AND user_id = $3",
    [token, id, session.userId],
  )

  return NextResponse.json({ token })
}

// DELETE to revoke sharing
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  await pool.query(
    "UPDATE scan_history SET share_token = NULL WHERE id = $1 AND user_id = $2",
    [id, session.userId],
  )

  return NextResponse.json({ success: true })
}
