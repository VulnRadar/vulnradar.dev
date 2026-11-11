import { NextResponse } from "next/server";
import { readJsonObject, withErrorHandling } from "@/lib/api/api-utils";
import { parseRowId } from "@/lib/teams/parse-id";
import { getSession } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import {
  listUnreadUserNotifications,
  markUserNotificationRead,
  markAllUserNotificationsRead,
} from "@/lib/notifications/user-notifications";

/**
 * Per-user in-app notification inbox (the bell). Distinct from
 * /api/v3/notifications/active, which serves the staff-authored
 * admin_notifications broadcast, and from /api/v3/admin/notifications,
 * which manages that broadcast. This route is the minimal list/mark-read
 * API for notifications addressed to exactly one user, e.g. a team invite.
 */

// List the current user's unread notifications.
export const GET = withErrorHandling(async () => {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const notifications = await listUnreadUserNotifications(session.userId);
  return NextResponse.json({ notifications });
});

// Mark one notification (or all) read/dismissed.
export const PATCH = withErrorHandling(async (request: Request) => {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const { id: rawId, markAllRead } = parsed.data;

  if (markAllRead) {
    const count = await markAllUserNotificationsRead(session.userId);
    return NextResponse.json({ success: true, count });
  }

  if (!rawId) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  const id = parseRowId(rawId);
  if (id === null) {
    return NextResponse.json(
      { error: "Invalid notification id." },
      { status: 400 },
    );
  }

  const updated = await markUserNotificationRead(session.userId, id);
  if (!updated) {
    return NextResponse.json(
      { error: "Notification not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ success: true });
});
