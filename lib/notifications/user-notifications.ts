import pool from "@/lib/database/db";
import { getSetting } from "@/lib/config/runtime-config";

/**
 * Per-user in-app notification inbox (the bell). Distinct from
 * lib/notifications/notifications.ts, which is about EMAIL preference
 * columns, and from admin_notifications, which is a staff-authored
 * broadcast to an audience segment ("all", "authenticated", "staff", ...)
 * with no concept of a single recipient.
 *
 * First (and currently only) producer: a team invite sent to an email
 * address that already has an account. See
 * app/api/v3/teams/members/route.ts.
 */

export type UserNotificationType = "team_invite";

export interface CreateUserNotificationInput {
  userId: number;
  type: UserNotificationType;
  title: string;
  message: string;
  actionLabel?: string | null;
  actionUrl?: string | null;
  /** What this notification is about, e.g. "team_invite". */
  relatedType?: string | null;
  /** The id of the source row, e.g. team_invites.id. */
  relatedId?: number | null;
}

export interface UserNotificationRow {
  id: number;
  type: string;
  title: string;
  message: string;
  action_label: string | null;
  action_url: string | null;
  related_type: string | null;
  related_id: number | null;
  created_at: string;
}

export async function createUserNotification(
  input: CreateUserNotificationInput,
): Promise<void> {
  await pool.query(
    `INSERT INTO user_notifications
       (user_id, type, title, message, action_label, action_url, related_type, related_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.userId,
      input.type,
      input.title,
      input.message,
      input.actionLabel ?? null,
      input.actionUrl ?? null,
      input.relatedType ?? null,
      input.relatedId ?? null,
    ],
  );
}

/**
 * Unread notifications for the bell, newest first.
 *
 * Self-heals team_invite rows whose underlying invite is no longer
 * actionable (accepted through some other path, expired, or cancelled by
 * the team owner/admin) by marking them read before selecting, so a
 * stale "Accept" button never lingers in the bell just because the user
 * hadn't opened it since the invite stopped being valid.
 */
export async function listUnreadUserNotifications(
  userId: number,
): Promise<UserNotificationRow[]> {
  await pool.query(
    `UPDATE user_notifications un
     SET read_at = NOW()
     WHERE un.user_id = $1
       AND un.read_at IS NULL
       AND un.related_type = 'team_invite'
       AND (
         NOT EXISTS (SELECT 1 FROM team_invites ti WHERE ti.id = un.related_id)
         OR EXISTS (
           SELECT 1 FROM team_invites ti
           WHERE ti.id = un.related_id
             AND (ti.accepted_at IS NOT NULL OR ti.expires_at <= NOW())
         )
       )`,
    [userId],
  );

  const defaultPageSize = await getSetting("PAGINATION_DEFAULT_PAGE_SIZE");
  const result = await pool.query<UserNotificationRow>(
    `SELECT id, type, title, message, action_label, action_url, related_type, related_id, created_at
     FROM user_notifications
     WHERE user_id = $1 AND read_at IS NULL
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, defaultPageSize],
  );
  return result.rows;
}

/**
 * Mark one notification read. Scoped to `userId` so a user can only ever
 * dismiss their own notifications. Returns false if the row doesn't exist,
 * belongs to someone else, or was already read.
 */
export async function markUserNotificationRead(
  userId: number,
  id: number,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE user_notifications SET read_at = NOW()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [id, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Marks every unread notification for `userId` as read. Returns the count. */
export async function markAllUserNotificationsRead(
  userId: number,
): Promise<number> {
  const result = await pool.query(
    `UPDATE user_notifications SET read_at = NOW()
     WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return result.rowCount ?? 0;
}

/**
 * Called once a team invite is accepted, so its bell notification stops
 * showing regardless of whether the user accepted through the emailed
 * token link or the in-app Accept button. See
 * app/api/v3/teams/accept-invite/route.ts.
 */
export async function markTeamInviteNotificationsHandled(
  inviteId: number,
): Promise<void> {
  await pool.query(
    `UPDATE user_notifications SET read_at = NOW()
     WHERE related_type = 'team_invite' AND related_id = $1 AND read_at IS NULL`,
    [inviteId],
  );
}
