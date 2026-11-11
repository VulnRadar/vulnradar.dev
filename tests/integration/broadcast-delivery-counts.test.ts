import { it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createUser, unique, type TestUser } from "./_db";

/**
 * What a broadcast reports about its own delivery, judged by Postgres.
 *
 * bug-messaging-18: a specific address typed with different capitalisation
 * matched nobody and the broadcast was still marked sent. bug-ui-admin-11: a
 * resend was described as "everyone again" while it only ever retried the
 * failures, and nothing showed how many people a broadcast reached. The counts
 * behind all of that are a LEFT JOIN of the audience onto broadcast_recipients
 * and a LATERAL aggregate in the list, which a faked pool answers however it
 * is told to, so they run here against the real tables.
 *
 * Same seams as broadcast-optin.test.ts: getSession because there is no
 * browser cookie, sendEmail so nothing leaves the process (and so one address
 * can be made to fail).
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
const failing = new Set<string>();
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    sendEmail: async (opts: { to: string }) => {
      if (failing.has(opts.to)) throw new Error("transport refused");
      sent.push(opts.to);
    },
  };
});

const { POST } = await import("@/app/api/v3/admin/features/route");

function call(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/v3/admin/features", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ section: "broadcast", ...body }),
    }),
  );
}

describeIntegration("broadcast delivery counts", () => {
  let admin: TestUser;
  const messageIds: number[] = [];

  async function verified(): Promise<TestUser> {
    const user = await createUser();
    await pool.query(
      "UPDATE users SET email_verified_at = NOW() WHERE id = $1",
      [user.id],
    );
    return user;
  }

  async function draft(segmentFilter: unknown): Promise<number> {
    const res = await call({
      action: "create",
      title: "Counts broadcast",
      content: "<p>hi</p>",
      message_type: "email",
      segment_filter: segmentFilter,
    });
    expect(res.status).toBe(200);
    const id = (await res.json()).message.id as number;
    messageIds.push(id);
    return id;
  }

  async function settled(id: number) {
    await vi.waitFor(
      async () => {
        const { rows } = await pool.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM broadcast_recipients
            WHERE message_id = $1 AND status = 'pending'`,
          [id],
        );
        expect(rows[0].n).toBe(0);
        const status = await pool.query<{ status: string }>(
          "SELECT status FROM broadcast_messages WHERE id = $1",
          [id],
        );
        expect(status.rows[0].status).toBe("sent");
      },
      { timeout: 15_000, interval: 100 },
    );
  }

  beforeAll(async () => {
    admin = await createUser({ role: "admin" });
    sessionUserId = admin.id;
  });

  beforeEach(() => {
    sent.length = 0;
    failing.clear();
  });

  afterAll(async () => {
    if (messageIds.length > 0) {
      await pool.query("DELETE FROM broadcast_messages WHERE id = ANY($1)", [
        messageIds,
      ]);
    }
  });

  it("reaches a specific address typed with other capitalisation and padding", async () => {
    const user = await verified();
    const id = await draft({ segment: `email:  ${user.email.toUpperCase()} ` });

    const res = await call({ action: "send", id });
    expect(res.status).toBe(200);
    expect((await res.json()).recipients).toBe(1);
    await settled(id);
    expect(sent).toEqual([user.email]);
  });

  // The other half of the fix: users.email keeps the capitalisation an older
  // account signed up with, so a lower-cased address only finds it through
  // LOWER(u.email). Without that this one matches nobody and is refused.
  it("reaches an account whose stored address has capitals in it", async () => {
    const stored = `Mixed-${unique("case")}@Example.Test`;
    await pool.query(
      `INSERT INTO users (email, password_hash, email_verified_at)
       VALUES ($1, 'not-a-real-hash', NOW())`,
      [stored],
    );
    const id = await draft({ segment: `email:${stored.toLowerCase()}` });

    const res = await call({ action: "send", id });
    expect(res.status).toBe(200);
    expect((await res.json()).recipients).toBe(1);
    await settled(id);
    expect(sent).toEqual([stored]);
  });

  it("refuses a send that would reach nobody and leaves it a draft", async () => {
    const id = await draft({ segment: "email:nobody-here@example.test" });

    const res = await call({ action: "send", id });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("nobody-here@example.test");

    const { rows } = await pool.query<{
      status: string;
      sent_at: Date | null;
    }>("SELECT status, sent_at FROM broadcast_messages WHERE id = $1", [id]);
    expect(rows[0]).toEqual({ status: "draft", sent_at: null });
  });

  /** Move the resend cooldown out of the way, so the retry is what is tested. */
  async function pastCooldown(id: number) {
    await pool.query(
      "UPDATE broadcast_messages SET sent_at = NOW() - INTERVAL '1 day' WHERE id = $1",
      [id],
    );
  }

  async function listed(id: number) {
    const res = await call({ action: "list" });
    return (await res.json()).messages.find((m: { id: number }) => m.id === id);
  }

  // One address per broadcast keeps every count about rows this suite wrote:
  // the database is shared, and a segment would count other suites' users.
  it("counts a failed delivery, and a resend retries it", async () => {
    const flaky = await verified();
    const id = await draft({ segment: `email:${flaky.email}` });

    const before = await call({ action: "audience", id });
    expect((await before.json()).counts).toEqual({
      audience: 1,
      newRecipients: 1,
      failed: 0,
      alreadySent: 0,
      pending: 0,
      toReach: 1,
    });

    failing.add(flaky.email);
    expect((await call({ action: "send", id })).status).toBe(200);
    await settled(id);
    expect(sent).toEqual([]);
    expect(await listed(id)).toMatchObject({
      state: "sent",
      recipients: 1,
      sent_count: 0,
      failed_count: 1,
      pending_count: 0,
    });

    const after = await call({ action: "audience", id });
    expect((await after.json()).counts).toMatchObject({
      failed: 1,
      newRecipients: 0,
      toReach: 1,
    });

    await pastCooldown(id);
    failing.clear();
    const resent = await call({ action: "resend", id });
    expect(resent.status).toBe(200);
    expect(await resent.json()).toMatchObject({ retried: 1, newRecipients: 0 });
    // A resend's broadcast is already 'sent', so settled() cannot tell it
    // has finished: wait on the delivery row itself.
    await vi.waitFor(
      async () => {
        expect(await listed(id)).toMatchObject({
          sent_count: 1,
          failed_count: 0,
          pending_count: 0,
        });
      },
      { timeout: 15_000, interval: 100 },
    );
    expect(sent).toEqual([flaky.email]);
  });

  it("never mails a delivered recipient again, and says there is nothing to resend", async () => {
    const user = await verified();
    const id = await draft({ segment: `email:${user.email}` });
    expect((await call({ action: "send", id })).status).toBe(200);
    await settled(id);
    expect(sent).toEqual([user.email]);

    const after = await call({ action: "audience", id });
    expect((await after.json()).counts).toMatchObject({
      audience: 1,
      alreadySent: 1,
      toReach: 0,
    });

    await pastCooldown(id);
    sent.length = 0;
    const resent = await call({ action: "resend", id });
    expect(resent.status).toBe(409);
    expect((await resent.json()).error).toMatch(/Nothing to resend/);
    expect(sent).toEqual([]);
  });
});
