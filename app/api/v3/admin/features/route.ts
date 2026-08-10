import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getClientIp } from "@/lib/api/request-utils";
import {
  requireAdmin as _requireAdmin,
  logAction,
} from "@/lib/auth/authorization";
import { sendEmail } from "@/lib/email/email";
import {
  isSettingKey,
  validateSettingValue,
  SETTINGS_REGISTRY,
  type SettingKey,
} from "@/lib/config/registry";
import {
  invalidateSettingsCache,
  getSettings,
} from "@/lib/config/runtime-config";

const VALID_PREF_COLS = new Set([
  "email_security",
  "email_new_login",
  "email_password_change",
  "email_2fa_change",
  "email_session_revoked",
  "email_scan_complete",
  "email_critical_findings",
  "email_regression_alert",
  "email_schedules",
  "email_api_keys",
  "email_api_limit_warning",
  "email_webhooks",
  "email_webhook_failure",
  "email_data_requests",
  "email_account_deletion",
  "email_team_invite",
  "email_team_changes",
  "email_product_updates",
  "email_tips_guides",
]);

// TERMS_UPDATED_AT drives the ToS re-accept comparison directly (see
// components/auth/tos-gate.tsx and lib/api/api-keys.ts's
// hasAcceptedLatestTerms). SETTINGS_REGISTRY only knows "string" for it
// (length 10, matching "YYYY-MM-DD") — it has no "date" SettingType to check
// the value is a real calendar date — so a malformed write would pass
// validateSettingValue and only surface later as "nobody is ever asked to
// re-accept" (Date parsing produces Invalid Date, which no comparison ever
// matches). Validated here, one-off, rather than by adding a new registry
// type for a single setting.
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function dateShapeError(key: string, value: string): string | null {
  if (key !== "TERMS_UPDATED_AT") return null;
  if (!DATE_SHAPE.test(value)) {
    return `Terms last updated (${key}): must be a date in YYYY-MM-DD form.`;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  // A rollover (e.g. "2026-02-30" -> March 2) means the calendar fields
  // Date.UTC was given don't match what comes back out.
  const isRealDate =
    !isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
  if (!isRealDate) {
    return `Terms last updated (${key}): not a real calendar date.`;
  }
  return null;
}

// Robustly remove all HTML tags by repeatedly applying the regex until no more tags are found
function stripHtmlTags(html: string): string {
  let result = html;
  let previous = "";
  // Keep replacing until no more HTML tags are found (handles nested/stacked tags)
  while (result !== previous) {
    previous = result;
    result = result.replace(/<[^>]*>/g, "");
  }
  return result;
}

// R3/D1: requireAdmin moved to lib/auth/authorization.ts (single source).
async function requireAdmin() {
  return _requireAdmin();
}

/**
 * Admin Features API
 * POST /api/v3/admin/features - Manage IP rules, security alerts, system settings, broadcasts, password policies
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action, section } = body;
    const ip = await getClientIp();

    if (section === "access_rules") {
      if (action === "create") {
        const {
          rule_type,
          value_type,
          ip_address,
          description,
          reason,
          expires_at,
        } = body;

        // Normalize URL/domain values by stripping protocol and trailing slashes
        let normalizedValue = ip_address?.trim() || "";
        if (value_type === "url") {
          normalizedValue = normalizedValue.toLowerCase();

          // Remove protocol using indexOf instead of regex
          const protoEnd = normalizedValue.indexOf("://");
          if (protoEnd !== -1) {
            normalizedValue = normalizedValue.substring(protoEnd + 3);
          }

          // Remove trailing slashes using a while loop instead of regex
          while (normalizedValue.endsWith("/")) {
            normalizedValue = normalizedValue.slice(0, -1);
          }

          // Remove paths (keep domain only) using indexOf
          const pathIndex = normalizedValue.indexOf("/");
          if (pathIndex !== -1) {
            normalizedValue = normalizedValue.substring(0, pathIndex);
          }
        }

        const result = await pool.query(
          `INSERT INTO access_rules (rule_type, value_type, value, description, reason, created_by, expires_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) 
           RETURNING id, rule_type, value_type, value as ip_address, description, is_active, created_at`,
          [
            rule_type,
            value_type,
            normalizedValue,
            description,
            reason,
            user.id,
            expires_at,
          ],
        );

        await logAction(
          user.id,
          null,
          "access_rule_created",
          `Created ${value_type} ${rule_type} rule: ${normalizedValue}`,
          ip,
        );

        return NextResponse.json({ rule: result.rows[0], success: true });
      }

      if (action === "list") {
        const result = await pool.query(
          `SELECT id, rule_type, value_type, value as ip_address, description, reason, hit_count, is_active, created_at, expires_at 
           FROM access_rules 
           WHERE is_active = true 
           ORDER BY created_at DESC`,
        );
        return NextResponse.json({ rules: result.rows });
      }

      if (action === "delete") {
        const { id } = body;

        // Fetch the rule first for logging
        const result = await pool.query(
          `SELECT value as ip_address, value_type FROM access_rules WHERE id = $1`,
          [id],
        );

        if (result.rows.length > 0) {
          const { ip_address, value_type } = result.rows[0];
          await logAction(
            user.id,
            null,
            "access_rule_deleted",
            `Deleted ${value_type} rule: ${ip_address}`,
            ip,
          );
        }

        // Actually delete the row
        await pool.query(`DELETE FROM access_rules WHERE id = $1`, [id]);

        return NextResponse.json({ success: true });
      }

      if (action === "update") {
        const { id, ...updates } = body;
        // Map ip_address to value for the database
        const mappedUpdates = { ...updates };
        if (mappedUpdates.ip_address) {
          mappedUpdates.value = mappedUpdates.ip_address;
          delete mappedUpdates.ip_address;
        }
        // Whitelist allowed columns — anything else is silently dropped to
        // prevent SQL injection via dynamic column names.
        const ALLOWED_COLUMNS = new Set([
          "value",
          "description",
          "reason",
          "is_active",
          "expires_at",
        ]);
        const safeEntries = Object.entries(mappedUpdates).filter(([k]) =>
          ALLOWED_COLUMNS.has(k),
        );
        if (safeEntries.length === 0) {
          return NextResponse.json(
            { error: "No updatable fields provided" },
            { status: 400 },
          );
        }
        const fields = safeEntries
          .map(([k], i) => `${k} = $${i + 2}`)
          .join(", ");

        await pool.query(`UPDATE access_rules SET ${fields} WHERE id = $1`, [
          id,
          ...safeEntries.map(([, v]) => v),
        ]);
        await logAction(
          user.id,
          null,
          "access_rule_updated",
          `Updated access rule ID: ${id}`,
          ip,
        );
        return NextResponse.json({ success: true });
      }
    }

    if (section === "security_alerts") {
      if (action === "list") {
        const { limit: rawLimit = 50, offset = 0, severity, user_id } = body;
        const limit = Math.min(500, Math.max(1, Number(rawLimit) || 50));

        let query = `SELECT * FROM security_alerts WHERE 1=1`;
        const params: unknown[] = [];

        if (severity) {
          query += ` AND severity = $${params.length + 1}`;
          params.push(severity);
        }

        if (user_id) {
          query += ` AND user_id = $${params.length + 1}`;
          params.push(user_id);
        }

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return NextResponse.json({ alerts: result.rows });
      }

      if (action === "resolve") {
        const { id, action_taken } = body;
        const alertResult = await pool.query(
          `SELECT alert_type, severity FROM security_alerts WHERE id = $1`,
          [id],
        );
        const alertType = alertResult.rows[0]?.alert_type || "Unknown";
        const severity = alertResult.rows[0]?.severity || "Unknown";
        await pool.query(
          `UPDATE security_alerts SET resolved_at = NOW(), resolved_by = $1, action_taken = $2 WHERE id = $3`,
          [user.id, action_taken, id],
        );
        await logAction(
          user.id,
          null,
          "security_alert_resolved",
          `Resolved ${severity} ${alertType} alert (ID: ${id}). Action: ${action_taken || "None specified"}`,
          ip,
        );
        return NextResponse.json({ success: true });
      }
    }

    if (section === "system_settings") {
      if (action === "get") {
        const { key } = body;
        const result = await pool.query(
          `SELECT value FROM system_settings WHERE key = $1`,
          [key],
        );
        return NextResponse.json({ value: result.rows[0]?.value });
      }

      if (action === "set") {
        const { key, value, description } = body;
        if (typeof key !== "string" || key.length === 0) {
          return NextResponse.json(
            { error: "A setting key is required" },
            { status: 400 },
          );
        }

        // Keys the registry knows about are validated against their declared
        // type and bounds. Keys it does not (maintenance_mode and friends)
        // are legacy free-form rows and pass through as before.
        let storedValue = value;
        if (isSettingKey(key)) {
          const validated = validateSettingValue(key, value);
          if (!validated.ok) {
            return NextResponse.json(
              { error: validated.error },
              { status: 400 },
            );
          }
          storedValue = validated.value;

          const dateError = dateShapeError(key, storedValue);
          if (dateError) {
            return NextResponse.json({ error: dateError }, { status: 400 });
          }
        }

        const oldResult = await pool.query(
          `SELECT value FROM system_settings WHERE key = $1`,
          [key],
        );
        const oldValue = oldResult.rows[0]?.value;
        await pool.query(
          `INSERT INTO system_settings (key, value, description, updated_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $4, updated_at = NOW()`,
          [key, storedValue, description, user.id],
        );
        invalidateSettingsCache();
        await logAction(
          user.id,
          null,
          "system_setting_changed",
          `Changed "${key}" from "${oldValue || "(not set)"}" to "${storedValue}"`,
          ip,
        );
        return NextResponse.json({ success: true });
      }

      if (action === "list") {
        const result = await pool.query(
          `SELECT key, value, description, updated_at FROM system_settings`,
        );
        return NextResponse.json({ settings: result.rows });
      }

      if (action === "effective") {
        // The admin settings UI's read path: the resolver's actual effective
        // value for every registry key (database, then env, then shipped
        // default), plus which keys have a database row at all. The two are
        // kept separate on purpose: "overridden" drives the reset-to-default
        // control and the Customized/Default badge, and it must mean "there
        // is a row to delete", not "differs from the shipped default" (an
        // env override with no database row is neither).
        const keys = Object.keys(SETTINGS_REGISTRY) as SettingKey[];
        const [effective, overriddenResult] = await Promise.all([
          getSettings(keys),
          pool.query<{ key: string }>(
            `SELECT key FROM system_settings WHERE key = ANY($1)`,
            [keys],
          ),
        ]);
        return NextResponse.json({
          effective,
          overridden: overriddenResult.rows.map((r) => r.key),
        });
      }

      if (action === "reset") {
        const { key } = body;
        if (typeof key !== "string" || !isSettingKey(key)) {
          return NextResponse.json(
            { error: "Unknown setting key" },
            { status: 400 },
          );
        }

        const oldResult = await pool.query(
          `SELECT value FROM system_settings WHERE key = $1`,
          [key],
        );
        const oldValue = oldResult.rows[0]?.value;
        // Delete the row rather than writing the default value back, so a
        // future release that changes the shipped default keeps applying to
        // this instance automatically.
        await pool.query(`DELETE FROM system_settings WHERE key = $1`, [key]);
        invalidateSettingsCache();
        await logAction(
          user.id,
          null,
          "system_setting_reset",
          `Reset "${key}" to its default (was "${oldValue ?? "(not set)"}")`,
          ip,
        );
        return NextResponse.json({
          success: true,
          default: SETTINGS_REGISTRY[key].default,
        });
      }
    }

    if (section === "broadcast") {
      if (action === "create") {
        const { title, content, message_type, segment_filter, scheduled_at } =
          body;

        const result = await pool.query(
          `INSERT INTO broadcast_messages (title, content, message_type, segment_filter, created_by, scheduled_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, title, status, created_at`,
          [
            title,
            content,
            message_type,
            segment_filter,
            user.id,
            scheduled_at,
            "draft",
          ],
        );

        await logAction(
          user.id,
          null,
          "broadcast_created",
          `Created broadcast draft: ${title}`,
          ip,
        );

        return NextResponse.json({ message: result.rows[0], success: true });
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
           ORDER BY bm.created_at DESC`,
        );
        return NextResponse.json({ messages: result.rows });
      }

      if (action === "send") {
        const { id } = body;

        // Get message first to validate it exists
        const check = await pool.query(
          `SELECT id FROM broadcast_messages WHERE id = $1 AND status = 'draft'`,
          [id],
        );
        if (check.rows.length === 0) {
          return NextResponse.json(
            { error: "Broadcast not found or already sent" },
            { status: 404 },
          );
        }

        // Get broadcast title for audit
        const titleResult = await pool.query(
          `SELECT title FROM broadcast_messages WHERE id = $1`,
          [id],
        );
        const broadcastTitle = titleResult.rows[0]?.title || "Unknown";

        // Update status to sent immediately
        await pool.query(
          `UPDATE broadcast_messages SET status = 'sent', sent_at = NOW() WHERE id = $1`,
          [id],
        );

        await logAction(
          user.id,
          null,
          "broadcast_sent",
          `Sent broadcast: ${broadcastTitle}`,
          ip,
        );

        // Queue background job to send emails
        setTimeout(async () => {
          try {
            const messageResult = await pool.query(
              `SELECT id, title, content, segment_filter FROM broadcast_messages WHERE id = $1`,
              [id],
            );
            const message = messageResult.rows[0];
            if (!message) return;

            const segment =
              message.segment_filter?.segment || message.segment_filter;
            const prefCol = message.segment_filter?.preference_col;
            const safeCol =
              typeof prefCol === "string" && VALID_PREF_COLS.has(prefCol)
                ? prefCol
                : null;

            let userQuery = `SELECT u.id, u.email FROM users u`;
            const queryParams: string[] = [];

            if (safeCol) {
              userQuery += ` LEFT JOIN notification_preferences np ON np.user_id = u.id`;
            }

            userQuery += ` WHERE u.email_verified_at IS NOT NULL`;

            if (segment && segment !== "all") {
              if (segment === "premium") {
                userQuery += ` AND u.plan != 'free'`;
              } else if (segment === "free") {
                userQuery += ` AND u.plan = 'free'`;
              } else if (segment === "core_supporter") {
                userQuery += ` AND u.plan = 'core_supporter'`;
              } else if (segment === "pro_supporter") {
                userQuery += ` AND u.plan = 'pro_supporter'`;
              } else if (segment === "elite_supporter") {
                userQuery += ` AND u.plan = 'elite_supporter'`;
              } else if (
                typeof segment === "string" &&
                segment.startsWith("email:")
              ) {
                const specificEmail = segment.replace("email:", "");
                userQuery += ` AND u.email = $1`;
                queryParams.push(specificEmail);
              }
            }

            if (safeCol) {
              userQuery += ` AND (np.user_id IS NULL OR np.${safeCol} = true)`;
            }

            const usersResult = await pool.query(userQuery, queryParams);
            for (const recipient of usersResult.rows) {
              try {
                await sendEmail({
                  to: recipient.email,
                  subject: message.title,
                  text: stripHtmlTags(message.content),
                  html: message.content,
                  skipLayout: false,
                });
                await pool.query(
                  `INSERT INTO broadcast_recipients (message_id, user_id, status) VALUES ($1, $2, 'sent')`,
                  [id, recipient.id],
                );
              } catch (err) {
                console.error(
                  `[Broadcast] Failed to send to userId ${recipient.id}:`,
                  err instanceof Error ? err.message : "non-Error thrown",
                );
              }
            }
          } catch (err) {
            console.error("[Broadcast] Background job failed:", err);
          }
        }, 100);

        return NextResponse.json({
          success: true,
          message: "Broadcast queued for sending",
        });
      }

      if (action === "delete") {
        const { id } = body;
        // Get title for audit before deleting
        const titleResult = await pool.query(
          `SELECT title FROM broadcast_messages WHERE id = $1`,
          [id],
        );
        const broadcastTitle = titleResult.rows[0]?.title || "Unknown";

        // Only allow deleting drafts
        const result = await pool.query(
          `DELETE FROM broadcast_messages WHERE id = $1 AND status = 'draft' RETURNING id`,
          [id],
        );
        if (result.rows.length === 0) {
          return NextResponse.json(
            { error: "Cannot delete sent broadcasts" },
            { status: 400 },
          );
        }

        await logAction(
          user.id,
          null,
          "broadcast_deleted",
          `Deleted broadcast draft: ${broadcastTitle}`,
          ip,
        );

        return NextResponse.json({ success: true });
      }

      if (action === "resend") {
        const { id } = body;

        // Get message and check if it's been sent
        const check = await pool.query(
          `SELECT id, title FROM broadcast_messages WHERE id = $1 AND status = 'sent'`,
          [id],
        );
        if (check.rows.length === 0) {
          return NextResponse.json(
            { error: "Can only resend sent broadcasts" },
            { status: 400 },
          );
        }
        const broadcastTitle = check.rows[0]?.title || "Unknown";

        // Update sent_at and sent_by for audit trail
        await pool.query(
          `UPDATE broadcast_messages SET sent_by = $1, sent_at = NOW() WHERE id = $2`,
          [user.id, id],
        );

        await logAction(
          user.id,
          null,
          "broadcast_resent",
          `Resent broadcast: ${broadcastTitle}`,
          ip,
        );

        // Queue background job to send emails again
        setTimeout(async () => {
          try {
            const messageResult = await pool.query(
              `SELECT id, title, content, segment_filter FROM broadcast_messages WHERE id = $1`,
              [id],
            );
            const message = messageResult.rows[0];
            if (!message) return;

            const segment =
              message.segment_filter?.segment || message.segment_filter;
            const prefCol = message.segment_filter?.preference_col;
            const safeCol =
              typeof prefCol === "string" && VALID_PREF_COLS.has(prefCol)
                ? prefCol
                : null;

            let userQuery = `SELECT u.id, u.email FROM users u`;
            const queryParams: string[] = [];

            if (safeCol) {
              userQuery += ` LEFT JOIN notification_preferences np ON np.user_id = u.id`;
            }

            userQuery += ` WHERE u.email_verified_at IS NOT NULL`;

            if (segment && segment !== "all") {
              if (segment === "premium") {
                userQuery += ` AND u.plan != 'free'`;
              } else if (segment === "free") {
                userQuery += ` AND u.plan = 'free'`;
              } else if (segment === "core_supporter") {
                userQuery += ` AND u.plan = 'core_supporter'`;
              } else if (segment === "pro_supporter") {
                userQuery += ` AND u.plan = 'pro_supporter'`;
              } else if (segment === "elite_supporter") {
                userQuery += ` AND u.plan = 'elite_supporter'`;
              } else if (
                typeof segment === "string" &&
                segment.startsWith("email:")
              ) {
                const specificEmail = segment.replace("email:", "");
                userQuery += ` AND u.email = $1`;
                queryParams.push(specificEmail);
              }
            }

            if (safeCol) {
              userQuery += ` AND (np.user_id IS NULL OR np.${safeCol} = true)`;
            }

            const usersResult = await pool.query(userQuery, queryParams);
            for (const recipient of usersResult.rows) {
              try {
                await sendEmail({
                  to: recipient.email,
                  subject: message.title,
                  text: stripHtmlTags(message.content),
                  html: message.content,
                  skipLayout: false,
                });
                await pool.query(
                  `INSERT INTO broadcast_recipients (message_id, user_id, status) VALUES ($1, $2, 'sent')`,
                  [id, recipient.id],
                );
              } catch (err) {
                console.error(
                  `[Broadcast] Failed to send to userId ${recipient.id}:`,
                  err instanceof Error ? err.message : "non-Error thrown",
                );
              }
            }
          } catch (err) {
            console.error("[Broadcast] Background job failed:", err);
          }
        }, 100);

        return NextResponse.json({
          success: true,
          message: "Broadcast resent",
        });
      }
    }

    return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  } catch (error) {
    console.error("[Admin API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
