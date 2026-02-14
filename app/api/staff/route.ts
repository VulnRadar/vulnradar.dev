import { NextResponse } from "next/server"
import pool from "@/lib/db"

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT name, role, avatar_url FROM users WHERE role IN ('admin', 'moderator', 'support') ORDER BY
        CASE role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 WHEN 'support' THEN 2 END,
        created_at ASC`,
    )

    const staff = result.rows.map((row) => ({
      name: row.name || "Staff Member",
      role: row.role,
      avatarUrl: row.avatar_url || null,
    }))

    return NextResponse.json({ staff })
  } catch {
    return NextResponse.json({ staff: [] })
  }
}
