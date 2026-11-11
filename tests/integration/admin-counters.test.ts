import { it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The admin panel's counters against real Postgres.
 *
 * COUNT(*) is a bigint, and node-postgres hands a bigint back as a string, so
 * every counter on the stats strip and every team's member_count arrived as
 * "3". The panel's types say number, and pluralize("1", "member") is not
 * pluralize(1, ...). Only Postgres decides what type a column comes back as,
 * which is why this is not a unit test.
 */

vi.mock("server-only", () => ({}));

const STAFF = vi.hoisted(() => ({ id: 0, userId: 0, role: "super_admin" }));
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...actual,
    requireStaff: async () => ({ ...STAFF, email: "staff@example.test" }),
    requirePermission: async () => ({ ...STAFF, email: "staff@example.test" }),
  };
});

const admin = await import("@/app/api/v3/admin/route");
const teams = await import("@/app/api/v3/admin/teams/route");

describeIntegration("admin counters", () => {
  it("returns every stats counter as a number", async () => {
    await createUser();
    const res = await admin.GET(
      new NextRequest("http://localhost/api/v3/admin?section=stats"),
    );
    expect(res.status).toBe(200);
    const { stats } = await res.json();
    const keys = [
      "total_users",
      "total_scans",
      "active_api_keys",
      "active_schedules",
      "active_webhooks",
      "users_with_2fa",
      "scans_24h",
      "new_users_7d",
      "disabled_users",
      "shared_scans",
    ];
    expect(Object.keys(stats).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(typeof stats[key], key).toBe("number");
    expect(stats.total_users).toBeGreaterThan(0);
  });

  it("returns each team's member_count and the total as numbers", async () => {
    const owner = await createUser();
    const member = await createUser();
    const name = unique("counted-team");
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO teams (name, slug, owner_id) VALUES ($1, $2, $3) RETURNING id`,
      [name, name, owner.id],
    );
    await pool.query(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
      [rows[0].id, owner.id, member.id],
    );

    const res = await teams.GET(
      new Request(
        `http://localhost/api/v3/admin/teams?search=${encodeURIComponent(name)}`,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].member_count).toBe(2);
  });
});
