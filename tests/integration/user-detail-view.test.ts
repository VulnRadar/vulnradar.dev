import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import {
  hasRecentUserDetailView,
  USER_DETAIL_VIEW_WINDOW_MINUTES,
} from "@/lib/admin/user-detail-view";
import { createUser, describeIntegration } from "./_db";

/**
 * The lookup that decides whether a panel refresh of an account's record may
 * skip writing a new view_user_detail row. Each predicate is what keeps the
 * skip from hiding a real read: the same staff member, the same account, the
 * view action and nothing else, inside the window. A faked pool answers a
 * dropped predicate exactly as it answers the full one.
 */

async function logRow(
  adminId: number,
  targetUserId: number,
  action: string,
  minutesAgo: number,
) {
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, target_user_id, action, details, created_at)
     VALUES ($1, $2, $3, 'integration', NOW() - make_interval(mins => $4))`,
    [adminId, targetUserId, action, minutesAgo],
  );
}

describeIntegration("hasRecentUserDetailView against admin_audit_log", () => {
  it("finds this admin's recent view of this account", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser();
    await logRow(admin.id, target.id, "view_user_detail", 1);
    expect(await hasRecentUserDetailView(admin.id, target.id)).toBe(true);
  });

  it("ignores a view older than the window", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser();
    await logRow(
      admin.id,
      target.id,
      "view_user_detail",
      USER_DETAIL_VIEW_WINDOW_MINUTES + 1,
    );
    expect(await hasRecentUserDetailView(admin.id, target.id)).toBe(false);
  });

  it("ignores another admin's view, a view of another account and any other action", async () => {
    const admin = await createUser({ role: "admin" });
    const peer = await createUser({ role: "admin" });
    const target = await createUser();
    const elsewhere = await createUser();
    await logRow(peer.id, target.id, "view_user_detail", 1);
    await logRow(admin.id, elsewhere.id, "view_user_detail", 1);
    await logRow(admin.id, target.id, "add_note", 1);
    expect(await hasRecentUserDetailView(admin.id, target.id)).toBe(false);
  });
});
