import { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import { getClientIp } from "@/lib/api/request-utils";
import { readJsonObject, withErrorHandling } from "@/lib/api/api-utils";
import { parseIdParam } from "@/lib/api/path-id";
import { logAction, requirePermission } from "@/lib/auth/authorization";
import {
  firstActionUrlProblem,
  notificationInputError,
} from "@/lib/notifications/admin-input";

export const PUT = withErrorHandling(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    try {
      // requirePermission (not a raw getSession + hasStaffPermission) so this
      // also honors ENFORCE_STAFF_2FA like every other gated admin route.
      const admin = await requirePermission(
        STAFF_PERMISSIONS.SEND_ANNOUNCEMENTS,
      );
      if (!admin) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      // audit-log: trusted client IP only.
      const ip = (await getClientIp()) || null;
      const id = parseIdParam((await params).id);
      if (id === null) {
        return NextResponse.json(
          { error: "Invalid notification id" },
          { status: 400 },
        );
      }
      const parsed = await readJsonObject(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.data;
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
        action_label_2,
        action_url_2,
        action_external_2,
        priority,
      } = body;

      // SECURITY: action_url/action_url_2 are rendered as an <a href> by the
      // client-side notification UI. Reject anything that isn't http(s) or a
      // same-origin path so a moderator can't store a `javascript:` URL that
      // would execute arbitrary JS in vulnradar.dev's origin. The dialog
      // checks the same rule before it sends.
      const urlProblem = firstActionUrlProblem({ action_url, action_url_2 });
      if (urlProblem) {
        return NextResponse.json({ error: urlProblem }, { status: 400 });
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
        action_label_2 = $15,
        action_url_2 = $16,
        action_external_2 = COALESCE($17, action_external_2),
        priority = COALESCE($18, priority),
        updated_at = NOW()
      WHERE id = $19
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
          action_label_2,
          action_url_2,
          action_external_2,
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
        admin.userId,
        null,
        "notification_updated",
        `Updated notification: "${updatedNotif.title}" (ID: ${id})`,
        ip ?? undefined,
      );

      return NextResponse.json({ notification: result.rows[0] });
    } catch (error) {
      // A value Postgres refused is the editor's to fix, so it gets a 400
      // that names the field instead of a 500 that names nothing.
      const reason = notificationInputError(error);
      if (reason) {
        return NextResponse.json({ error: reason }, { status: 400 });
      }
      console.error("Error updating notification:", error);
      return NextResponse.json(
        { error: "Failed to update notification" },
        { status: 500 },
      );
    }
  },
);

export const DELETE = withErrorHandling(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    try {
      // requirePermission (not a raw getSession + hasStaffPermission) so this
      // also honors ENFORCE_STAFF_2FA like every other gated admin route.
      const admin = await requirePermission(
        STAFF_PERMISSIONS.SEND_ANNOUNCEMENTS,
      );
      if (!admin) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      // audit-log: trusted client IP only.
      const ip = (await getClientIp()) || null;
      const id = parseIdParam((await params).id);
      if (id === null) {
        return NextResponse.json(
          { error: "Invalid notification id" },
          { status: 400 },
        );
      }

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
        admin.userId,
        null,
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
  },
);
