import pool from "@/lib/db"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const isAuthenticated = searchParams.get("authenticated") === "true"
    const isStaff = searchParams.get("staff") === "true"
    
    const now = new Date()
    
    // Fetch active notifications matching criteria
    const result = await pool.query(
      `SELECT id, title, message, type, variant, audience, path_pattern, is_active,
              is_dismissible, dismiss_duration_hours, action_label, action_url, action_external, priority
       FROM admin_notifications
       WHERE is_active = true
       AND (starts_at IS NULL OR starts_at <= $1)
       AND (ends_at IS NULL OR ends_at > $1)
       AND (
         audience = 'all' 
         OR (audience = 'authenticated' AND $2 = true)
         OR (audience = 'unauthenticated' AND $2 = false)
         OR (audience = 'staff' AND $3 = true)
         OR (audience = 'admin' AND $3 = true)
       )
       ORDER BY priority DESC, created_at DESC`,
      [now, isAuthenticated, isStaff]
    )

    return Response.json(result.rows)
  } catch (error) {
    console.error("Error fetching active notifications:", error)
    return Response.json({ error: "Failed to fetch notifications" }, { status: 500 })
  }
}
