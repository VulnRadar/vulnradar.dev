import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import {
  requireAdmin,
  isSuperAdminRole,
  logAction,
} from "@/lib/auth/authorization";
import { verifyPassword } from "@/lib/auth/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { syncPlanForRoleChange } from "@/lib/billing/staff-plan";
import { deleteUserAccountData } from "@/lib/auth/account-deletion";
import { deleteAvatarFilesIfLocal } from "@/lib/uploads/avatar-storage";
import { getClientIp } from "@/lib/api/request-utils";
import { sendEmail, adminAccountChangeEmail } from "@/lib/email/email";
import { STAFF_ROLES, STAFF_ROLE_LABELS } from "@/lib/config/constants";

/**
 * AUDIT-010: bulk user operations for the admin Users table.
 *
 * A deliberately smaller, independent reimplementation of 3 of the ~30
 * single-user actions in app/api/v3/admin/route.ts's PATCH switch --
 * "set_role", "disable", and "delete_user" -- the ones bulk-worthy enough
 * to justify a multi-select toolbar (see components/admin/users/
 * bulk-actions-toolbar.tsx). That file is a large, actively-edited
 * monolith with no exported helpers to reuse, so this route re-derives
 * the same safety rules from reading it rather than importing from it:
 *
 *   - admin-only. All 3 actions require role="admin" in that switch's
 *     canPerformAction() (moderators only get the separate modActions
 *     list, which none of these 3 are in), so this route gates on
 *     requireAdmin() rather than requireStaff().
 *   - All 3 are in that route's GATED_ACTIONS / this app's
 *     PASSWORD_GATED_ACTIONS (components/admin/config.ts): re-entering
 *     the calling admin's own password is required. Gated ONCE per bulk
 *     request here, not once per target user.
 *   - The owner account (user id 1), the super_admin account, and the
 *     caller's own account can never be a target -- identical to the
 *     per-user guards in app/api/v3/admin/route.ts's PATCH handler.
 *
 * Failures are per-user, not all-or-nothing: one bad target (already
 * deleted, protected, not found) does not abort the rest of the batch.
 * The response lists a per-user ok/error so the caller can show exactly
 * which of the N selected users succeeded.
 */

const BULK_ACTIONS = new Set(["set_role", "disable", "delete"]);

/** Keeps a single bulk request from queuing an unbounded number of DB
 * writes / transactions / outbound emails in one request body. */
const MAX_BULK_TARGETS = 200;

interface BulkResult {
  userId: number;
  ok: boolean;
  error?: string;
}

