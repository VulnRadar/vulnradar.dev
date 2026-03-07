import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ERROR_MESSAGES } from "@/lib/constants"

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })
  }

  const { id } = await params

  // Get the scan to verify ownership
  const scanResult = await pool.query(
    `SELECT id, user_id FROM scan_history WHERE id = $1`,
    [id],
  )

  if (scanResult.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 })
  }

  const scan = scanResult.rows[0]

  // Only the owner can delete their own scans
  if (scan.user_id !== session.userId) {
    return NextResponse.json({ error: "Only the scan owner can delete it" }, { status: 403 })
  }

  // Delete the scan from the database
  try {
    await pool.query(`DELETE FROM scan_history WHERE id = $1`, [id])
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete scan:", error)
    return NextResponse.json({ error: "Failed to delete scan" }, { status: 500 })
  }
}
