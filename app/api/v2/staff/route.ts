import { NextResponse } from "next/server"
import pool from "@/lib/db"

// Only show actual staff roles on staff page
// beta_tester is now a badge, not a staff role
const STAFF_ROLES_FOR_DISPLAY = ["admin", "moderator", "support"]

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT name, role, avatar_url FROM users 
       WHERE role = ANY($1) 
       ORDER BY
        CASE role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 WHEN 'support' THEN 2 END,
        created_at ASC`,
      [STAFF_ROLES_FOR_DISPLAY]
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
