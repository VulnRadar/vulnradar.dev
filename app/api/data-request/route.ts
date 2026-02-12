import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ERROR_MESSAGES } from "@/lib/constants"

const COOLDOWN_DAYS = 30

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })
  }

  try {
    // Ensure the table has the columns we need
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS data TEXT;
        ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMPTZ;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `)

    // Get most recent download
    const result = await pool.query(
      `SELECT data, downloaded_at FROM data_requests WHERE user_id = $1 AND downloaded_at IS NOT NULL ORDER BY downloaded_at DESC LIMIT 1`,
      [session.userId],
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ hasData: false, canDownloadNew: true, lastDownloadAt: null })
    }

    const lastDownload = new Date(result.rows[0].downloaded_at)
    const cooldownEnd = new Date(lastDownload.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
    const canDownloadNew = new Date() >= cooldownEnd

    return NextResponse.json({
      hasData: true,
      canDownloadNew,
      lastDownloadAt: lastDownload.toISOString(),
      cooldownEndsAt: cooldownEnd.toISOString(),
      data: result.rows[0].data,
    })
  } catch (error) {
    console.error("[v0] Failed to fetch data request info:", error)
    return NextResponse.json({ hasData: false, canDownloadNew: true, lastDownloadAt: null })
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })
  }

  // Ensure columns exist
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS data TEXT;
      ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;
  `)

  // Check if they can request new data (30-day cooldown)
  const lastExport = await pool.query(
    `SELECT downloaded_at FROM data_requests WHERE user_id = $1 AND downloaded_at IS NOT NULL ORDER BY downloaded_at DESC LIMIT 1`,
    [session.userId],
  )

  if (lastExport.rows.length > 0) {
    const lastDownload = new Date(lastExport.rows[0].downloaded_at)
    const cooldownEnd = new Date(lastDownload.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
    if (new Date() < cooldownEnd) {
      const daysRemaining = Math.ceil((cooldownEnd.getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000))
      return NextResponse.json(
        { error: `You can request fresh data once every ${COOLDOWN_DAYS} days. Try again in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}.` },
        { status: 429 },
      )
    }
  }

  try {
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

    const jsonString = JSON.stringify(exportData, null, 2)

    // Store the data for future re-downloads
    // Perform an update first; if no rows were updated, insert a new row.
    // This avoids relying on a UNIQUE constraint for `user_id` which may not exist.
    const updateResult = await pool.query(
      `UPDATE data_requests SET data = $2, downloaded_at = NOW() WHERE user_id = $1`,
      [session.userId, jsonString],
    )

    if (updateResult.rowCount === 0) {
      await pool.query(
        `INSERT INTO data_requests (user_id, data, downloaded_at) VALUES ($1, $2, NOW())`,
        [session.userId, jsonString],
      )
    }

    return NextResponse.json({ success: true, data: exportData })
  } catch (error) {
    console.error("[v0] Failed to export data:", error)
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 })
  }
}
