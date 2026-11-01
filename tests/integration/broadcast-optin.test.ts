import { it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createUser, type TestUser } from "./_db";

/**
 * Who a broadcast is delivered to, judged by Postgres.
 *
 * A broadcast with no category used to skip the notification_preferences JOIN
 * and had no disabled_at condition, so the Unsubscribe link in a marketing
 * mail did not stop the next one and an account staff had disabled kept
 * receiving them. The unit suite can only read the WHERE clause as a string.
 * Whether an opted-out row and a disabled row are actually left out is a
 * property of that clause run against the real tables, so it is asserted here.
 *
 * getSession is replaced because the admin is read from a cookie a test has
 * no browser for; sendEmail is replaced so nothing leaves the process and the
 * recipients can be read back. Everything else, the route, the keyset walk and
 * the recipient claim, runs for real.
 */
let sessionUserId = 0;

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: async () => ({
      userId: sessionUserId,
      email: "admin@example.test",
      name: null,
      tosAcceptedAt: null,
      role: "admin",
    }),
  };
});

vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return { ...actual, getClientIp: async () => "127.0.0.1" };
});

const sent: string[] = [];
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    sendEmail: async (opts: { to: string }) => {
      sent.push(opts.to);
    },
  };
});

const { POST } = await import("@/app/api/v3/admin/features/route");

describeIntegration("broadcast audience", () => {
  let admin: TestUser;
  let subscribed: TestUser;
  let optedOut: TestUser;
  let disabled: TestUser;
  let unverified: TestUser;
  const messageIds: number[] = [];

  async function verified(): Promise<TestUser> {
    const user = await createUser();
    await pool.query(
      "UPDATE users SET email_verified_at = NOW() WHERE id = $1",
      [user.id],
    );
    return user;
  }

  /** Save a draft, send it through the route, and wait for delivery. */
  async function broadcast(segmentFilter: unknown): Promise<string[]> {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO broadcast_messages (title, content, message_type, segment_filter, created_by, status)
       VALUES ('Integration broadcast', '<p>hi</p>', 'email', $1, $2, 'draft')
       RETURNING id`,
      [JSON.stringify(segmentFilter), admin.id],
    );
    const id = rows[0].id;
    messageIds.push(id);

    const res = await POST(
      new NextRequest("http://localhost/api/v3/admin/features", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section: "broadcast", action: "send", id }),
      }),
    );
    expect(res.status).toBe(200);

    // Delivery runs on a timer after the response, and the row only turns
    // 'sent' once the whole keyset walk has finished.
    await vi.waitFor(
      async () => {
        const status = await pool.query<{ status: string }>(
          "SELECT status FROM broadcast_messages WHERE id = $1",
          [id],
        );
        expect(status.rows[0].status).toBe("sent");
      },
      { timeout: 15_000, interval: 100 },
    );

    const ours = new Set(
      [admin, subscribed, optedOut, disabled, unverified].map((u) => u.email),
    );
    return sent.filter((to) => ours.has(to)).sort();
  }

  beforeAll(async () => {
    admin = await createUser({ role: "admin" });
    sessionUserId = admin.id;
    subscribed = await verified();
    optedOut = await verified();
    disabled = await verified();
    unverified = await createUser();

    // The only way a user turns announcements off: a row with the column
    // false, which is what the one-click unsubscribe writes.
    await pool.query(
      `INSERT INTO notification_preferences (user_id, email_product_updates)
       VALUES ($1, false)`,
      [optedOut.id],
    );
    await pool.query("UPDATE users SET disabled_at = NOW() WHERE id = $1", [
      disabled.id,
    ]);
  });

  beforeEach(() => {
    sent.length = 0;
  });

  afterAll(async () => {
    if (messageIds.length > 0) {
      await pool.query("DELETE FROM broadcast_messages WHERE id = ANY($1)", [
        messageIds,
      ]);
    }
  });

  it("leaves out the opted-out and the disabled account when no category was chosen", async () => {
    const reached = await broadcast({ segment: "all" });
    expect(reached).toEqual([subscribed.email]);
  });

  it("leaves them out of a draft saved with no segment filter at all", async () => {
    const reached = await broadcast(null);
    expect(reached).toEqual([subscribed.email]);
  });

  it("still mails an opted-out user who was named as the specific address", async () => {
    const reached = await broadcast({ segment: `email:${optedOut.email}` });
    expect(reached).toEqual([optedOut.email]);
  });

  it("never mails a disabled account, even named as the specific address", async () => {
    const reached = await broadcast({ segment: `email:${disabled.email}` });
    expect(reached).toEqual([]);
  });
});
