import { it, expect, vi, beforeEach } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * Expired staff invites, from the list to the Overview's health row.
 *
 * The list only returned live invites while the health route counted the
 * lapsed ones, so an expired invite held the Overview's "Staff invites" row
 * amber with no screen that could show it or revoke it, and re-inviting the
 * same person left the old row behind. The fixes are a WHERE that no longer
 * drops expired rows, a DELETE in a CTE beside the INSERT, and a DISTINCT ON
 * that keeps only the newest invite per address: all things a faked pool
 * answers the same whether they are right or wrong, so they are asserted
 * here against the real table.
 *
 * Replaced: the session (a cookie a test has no browser for), the client IP,
 * the outbound mail, and the re-auth step, whose own rules are tested where
 * they live. Everything else, the admin gate included, runs for real.
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
  return { ...actual, getClientIp: async () => "203.0.113.45" };
});

vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return { ...actual, sendEmail: async () => undefined };
});

vi.mock("@/lib/auth/reauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/reauth")>();
  return { ...actual, verifyReauthPassword: async () => ({ ok: true }) };
});

const invites = await import("@/app/api/v3/admin/staff-invites/route");
const health = await import("@/app/api/v3/admin/health/route");

async function signInAsAdmin(): Promise<number> {
  const admin = await createUser({ role: "admin" });
  await pool.query("UPDATE users SET totp_enabled = true WHERE id = $1", [
    admin.id,
  ]);
  sessionUserId = admin.id;
  return admin.id;
}

async function insertInvite(
  email: string,
  invitedBy: number,
  opts: { expired?: boolean; accepted?: boolean; createdAgo?: string } = {},
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO staff_invites (token, email, role, invited_by, expires_at, accepted_at, created_at)
     VALUES ($1, $2, 'support', $3,
             NOW() + CASE WHEN $4 THEN INTERVAL '-1 day' ELSE INTERVAL '6 days' END,
             CASE WHEN $5 THEN NOW() ELSE NULL END,
             NOW() - $6::interval)
     RETURNING id`,
    [
      createHash("sha256").update(randomBytes(32)).digest("hex"),
      email,
      invitedBy,
      opts.expired ?? false,
      opts.accepted ?? false,
      opts.createdAgo ?? "0 seconds",
    ],
  );
  return rows[0].id;
}

async function healthInvites(): Promise<{ pending: number; expired: number }> {
  const res = await health.GET();
  expect(res.status).toBe(200);
  return (await res.json()).staffInvites;
}

async function listed(): Promise<
  Array<{ id: number; email: string; expired: boolean }>
> {
  const res = await invites.GET();
  expect(res.status).toBe(200);
  return (await res.json()).invites;
}

const json = (method: string, body: unknown) =>
  new NextRequest("http://localhost/api/v3/admin/staff-invites", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIntegration("expired staff invites", () => {
  beforeEach(async () => {
    sessionUserId = null;
    // The health row counts the whole table. Every suite in this tier runs
    // in one fork in sequence, and the others assert only on the invites they
    // insert themselves, so clearing it here cannot disturb them.
    await pool.query("DELETE FROM staff_invites");
  });

  it("lists an expired invite, flagged, and the health count is 0 once it is revoked", async () => {
    const adminId = await signInAsAdmin();
    const email = `${unique("lapsed")}@example.test`;
    const id = await insertInvite(email, adminId, { expired: true });

    const before = await listed();
    expect(before).toEqual([
      expect.objectContaining({ id, email, expired: true }),
    ]);
    expect(await healthInvites()).toEqual({ pending: 0, expired: 1 });

    const res = await invites.DELETE(json("DELETE", { id }));
    expect(res.status).toBe(200);

    expect(await listed()).toEqual([]);
    expect(await healthInvites()).toEqual({ pending: 0, expired: 0 });
  });

  it("clears the lapsed invite when the same address is invited again", async () => {
    const adminId = await signInAsAdmin();
    const email = `${unique("again")}@example.test`;
    const lapsed = await insertInvite(email.toUpperCase(), adminId, {
      expired: true,
      createdAgo: "8 days",
    });
    expect(await healthInvites()).toEqual({ pending: 0, expired: 1 });

    const res = await invites.POST(
      json("POST", { email, role: "support", currentAdminPassword: "x" }),
    );
    expect(res.status).toBe(200);

    const { rows } = await pool.query<{ id: number; expired: boolean }>(
      `SELECT id, expires_at <= NOW() AS expired FROM staff_invites
        WHERE LOWER(email) = LOWER($1)`,
      [email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(lapsed);
    expect(rows[0].expired).toBe(false);
    expect(await healthInvites()).toEqual({ pending: 1, expired: 0 });
  });

  it("leaves another address's lapsed invite alone on a re-invite", async () => {
    const adminId = await signInAsAdmin();
    const other = await insertInvite(
      `${unique("other")}@example.test`,
      adminId,
      { expired: true },
    );

    const res = await invites.POST(
      json("POST", {
        email: `${unique("fresh")}@example.test`,
        role: "ops",
        currentAdminPassword: "x",
      }),
    );
    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      "SELECT 1 FROM staff_invites WHERE id = $1",
      [other],
    );
    expect(rows).toHaveLength(1);
    expect(await healthInvites()).toEqual({ pending: 1, expired: 1 });
  });

  it("does not count a lapsed invite once a later one for that address was accepted", async () => {
    const adminId = await signInAsAdmin();
    const email = `${unique("accepted")}@example.test`;
    await insertInvite(email, adminId, { expired: true, createdAgo: "9 days" });
    await insertInvite(email, adminId, { accepted: true, createdAgo: "1 day" });

    expect(await healthInvites()).toEqual({ pending: 0, expired: 0 });
  });

  it("still counts an expired invite that is the newest for its address", async () => {
    const adminId = await signInAsAdmin();
    const email = `${unique("newest")}@example.test`;
    await insertInvite(email, adminId, {
      accepted: true,
      createdAgo: "9 days",
    });
    await insertInvite(email, adminId, { expired: true, createdAgo: "1 day" });

    expect(await healthInvites()).toEqual({ pending: 0, expired: 1 });
  });
});
