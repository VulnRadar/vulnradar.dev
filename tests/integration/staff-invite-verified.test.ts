import { it, expect, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createUser } from "./_db";

vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return { ...actual, getClientIp: async () => "203.0.113.9" };
});

const { GET, POST } =
  await import("@/app/api/v3/auth/staff-invite/[token]/route");

/**
 * Staff invite acceptance against the real schema (sec-auth-2).
 *
 * The unit tier proves which statements run; these prove what they do. The
 * refusal has to leave the role and the invite exactly as they were, which is
 * a claim about a rolled-back transaction, and the alert's NOT EXISTS has to
 * keep a reloaded acceptance page from filing a row per load, which is a claim
 * about the JSONB lookup and the casts on an INSERT ... SELECT.
 */

async function seedInvite(email: string, role = "support") {
  const admin = await createUser({ role: "admin" });
  const token = randomBytes(32).toString("hex");
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO staff_invites (token, email, role, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day')
     RETURNING id`,
    [createHash("sha256").update(token).digest("hex"), email, role, admin.id],
  );
  return { token, inviteId: rows[0].id };
}

function ctx(token: string) {
  return { params: Promise.resolve({ token }) };
}

function get(token: string) {
  return GET(
    new NextRequest(`http://localhost/api/v3/auth/staff-invite/${token}`, {
      headers: { "user-agent": "integration" },
    }),
    ctx(token),
  );
}

function post(token: string) {
  return POST(
    new NextRequest(`http://localhost/api/v3/auth/staff-invite/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    ctx(token),
  );
}

async function roleOf(userId: number): Promise<string> {
  const { rows } = await pool.query<{ role: string }>(
    "SELECT role FROM users WHERE id = $1",
    [userId],
  );
  return rows[0].role;
}

async function acceptedAt(inviteId: number): Promise<string | null> {
  const { rows } = await pool.query<{ accepted_at: string | null }>(
    "SELECT accepted_at FROM staff_invites WHERE id = $1",
    [inviteId],
  );
  return rows[0].accepted_at;
}

async function alertsFor(userId: number) {
  const { rows } = await pool.query<{
    details: { inviteId: string; role: string };
    ip_address: string | null;
    severity: string;
  }>(
    `SELECT details, host(ip_address) AS ip_address, severity
       FROM security_alerts
      WHERE user_id = $1 AND alert_type = 'staff_invite_unverified_email'`,
    [userId],
  );
  return rows;
}

describeIntegration("staff invite acceptance needs a verified address", () => {
  it("refuses an unverified account: the role and the invite are untouched and one alert is filed", async () => {
    const squatter = await createUser();
    const { token, inviteId } = await seedInvite(squatter.email, "admin");

    const res = await post(token);

    expect(res.status).toBe(400);
    expect(await roleOf(squatter.id)).toBe("user");
    expect(await acceptedAt(inviteId)).toBeNull();
    const alerts = await alertsFor(squatter.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].details).toEqual({
      inviteId: String(inviteId),
      role: "admin",
    });
    // The request is the token holder's, not the squatter's: its IP must not
    // land on the squatter's alert, where their data export would return it.
    expect(alerts[0].ip_address).toBeNull();
    expect(alerts[0].severity).toBe("high");
  });

  it("files one open alert per invite however many times the page is loaded", async () => {
    const squatter = await createUser();
    const { token } = await seedInvite(squatter.email);

    expect((await get(token)).status).toBe(400);
    expect((await get(token)).status).toBe(400);
    expect((await post(token)).status).toBe(400);

    expect(await alertsFor(squatter.id)).toHaveLength(1);
  });

  it("files a fresh alert once the previous one was resolved", async () => {
    const squatter = await createUser();
    const { token } = await seedInvite(squatter.email);

    await get(token);
    await pool.query(
      "UPDATE security_alerts SET resolved_at = NOW() WHERE user_id = $1",
      [squatter.id],
    );
    await get(token);

    expect(await alertsFor(squatter.id)).toHaveLength(2);
  });

  it("promotes the same account once it has verified the address", async () => {
    const invitee = await createUser();
    const { token, inviteId } = await seedInvite(invitee.email);
    await pool.query(
      "UPDATE users SET email_verified_at = NOW() WHERE id = $1",
      [invitee.id],
    );

    const res = await post(token);

    expect(res.status).toBe(200);
    expect(await roleOf(invitee.id)).toBe("support");
    expect(await acceptedAt(inviteId)).not.toBeNull();
    expect(await alertsFor(invitee.id)).toHaveLength(0);
  });
});
