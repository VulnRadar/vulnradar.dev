import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

// GET: Fetch notification preferences
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await pool.query(
    `SELECT email_api_keys, email_webhooks, email_schedules, email_data_requests, email_security
     FROM notification_preferences WHERE user_id = $1`,
    [session.userId]
  )

  // Return defaults if no preferences set
  if (result.rows.length === 0) {
    return NextResponse.json({
      email_api_keys: true,
      email_webhooks: true,
      email_schedules: true,
      email_data_requests: true,
      email_security: true,
    })
  }

  return NextResponse.json(result.rows[0])
}

// PUT: Update notification preferences
export async function PUT(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const {
    email_api_keys,
    email_webhooks,
    email_schedules,
    email_data_requests,
    email_security,
  } = body

  // Validate all fields are booleans
  const fields = { email_api_keys, email_webhooks, email_schedules, email_data_requests, email_security }
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "boolean") {
      return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 })
    }
  }

  // Upsert preferences
  const result = await pool.query(
    `INSERT INTO notification_preferences (user_id, email_api_keys, email_webhooks, email_schedules, email_data_requests, email_security, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       email_api_keys = $2,
       email_webhooks = $3,
       email_schedules = $4,
       email_data_requests = $5,
       email_security = $6,
       updated_at = NOW()
     RETURNING email_api_keys, email_webhooks, email_schedules, email_data_requests, email_security`,
    [session.userId, email_api_keys, email_webhooks, email_schedules, email_data_requests, email_security]
  )

  return NextResponse.json(result.rows[0])
}

