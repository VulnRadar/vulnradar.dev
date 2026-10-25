import { it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import pool from "@/lib/database/db";
import { describeIntegration } from "./_db";

/**
 * Which site notifications each role is shown, judged by Postgres.
 *
 * The admin panel offers "Staff Only" and "Admins Only" as separate audiences.
 * The route bound both to one boolean, isStaffRole(), which is true for every
 * role that has any staff permission, so a notice an admin wrote for admins
 * alone (an incident note, a credential rotation) reached support, billing,
 * ops, moderators and the rest. The unit suite fakes pool.query and can only
 * show which boolean is bound to which placeholder. Whether the right rows come
 * back for each role is a property of the WHERE clause, so it is asserted here
 * against the real table.
 *
 * Only getSession is replaced: the role is the one input the route takes from
 * the request, and it is read from a cookie that a test has no browser for.
 */
let currentRole: string | null = null;

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: async () =>
      currentRole === null
        ? null
        : {
            userId: 1,
            email: "role@example.test",
            name: null,
            tosAcceptedAt: null,
            role: currentRole,
          },
  };
});

const { GET } = await import("@/app/api/v3/notifications/active/route");

const AUDIENCES = [
  "all",
  "authenticated",
  "unauthenticated",
  "staff",
  "admin",
] as const;

// cookie_id is VARCHAR(32), so a short prefix and 8 random bytes rather than
// the longer unique() helper.
const prefix = `aud-${randomBytes(4).toString("hex")}`;
const titleFor = (audience: string) => `${prefix}-${audience}`;

async function visibleAudiences(role: string | null): Promise<string[]> {
  currentRole = role;
  const res = await GET();
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    notifications: Array<{ title: string; audience: string }>;
  };
  return body.notifications
    .filter((n) => n.title.startsWith(prefix))
    .map((n) => n.audience)
    .sort();
}

describeIntegration("active notifications by audience", () => {
  beforeAll(async () => {
    for (const audience of AUDIENCES) {
      await pool.query(
        // starts_at a minute back: the route compares it with the app's clock,
        // and a row stamped "now" by the database can be a hair in the future.
        `INSERT INTO admin_notifications (cookie_id, title, message, audience, starts_at)
         VALUES ($1, $2, 'integration fixture', $3, NOW() - INTERVAL '1 minute')`,
        [`${prefix}-${audience}`.slice(0, 32), titleFor(audience), audience],
      );
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM admin_notifications WHERE title LIKE $1`, [
      `${prefix}-%`,
    ]);
  });

  it("shows a signed-out visitor only the public and guest notices", async () => {
    expect(await visibleAudiences(null)).toEqual(["all", "unauthenticated"]);
  });

  it("shows a signed-in customer the public and signed-in notices, no staff ones", async () => {
    expect(await visibleAudiences("user")).toEqual(["all", "authenticated"]);
  });

  it.each([
    "support",
    "billing",
    "security_analyst",
    "content_manager",
    "ops",
    "moderator",
  ])("shows %s the staff notice but not the admin one", async (role) => {
    expect(await visibleAudiences(role)).toEqual([
      "all",
      "authenticated",
      "staff",
    ]);
  });

  it.each(["admin", "super_admin"])(
    "shows %s both the staff notice and the admin one",
    async (role) => {
      expect(await visibleAudiences(role)).toEqual([
        "admin",
        "all",
        "authenticated",
        "staff",
      ]);
    },
  );
});
