import { it, expect, vi, beforeEach } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * Address lookups match the way the unique index does, against the real
 * schema.
 *
 * Uniqueness on users is enforced on lower(email) (idx_users_email_lower), and
 * every writer lowercases now, but rows stored before that can still hold
 * Bob@Example.com. getUserByEmail and the staff-invites route compared with
 * `email = $1` against an already lowercased value, so such a row was
 * invisible to them: the invite guards (the super_admin one included) never
 * saw the account, a pending invite stored in mixed case did not count as
 * pending, and login and signup treated the address as having no account.
 *
 * The unit tier only proves which SQL text runs. Whether Postgres finds the
 * mixed-case row is a claim about the query and the index, so it lives here.
 */

let sessionUserId: number | null = null;
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: async () =>
      sessionUserId === null ? null : { userId: sessionUserId },
  };
});

vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return { ...actual, getClientIp: async () => "203.0.113.44" };
});

const sentTo: string[] = [];
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    sendEmail: async (params: { to: string }) => {
      sentTo.push(params.to);
    },
  };
});

const { getUserByEmail } = await import("@/lib/database/db-utils");
const { POST: sendInvite } =
  await import("@/app/api/v3/admin/staff-invites/route");
const { GET: openInvite } =
  await import("@/app/api/v3/auth/staff-invite/[token]/route");

beforeEach(() => {
  sentTo.length = 0;
  sessionUserId = null;
});

/** A row as it was stored before every writer lowercased the address. */
async function createLegacyUser(role = "user") {
  const email = `Legacy-${unique("mixed")}@Example.Test`;
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, role, email_verified_at)
     VALUES ($1, 'not-a-real-hash', $2, NOW())
     RETURNING id`,
    [email, role],
  );
  return { id: rows[0].id, email };
}

/**
 * An admin the route accepts: a session, two-factor on (so ENFORCE_STAFF_2FA
 * cannot lock it out), and no password hash, which the re-auth gate treats as
 * an OAuth-created account whose session is the re-auth.
 */
async function signInAsAdmin(): Promise<number> {
  const admin = await createUser({ role: "admin" });
  await pool.query(
    "UPDATE users SET password_hash = NULL, totp_enabled = true WHERE id = $1",
    [admin.id],
  );
  sessionUserId = admin.id;
  return admin.id;
}

function inviteRequest(email: string, role: string): NextRequest {
  return new NextRequest("http://localhost/api/v3/admin/staff-invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
}

async function invitesFor(email: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM staff_invites WHERE LOWER(email) = LOWER($1)",
    [email],
  );
  return rows[0].n;
}

describeIntegration(
  "address lookups match the way the unique index does",
  () => {
    it("getUserByEmail finds a mixed-case stored address from any spelling of it", async () => {
      const legacy = await createLegacyUser();

      for (const typed of [
        legacy.email.toLowerCase(),
        legacy.email.toUpperCase(),
        `  ${legacy.email}  `,
      ]) {
        const found = await getUserByEmail(typed);
        expect(found?.id).toBe(legacy.id);
        // The stored spelling comes back untouched: the lookup normalises the
        // comparison, not the row.
        expect(found?.email).toBe(legacy.email);
      }
    });

    it("getUserByEmail still answers null for an address nobody holds", async () => {
      expect(
        await getUserByEmail(`${unique("nobody")}@example.test`),
      ).toBeNull();
    });

    it("refuses to invite a legacy mixed-case super_admin address", async () => {
      await signInAsAdmin();
      const root = await createLegacyUser("super_admin");

      const res = await sendInvite(
        inviteRequest(root.email.toLowerCase(), "support"),
      );

      expect(res.status).toBe(403);
      expect(await invitesFor(root.email)).toBe(0);
      expect(sentTo).toEqual([]);
      const { rows } = await pool.query<{ role: string }>(
        "SELECT role FROM users WHERE id = $1",
        [root.id],
      );
      expect(rows[0].role).toBe("super_admin");
    });

    it("refuses to re-invite a legacy mixed-case account into the role it already holds", async () => {
      await signInAsAdmin();
      const mod = await createLegacyUser("moderator");

      const res = await sendInvite(
        inviteRequest(mod.email.toLowerCase(), "moderator"),
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/already holds that role/i);
      expect(await invitesFor(mod.email)).toBe(0);
    });

    it("counts a pending invite stored in mixed case, so no second invite is sent", async () => {
      const adminId = await signInAsAdmin();
      const stored = `Pending-${unique("invite")}@Example.Test`;
      await pool.query(
        `INSERT INTO staff_invites (token, email, role, invited_by, expires_at)
       VALUES ($1, $2, 'support', $3, NOW() + INTERVAL '1 day')`,
        [
          createHash("sha256").update(randomBytes(32)).digest("hex"),
          stored,
          adminId,
        ],
      );

      const res = await sendInvite(inviteRequest(stored.toLowerCase(), "ops"));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/already pending/i);
      expect(await invitesFor(stored)).toBe(1);
      expect(sentTo).toEqual([]);
    });

    it("still sends an invite to a new address, stored lowercased", async () => {
      await signInAsAdmin();
      const typed = `Fresh-${unique("invitee")}@Example.Test`;

      const res = await sendInvite(inviteRequest(typed, "support"));

      expect(res.status).toBe(200);
      const { rows } = await pool.query<{ email: string }>(
        "SELECT email FROM staff_invites WHERE LOWER(email) = LOWER($1)",
        [typed],
      );
      expect(rows.map((r) => r.email)).toEqual([typed.toLowerCase()]);
      expect(sentTo).toEqual([typed.toLowerCase()]);
    });

    it("the invite page sees the legacy account behind a lowercased invite", async () => {
      const adminId = await signInAsAdmin();
      const legacy = await createLegacyUser();
      const token = randomBytes(32).toString("hex");
      await pool.query(
        `INSERT INTO staff_invites (token, email, role, invited_by, expires_at)
       VALUES ($1, $2, 'support', $3, NOW() + INTERVAL '1 day')`,
        [
          createHash("sha256").update(token).digest("hex"),
          legacy.email.toLowerCase(),
          adminId,
        ],
      );

      const res = await openInvite(
        new NextRequest(`http://localhost/api/v3/auth/staff-invite/${token}`),
        { params: Promise.resolve({ token }) },
      );

      expect(res.status).toBe(200);
      expect((await res.json()).hasAccount).toBe(true);
    });
  },
);
