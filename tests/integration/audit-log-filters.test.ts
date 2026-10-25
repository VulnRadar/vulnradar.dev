import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { fetchAuditPage, parseAuditFilters } from "@/lib/admin/audit-query";
import { auditActionsIn } from "@/lib/admin/audit-actions";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The audit log's filters, run by Postgres.
 *
 * Every filter used to be a useMemo over the ten rows on the current page, so
 * "what has staff done to this account" could not be answered at all. Whether a
 * server-side filter selects the right rows, whether a LIKE-escaped search
 * treats `%` as a character, and whether the stat tiles' COUNT ... FILTER counts
 * what they say are all questions about SQL, and a mocked pool answers every
 * one of them the same way.
 */
async function seed(
  adminId: number,
  targetUserId: number | null,
  action: string,
  details: string,
  ageHours = 0,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO admin_audit_log (admin_id, target_user_id, action, details, ip_address, created_at)
     VALUES ($1, $2, $3, $4, '203.0.113.7', NOW() - make_interval(hours => $5::int))
     RETURNING id`,
    [adminId, targetUserId, action, details, ageHours],
  );
  return rows[0].id;
}

function page(query: string, limit = 50, offset = 0) {
  const filter = parseAuditFilters(new URLSearchParams(query));
  if (!filter.ok) throw new Error(filter.error);
  return fetchAuditPage(filter, limit, offset);
}

const ids = (rows: Record<string, unknown>[]) =>
  rows.map((r) => r.id as number).sort((a, b) => a - b);

describeIntegration("audit log filters", () => {
  it("answers 'what has staff done to this account' across every row, not one page", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser();
    const bystander = await createUser();

    const mine = [
      await seed(admin.id, target.id, "view_user_detail", "Viewed"),
      await seed(admin.id, target.id, "set_role", "Changed role", 3),
      await seed(admin.id, target.id, "reset_password", "Sent a link", 30),
    ];
    await seed(admin.id, bystander.id, "set_role", "Someone else");
    await seed(admin.id, null, "audit_log_exported", "No target");

    // A page size smaller than the result set: the filter has to be applied
    // before the LIMIT, which is what a client-side filter can never do.
    const first = await page(`targetUserId=${target.id}`, 2, 0);
    const second = await page(`targetUserId=${target.id}`, 2, 2);

    expect(first.total).toBe(3);
    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(1);
    expect(ids([...first.rows, ...second.rows])).toEqual(mine);
  });

  it("filters by acting admin", async () => {
    const adminA = await createUser({ role: "admin" });
    const adminB = await createUser({ role: "admin" });
    const target = await createUser();
    const a = await seed(adminA.id, target.id, "set_role", "A did it");
    await seed(adminB.id, target.id, "set_role", "B did it");

    const result = await page(`adminId=${adminA.id}`);
    expect(ids(result.rows)).toEqual([a]);
  });

  it("filters by category through the registry's actions", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser();
    const role = await seed(admin.id, target.id, "set_role", "role");
    await seed(admin.id, target.id, "send_notification", "not a role action");

    const result = await page(`category=roles&targetUserId=${target.id}`);
    expect(auditActionsIn("roles")).toContain("set_role");
    expect(ids(result.rows)).toEqual([role]);
  });

  it("filters by time range", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser();
    const recent = await seed(admin.id, target.id, "set_role", "recent", 1);
    await seed(admin.id, target.id, "set_role", "old", 24 * 20);

    const from = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const result = await page(
      `targetUserId=${target.id}&from=${encodeURIComponent(from)}`,
    );
    expect(ids(result.rows)).toEqual([recent]);
  });

  it("matches a search against details, and against the people's names", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser();
    const needle = unique("needle").replace(/[^a-z0-9]/g, "");
    const byDetails = await seed(
      admin.id,
      target.id,
      "add_note",
      `Wrote a note about ${needle}`,
    );
    await seed(admin.id, target.id, "add_note", "unrelated");

    expect(ids((await page(`q=${needle}`)).rows)).toEqual([byDetails]);
    // The target's email is a join column, so it needs the users join.
    const byEmail = await page(
      `q=${encodeURIComponent(target.email)}&targetUserId=${target.id}`,
    );
    expect(byEmail.total).toBe(2);
  });

  it("treats LIKE metacharacters in a search as characters", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser();
    const label = unique("pct").replace(/[^a-z0-9]/g, "");
    const literal = await seed(
      admin.id,
      target.id,
      "add_note",
      `${label} 100% done`,
    );
    await seed(admin.id, target.id, "add_note", `${label} 100x done`);

    // Unescaped, "100% done" is "100" then anything then " done" and matches
    // both rows; the underscore form would match any single character.
    const percent = await page(`q=${encodeURIComponent(`${label} 100% done`)}`);
    expect(ids(percent.rows)).toEqual([literal]);
    const underscore = await page(`q=${encodeURIComponent(`${label}_100`)}`);
    expect(underscore.total).toBe(0);
  });

  it("counts the stat tiles over the whole log with COUNT FILTER", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser();
    const before = (await page("")).stats;

    await seed(admin.id, target.id, "set_role", "in the last day", 2);
    await seed(
      admin.id,
      null,
      "audit_log_exported",
      "no target, 3 days ago",
      72,
    );
    await seed(admin.id, target.id, "set_role", "outside the week", 24 * 10);

    const after = (await page("")).stats;
    // Other suites write rows too, so the assertion is on the delta.
    expect(after.last24h - before.last24h).toBe(1);
    expect(after.last7d - before.last7d).toBe(2);
    expect(after.userActions7d - before.userActions7d).toBe(1);
    expect(after.activeAdmins7d).toBeGreaterThanOrEqual(1);
  });
});
