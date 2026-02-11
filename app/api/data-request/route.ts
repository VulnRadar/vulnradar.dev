import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { sendNotificationEmail } from "@/lib/notifications"
import { dataRequestCreatedEmail } from "@/lib/email"

const COOLDOWN_HOURS = 30

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Get most recent data request
  const result = await pool.query(
    `SELECT id, status, data, requested_at, completed_at
     FROM data_requests
     WHERE user_id = $1
     ORDER BY requested_at DESC
     LIMIT 1`,
    [session.userId],
  )

  if (result.rows.length === 0) {
    return NextResponse.json({ hasRequest: false, canRequest: true })
  }

  const req = result.rows[0]
  const requestedAt = new Date(req.requested_at)
  const cooldownEnd = new Date(requestedAt.getTime() + COOLDOWN_HOURS * 60 * 60 * 1000)
  const canRequest = new Date() >= cooldownEnd

  return NextResponse.json({
    hasRequest: true,
    canRequest,
    cooldownEndsAt: cooldownEnd.toISOString(),
    request: {
      id: req.id,
      status: req.status,
      requestedAt: req.requested_at,
      completedAt: req.completed_at,
      hasData: !!req.data,
    },
  })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Check cooldown
  const lastReq = await pool.query(
    `SELECT requested_at FROM data_requests
     WHERE user_id = $1
     ORDER BY requested_at DESC
     LIMIT 1`,
    [session.userId],
  )

  if (lastReq.rows.length > 0) {
    const requestedAt = new Date(lastReq.rows[0].requested_at)
    const cooldownEnd = new Date(requestedAt.getTime() + COOLDOWN_HOURS * 60 * 60 * 1000)
    if (new Date() < cooldownEnd) {
      return NextResponse.json(
        { error: `You can only request data once every ${COOLDOWN_HOURS} hours. Try again after ${cooldownEnd.toISOString()}.` },
        { status: 429 },
      )
    }
  }

  // Gather all user data
  const [userData, apiKeysData, scanHistoryData, apiUsageData] = await Promise.all([
    pool.query("SELECT id, email, name, created_at FROM users WHERE id = $1", [session.userId]),
    pool.query(
      "SELECT id, key_prefix, name, daily_limit, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC",
      [session.userId],
    ),
    pool.query(
      "SELECT id, url, summary, findings_count, duration, scanned_at FROM scan_history WHERE user_id = $1 ORDER BY scanned_at DESC",
      [session.userId],
    ),
    pool.query(
      `SELECT au.used_at, ak.key_prefix, ak.name as key_name
       FROM api_usage au
       JOIN api_keys ak ON au.api_key_id = ak.id
       WHERE ak.user_id = $1
       ORDER BY au.used_at DESC
       LIMIT 500`,
      [session.userId],
    ),
  ])

  const exportData = {
    exportedAt: new Date().toISOString(),
    user: userData.rows[0] || null,
    apiKeys: apiKeysData.rows,
    scanHistory: scanHistoryData.rows,
    apiUsage: apiUsageData.rows,
  }

  // Store the data request
  await pool.query(
    `INSERT INTO data_requests (user_id, status, data, completed_at)
     VALUES ($1, 'completed', $2, NOW())`,
    [session.userId, JSON.stringify(exportData)],
  )

  // Send notification email
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "Unknown"
  const userAgent = request.headers.get("user-agent") || "Unknown"
  const emailContent = dataRequestCreatedEmail("export", { ipAddress: ip, userAgent })

  sendNotificationEmail({
    userId: session.userId,
    userEmail: session.email,
    type: "data_requests",
    emailContent,
  }).catch((err) => console.error("Failed to send data request notification:", err))

  return NextResponse.json({ success: true, data: exportData })
}