function assignableRoles(): string[] {
  return Object.values(STAFF_ROLES).filter(
    (r) => r !== STAFF_ROLES.SUPER_ADMIN,
  );
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ip = await getClientIp();
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const {
    action,
    role,
    currentAdminPassword,
    notifyUser,
  }: {
    action?: string;
    role?: string;
    currentAdminPassword?: string;
    notifyUser?: boolean;
  } = body;

  if (!action || !BULK_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: "Invalid or missing action" },
      { status: 400 },
    );
  }

  const rawUserIds: unknown[] = Array.isArray(
    (body as { userIds?: unknown }).userIds,
  )
    ? (body as { userIds: unknown[] }).userIds
    : [];
  const userIds = Array.from(
    new Set(
      rawUserIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );

  if (userIds.length === 0) {
    return NextResponse.json(
      { error: "No valid userIds provided" },
      { status: 400 },
    );
  }
  if (userIds.length > MAX_BULK_TARGETS) {
    return NextResponse.json(
      { error: `Cannot target more than ${MAX_BULK_TARGETS} users at once` },
      { status: 400 },
    );
  }

  let newRole: string | undefined;
  if (action === "set_role") {
    const validRoles = assignableRoles();
    if (typeof role !== "string" || !validRoles.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    newRole = role;
  }

  // set_role/disable/delete are all password-gated -- see this file's
  // header comment. Gate the whole batch once, up front.
  if (
    typeof currentAdminPassword !== "string" ||
    currentAdminPassword.length === 0
  ) {
    return NextResponse.json(
      { error: "Re-enter your password to confirm this action." },
      { status: 403 },
    );
  }

  // rate-limit: same key shape/budget as the single-user re-auth gate in
  // app/api/v3/admin/route.ts, since it's the same brute-force surface.
  const adminRl = await checkRateLimit({
    key: `admin-reauth:${session.userId}:${ip}`,
    ...RATE_LIMITS.adminReauth,
  });
  if (!adminRl.allowed) {
    return NextResponse.json(
      {
        error: `Too many admin attempts. Try again in ${Math.ceil(
          adminRl.retryAfterSeconds / 60,
        )} minute(s).`,
      },
      { status: 429 },
    );
  }

  const adminRow = await pool.query<{
    password_hash: string;
    name: string | null;
    email: string;
  }>("SELECT password_hash, name, email FROM users WHERE id = $1", [
    session.userId,
  ]);
  if (
    !adminRow.rows[0] ||
    !(await verifyPassword(
      currentAdminPassword,
      adminRow.rows[0].password_hash,
    ))
  ) {
    return NextResponse.json(
      { error: "Password is incorrect." },
      { status: 403 },
    );
  }
  const adminName = adminRow.rows[0].name || adminRow.rows[0].email;
  const shouldNotify = notifyUser !== false;

  const results: BulkResult[] = [];

  for (const userId of userIds) {
    try {
      // Protect the owner account (user ID 1), same as the single-user route.
      if (userId === 1 && session.userId !== 1) {
        results.push({
          userId,
          ok: false,
          error: "This account is protected and cannot be modified.",
        });
        continue;
      }
      // set_role/disable/delete are all in the single-user self-modification
      // block list too -- an admin can never bulk-act on their own account.
      if (userId === session.userId) {
        results.push({
          userId,
          ok: false,
          error: "Cannot perform this action on your own account.",
        });
        continue;
      }

      const targetRes = await pool.query<{
        email: string;
        name: string | null;
        role: string | null;
        unsubscribe_token: string | null;
      }>(
        "SELECT email, name, role, unsubscribe_token FROM users WHERE id = $1",
        [userId],
      );
      const targetUser = targetRes.rows[0];
      if (!targetUser) {
        results.push({ userId, ok: false, error: "User not found" });
        continue;
      }
      if (isSuperAdminRole(targetUser.role)) {
        results.push({
          userId,
          ok: false,
          error: "This account cannot be modified.",
        });
        continue;
      }

      const userName = targetUser.name || targetUser.email;

      if (action === "set_role") {
        const oldRole = targetUser.role || "user";
        await pool.query("UPDATE users SET role = $1 WHERE id = $2", [
          newRole,
          userId,
        ]);
        await syncPlanForRoleChange(userId, oldRole, newRole);
        await logAction(
          session.userId,
          userId,
          "set_role",
          `Bulk: changed role of ${targetUser.email} from ${oldRole} to ${newRole}`,
          ip,
        );
        if (shouldNotify) {
          const payload = adminAccountChangeEmail({
            userName,
            adminName,
            changes: [
              {
                field: "Account Role",
                oldValue: STAFF_ROLE_LABELS[oldRole] || oldRole,
                newValue: STAFF_ROLE_LABELS[newRole!] || newRole!,
              },
            ],
            timestamp: new Date(),
          });
          sendEmail({
            to: targetUser.email,
            ...payload,
            unsubscribeToken: targetUser.unsubscribe_token || undefined,
          }).catch(console.error);
        }
      } else if (action === "disable") {
        await pool.query("UPDATE users SET disabled_at = NOW() WHERE id = $1", [
          userId,
        ]);
        await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
        await logAction(
          session.userId,
          userId,
          "disable_user",
          `Bulk: disabled account for ${targetUser.email}`,
          ip,
        );
        if (shouldNotify) {
          const payload = adminAccountChangeEmail({
            userName,
            adminName,
            changes: [
              {
                field: "Account Status",
                oldValue: "Active",
                newValue: "Disabled",
              },
            ],
            timestamp: new Date(),
          });
          sendEmail({
            to: targetUser.email,
            ...payload,
            unsubscribeToken: targetUser.unsubscribe_token || undefined,
          }).catch(console.error);
        }
      } else {
        // action === "delete": same transactional sequence + shared helper
        // as app/api/v3/admin/route.ts's delete_user case, one transaction
        // per target user so one failed delete in the batch can't roll
        // back the ones that already succeeded.
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await deleteUserAccountData(client, userId);
          await client.query("COMMIT");
        } catch (txError) {
          await client.query("ROLLBACK");
          throw txError;
        } finally {
          client.release();
        }
        // Best-effort, not part of the transaction (filesystem writes
        // don't roll back with SQL) -- matches the single-user route.
        await deleteAvatarFilesIfLocal(userId);
        // targetUserId is null: the user row (and any admin_audit_log row
        // that referenced it) is already gone by this point -- see the
        // matching comment in app/api/v3/admin/route.ts's delete_user case.
        await logAction(
          session.userId,
          null,
          "delete_account",
          `Bulk: permanently deleted account for ${targetUser.email}`,
          ip,
        );
        if (shouldNotify) {
          const payload = adminAccountChangeEmail({
            userName,
            adminName,
            changes: [
              {
                field: "Account",
                oldValue: "Active",
                newValue: "Permanently Deleted",
              },
            ],
            timestamp: new Date(),
          });
          sendEmail({ to: targetUser.email, ...payload }).catch(console.error);
        }
      }

      results.push({ userId, ok: true });
    } catch (err) {
      console.error("[Bulk Admin Action Error]", {
        userId,
        action,
        message: err instanceof Error ? err.message : String(err),
      });
      results.push({ userId, ok: false, error: "Action failed" });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  return NextResponse.json({ success: true, succeeded, failed, results });
}
