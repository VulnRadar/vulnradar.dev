import { NextRequest, NextResponse } from "next/server"
import pool from "@/lib/db"
import { getSession } from "@/lib/auth"
import { STAFF_ROLE_HIERARCHY } from "@/lib/constants"
import { sendEmail } from "@/lib/email"

async function requireAdmin() {
  const session = await getSession()
  if (!session) return null
  const result = await pool.query("SELECT id, role FROM users WHERE id = $1", [session.userId])
  const user = result.rows[0]
  if (!user) return null
  const role = user.role || "user"
  if ((STAFF_ROLE_HIERARCHY[role] || 0) < (STAFF_ROLE_HIERARCHY.admin || 3)) return null
  return { ...session, id: user.id, role }
}

/**
 * Admin Features API
 * POST /api/v2/admin/features - Manage IP rules, security alerts, system settings, broadcasts, password policies
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json()
    const { action, section } = body

    if (section === "ip_rules") {
      if (action === "create") {
        const { rule_type, ip_address, description, reason, expires_at } = body
        
        const result = await pool.query(
          `INSERT INTO ip_rules (rule_type, ip_address, description, reason, created_by, expires_at) 
           VALUES ($1, $2, $3, $4, $5, $6) 
           RETURNING id, rule_type, ip_address, description, is_active, created_at`,
          [rule_type, ip_address, description, reason, user.id, expires_at]
        )
        
        return NextResponse.json({ rule: result.rows[0], success: true })
      }

      if (action === "list") {
        const result = await pool.query(
          `SELECT id, rule_type, ip_address, description, reason, hit_count, is_active, created_at, expires_at 
           FROM ip_rules 
           WHERE is_active = true 
           ORDER BY created_at DESC`
        )
        return NextResponse.json({ rules: result.rows })
      }

      if (action === "delete") {
        const { id } = body
        await pool.query(`UPDATE ip_rules SET is_active = false WHERE id = $1`, [id])
        return NextResponse.json({ success: true })
      }

      if (action === "update") {
        const { id, ...updates } = body
        const fields = Object.keys(updates)
          .map((k, i) => `${k} = $${i + 2}`)
          .join(", ")
        
        await pool.query(
          `UPDATE ip_rules SET ${fields} WHERE id = $1`,
          [id, ...Object.values(updates)]
        )
        return NextResponse.json({ success: true })
      }
    }

    if (section === "security_alerts") {
      if (action === "list") {
        const { limit = 50, offset = 0, severity, user_id } = body
        
        let query = `SELECT * FROM security_alerts WHERE 1=1`
        const params: any[] = []
        
        if (severity) {
          query += ` AND severity = $${params.length + 1}`
          params.push(severity)
        }
        
        if (user_id) {
          query += ` AND user_id = $${params.length + 1}`
          params.push(user_id)
        }
        
        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
        params.push(limit, offset)
        
        const result = await pool.query(query, params)
        return NextResponse.json({ alerts: result.rows })
      }

      if (action === "resolve") {
        const { id, action_taken } = body
        await pool.query(
          `UPDATE security_alerts SET resolved_at = NOW(), resolved_by = $1, action_taken = $2 WHERE id = $3`,
          [user.id, action_taken, id]
        )
        return NextResponse.json({ success: true })
      }
    }

    if (section === "system_settings") {
      if (action === "get") {
        const { key } = body
        const result = await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [key])
        return NextResponse.json({ value: result.rows[0]?.value })
      }

      if (action === "set") {
        const { key, value, description } = body
        await pool.query(
          `INSERT INTO system_settings (key, value, description, updated_by) 
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $4, updated_at = NOW()`,
          [key, value, description, user.id]
        )
        return NextResponse.json({ success: true })
      }

      if (action === "list") {
        const result = await pool.query(`SELECT key, value, description, updated_at FROM system_settings`)
        return NextResponse.json({ settings: result.rows })
      }
    }

    if (section === "broadcast") {
      if (action === "create") {
        const { title, content, message_type, segment_filter, scheduled_at } = body
        
        const result = await pool.query(
          `INSERT INTO broadcast_messages (title, content, message_type, segment_filter, created_by, scheduled_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, title, status, created_at`,
          [title, content, message_type, segment_filter, user.id, scheduled_at, "draft"]
        )
        
        return NextResponse.json({ message: result.rows[0], success: true })
      }

      if (action === "list") {
        const result = await pool.query(
          `SELECT 
             bm.id, 
             bm.title,
             bm.status,
             bm.created_at,
             bm.sent_at,
             cu.name as created_by_name,
             su.name as sent_by_name
           FROM broadcast_messages bm
           LEFT JOIN users cu ON bm.created_by = cu.id
           LEFT JOIN users su ON bm.sent_by = su.id
           ORDER BY bm.created_at DESC`
        )
        return NextResponse.json({ messages: result.rows })
      }

      if (action === "send") {
        const { id } = body
        
        // Get message first to validate it exists
        const check = await pool.query(`SELECT id FROM broadcast_messages WHERE id = $1 AND status = 'draft'`, [id])
        if (check.rows.length === 0) {
          return NextResponse.json({ error: "Broadcast not found or already sent" }, { status: 404 })
        }
        
        // Update status to sent immediately (no 'sending' state due to constraint)
        await pool.query(
          `UPDATE broadcast_messages SET status = 'sent', sent_by = $1, sent_at = NOW() WHERE id = $2`,
          [user.id, id]
        )
        
        // Queue background job to send emails
        setTimeout(async () => {
          try {
            const messageResult = await pool.query(
              `SELECT id, title, content, segment_filter FROM broadcast_messages WHERE id = $1`,
              [id]
            )
            const message = messageResult.rows[0]
            if (!message) return
            
            let userQuery = `SELECT id, email FROM users WHERE email_verified_at IS NOT NULL`
            const queryParams: string[] = []
            const segment = message.segment_filter?.segment || message.segment_filter
            
            if (segment && segment !== "all") {
              if (segment === "premium") {
                userQuery += ` AND subscription_tier != 'free'`
              } else if (segment === "free") {
                userQuery += ` AND subscription_tier = 'free'`
              } else if (segment === "core_supporter") {
                userQuery += ` AND subscription_tier = 'core_supporter'`
              } else if (segment === "pro_supporter") {
                userQuery += ` AND subscription_tier = 'pro_supporter'`
              } else if (segment === "elite_supporter") {
                userQuery += ` AND subscription_tier = 'elite_supporter'`
              } else if (typeof segment === "string" && segment.startsWith("email:")) {
                const specificEmail = segment.replace("email:", "")
                userQuery += ` AND email = $1`
                queryParams.push(specificEmail)
              }
            }
            
            const usersResult = await pool.query(userQuery, queryParams)
            for (const recipient of usersResult.rows) {
              try {
                await sendEmail({
                  to: recipient.email,
                  subject: message.title,
                  text: message.content.replace(/<[^>]*>/g, ''),
                  html: message.content,
                  skipLayout: false
                })
                await pool.query(
                  `INSERT INTO broadcast_recipients (message_id, user_id, status) VALUES ($1, $2, 'sent')`,
                  [id, recipient.id]
                )
              } catch (err) {
                console.error(`[Broadcast] Failed to send to ${recipient.email}:`, err)
              }
            }
          } catch (err) {
            console.error("[Broadcast] Background job failed:", err)
          }
        }, 100)
        
        return NextResponse.json({ success: true, message: "Broadcast queued for sending" })
      }

      if (action === "delete") {
        const { id } = body
        // Only allow deleting drafts
        const result = await pool.query(
          `DELETE FROM broadcast_messages WHERE id = $1 AND status = 'draft' RETURNING id`,
          [id]
        )
        if (result.rows.length === 0) {
          return NextResponse.json({ error: "Cannot delete sent broadcasts" }, { status: 400 })
        }
        return NextResponse.json({ success: true })
      }

      if (action === "resend") {
        const { id } = body
        
        // Get message and check if it's been sent
        const check = await pool.query(`SELECT id FROM broadcast_messages WHERE id = $1 AND status = 'sent'`, [id])
        if (check.rows.length === 0) {
          return NextResponse.json({ error: "Can only resend sent broadcasts" }, { status: 400 })
        }
        
        // Update sent_at and sent_by for audit trail
        await pool.query(
          `UPDATE broadcast_messages SET sent_by = $1, sent_at = NOW() WHERE id = $2`,
          [user.id, id]
        )
        
        // Queue background job to send emails again
        setTimeout(async () => {
          try {
            const messageResult = await pool.query(
              `SELECT id, title, content, segment_filter FROM broadcast_messages WHERE id = $1`,
              [id]
            )
            const message = messageResult.rows[0]
            if (!message) return
            
            let userQuery = `SELECT id, email FROM users WHERE email_verified_at IS NOT NULL`
            const queryParams: string[] = []
            const segment = message.segment_filter?.segment || message.segment_filter
            
            if (segment && segment !== "all") {
              if (segment === "premium") {
                userQuery += ` AND subscription_tier != 'free'`
              } else if (segment === "free") {
                userQuery += ` AND subscription_tier = 'free'`
              } else if (segment === "core_supporter") {
                userQuery += ` AND subscription_tier = 'core_supporter'`
              } else if (segment === "pro_supporter") {
                userQuery += ` AND subscription_tier = 'pro_supporter'`
              } else if (segment === "elite_supporter") {
                userQuery += ` AND subscription_tier = 'elite_supporter'`
              } else if (typeof segment === "string" && segment.startsWith("email:")) {
                const specificEmail = segment.replace("email:", "")
                userQuery += ` AND email = $1`
                queryParams.push(specificEmail)
              }
            }
            
            const usersResult = await pool.query(userQuery, queryParams)
            for (const recipient of usersResult.rows) {
              try {
                await sendEmail({
                  to: recipient.email,
                  subject: message.title,
                  text: message.content.replace(/<[^>]*>/g, ''),
                  html: message.content,
                  skipLayout: false
                })
                await pool.query(
                  `INSERT INTO broadcast_recipients (message_id, user_id, status) VALUES ($1, $2, 'sent')`,
                  [id, recipient.id]
                )
              } catch (err) {
                console.error(`[Broadcast] Failed to send to ${recipient.email}:`, err)
              }
            }
          } catch (err) {
            console.error("[Broadcast] Background job failed:", err)
          }
        }, 100)
        
        return NextResponse.json({ success: true, message: "Broadcast resent" })
      }
    }

    if (section === "password_policies") {
      if (action === "list") {
        const result = await pool.query(
          `SELECT id, policy_name, rotation_days, grace_period_days, is_active 
           FROM password_rotation_policies 
           ORDER BY created_at DESC`
        )
        return NextResponse.json({ policies: result.rows })
      }

      if (action === "create") {
        const { policy_name, rotation_days, grace_period_days, enforce_complexity } = body
        
        const result = await pool.query(
          `INSERT INTO password_rotation_policies (policy_name, rotation_days, grace_period_days, enforce_complexity, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, policy_name, rotation_days, is_active`,
          [policy_name, rotation_days, grace_period_days, enforce_complexity, user.id]
        )
        
        return NextResponse.json({ policy: result.rows[0], success: true })
      }
    }

    return NextResponse.json({ error: "Unknown section" }, { status: 400 })
  } catch (error) {
    console.error("[Admin API] Error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
