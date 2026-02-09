import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

// Get all tags for the user
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const result = await pool.query(
    "SELECT DISTINCT tag FROM scan_tags WHERE user_id = $1 ORDER BY tag",
    [session.userId],
  )
  return NextResponse.json({ tags: result.rows.map((r) => r.tag) })
}

// Add/remove tag from a scan
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { scanId, tag, action } = await request.json()

  if (!scanId || !tag || typeof tag !== "string") {
    return NextResponse.json({ error: "scanId and tag are required." }, { status: 400 })
  }

  const cleanTag = tag.trim().toLowerCase().slice(0, 30)
  if (!cleanTag) return NextResponse.json({ error: "Invalid tag." }, { status: 400 })

  // Verify scan belongs to user
  const scanCheck = await pool.query(
    "SELECT id FROM scan_history WHERE id = $1 AND user_id = $2",
    [scanId, session.userId],
  )
  if (scanCheck.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 })
  }

  if (action === "remove") {
    await pool.query(
      "DELETE FROM scan_tags WHERE scan_id = $1 AND user_id = $2 AND tag = $3",
      [scanId, session.userId, cleanTag],
    )
  } else {
    await pool.query(
      "INSERT INTO scan_tags (scan_id, user_id, tag) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [scanId, session.userId, cleanTag],
    )
  }

  // Return updated tags for this scan
  const tags = await pool.query(
    "SELECT tag FROM scan_tags WHERE scan_id = $1 AND user_id = $2 ORDER BY tag",
    [scanId, session.userId],
  )

  return NextResponse.json({ tags: tags.rows.map((r) => r.tag) })
}
