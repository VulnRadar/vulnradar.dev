import { NextResponse } from "next/server";
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
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const notifications = await listUnreadUserNotifications(session.userId);
  return NextResponse.json({ notifications });
}

// Mark one notification (or all) read/dismissed.
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { id, markAllRead } = await request.json();

  if (markAllRead) {
    const count = await markAllUserNotificationsRead(session.userId);
    return NextResponse.json({ success: true, count });
  }

  if (!id || typeof id !== "number") {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const updated = await markUserNotificationRead(session.userId, id);
  if (!updated) {
    return NextResponse.json(
      { error: "Notification not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ success: true });
}
