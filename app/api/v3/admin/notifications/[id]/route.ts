import { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import {
  hasStaffPermission,
  STAFF_PERMISSIONS,
} from "@/lib/auth/permissions-client";
import { getClientIp } from "@/lib/api/request-utils";

async function logAction(
  adminId: number,
  action: string,
  details?: string,
  ip?: string,
) {
  await pool.query(
    "INSERT INTO admin_audit_log (admin_id, target_user_id, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)",
    [adminId, null, action, details || null, ip || null],
  );
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (
      !session ||
      !hasStaffPermission(session.role, STAFF_PERMISSIONS.SEND_ANNOUNCEMENTS)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // SECURITY-AUDIT-2026-06-28 / M-7: trusted client IP only.
    const ip = (await getClientIp()) || null;
    const { id } = await params;
    const body = await req.json();
    const {
      title,
      message,
      type,
      variant,
      audience,
      path_pattern,
      starts_at,
      ends_at,
      is_active,
      is_dismissible,
      dismiss_duration_hours,
      action_label,
      action_url,
      action_external,
      priority,
    } = body;

    // SECURITY: action_url is rendered as an <a href> by the client-side
    // notification UI. Reject anything that isn't http(s) or a same-origin
    // path so a moderator can't store a `javascript:` URL that would
    // execute arbitrary JS in vulnradar.dev's origin.
    if (action_url != null && action_url !== "") {
      if (typeof action_url !== "string") {
        return NextResponse.json(
          { error: "action_url must be a string" },
          { status: 400 },
        );
      }
      const lower = action_url.trim().toLowerCase();
      const allowed =
        lower.startsWith("https://") ||
        lower.startsWith("http://") ||
        lower.startsWith("/");
      if (!allowed) {
        return NextResponse.json(
          {
            error:
              "action_url must start with https://, http://, or / (no javascript:, data:, or other schemes)",
          },
          { status: 400 },
        );
      }
    }

    const result = await pool.query(
      `UPDATE admin_notifications SET
        title = COALESCE($1, title),
        message = COALESCE($2, message),
        type = COALESCE($3, type),
        variant = COALESCE($4, variant),
        audience = COALESCE($5, audience),
        path_pattern = $6,
        starts_at = COALESCE($7, starts_at),
        ends_at = $8,
        is_active = COALESCE($9, is_active),
        is_dismissible = COALESCE($10, is_dismissible),
        dismiss_duration_hours = $11,
        action_label = $12,
        action_url = $13,
        action_external = COALESCE($14, action_external),
        priority = COALESCE($15, priority),
        updated_at = NOW()
      WHERE id = $16
      RETURNING *`,
      [
        title,
        message,
        type,
        variant,
        audience,
        path_pattern,
        starts_at,
        ends_at,
        is_active,
        is_dismissible,
        dismiss_duration_hours,
        action_label,
        action_url,
        action_external,
        priority,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Notification not found" },
        { status: 404 },
      );
    }

    const updatedNotif = result.rows[0];
    await logAction(
      session.userId,
      "notification_updated",
      `Updated notification: "${updatedNotif.title}" (ID: ${id})`,
      ip ?? undefined,
    );

    return NextResponse.json({ notification: result.rows[0] });
  } catch (error) {
    console.error("Error updating notification:", error);
    return NextResponse.json(
      { error: "Failed to update notification" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (
      !session ||
      !hasStaffPermission(session.role, STAFF_PERMISSIONS.SEND_ANNOUNCEMENTS)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // SECURITY-AUDIT-2026-06-28 / M-7: trusted client IP only.
    const ip = (await getClientIp()) || null;
    const { id } = await params;

    // Get notification title before deleting for audit
    const notifResult = await pool.query(
      `SELECT title FROM admin_notifications WHERE id = $1`,
      [id],
    );
    const notifTitle = notifResult.rows[0]?.title || "Unknown";

    const result = await pool.query(
      `DELETE FROM admin_notifications WHERE id = $1 RETURNING id`,
      [id],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Notification not found" },
        { status: 404 },
      );
    }

    await logAction(
      session.userId,
      "notification_deleted",
      `Deleted notification: "${notifTitle}" (ID: ${id})`,
      ip ?? undefined,
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting notification:", error);
    return NextResponse.json(
      { error: "Failed to delete notification" },
      { status: 500 },
    );
  }
}
