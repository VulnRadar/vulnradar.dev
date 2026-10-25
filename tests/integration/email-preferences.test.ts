import { it, expect } from "vitest";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { POST } from "@/app/api/v3/account/unsubscribe/route";
import {
  ALL_COLUMNS,
  DEFAULT_PREFERENCES,
  optedInCondition,
  type NotificationColumn,
} from "@/lib/notifications/columns";
import { describeIntegration, createUser } from "./_db";

/**
 * The email preference rows, against the real schema.
 *
 * Three claims worth making here are claims about PostgreSQL and none of them
 * survives a faked pool: that an INSERT naming one column leaves every other
 * column at its DDL default (which is what makes the schema, not the code,
 * the definition of a new account), that ON CONFLICT (user_id) turns one
 * category off without touching its neighbours, and that COALESCE over a
 * LEFT JOIN treats a missing row as the column's default rather than as "yes".
 */

async function tokenOf(userId: number): Promise<string> {
  const { rows } = await pool.query<{ unsubscribe_token: string }>(
    "SELECT unsubscribe_token FROM users WHERE id = $1",
    [userId],
  );
  return rows[0].unsubscribe_token;
}

async function prefsOf(
  userId: number,
): Promise<Record<NotificationColumn, boolean> | null> {
  const { rows } = await pool.query(
    `SELECT ${ALL_COLUMNS.join(", ")} FROM notification_preferences WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

function unsubscribe(query: string, body?: unknown): Promise<Response> {
  return POST(
    new NextRequest(`http://localhost/api/v3/account/unsubscribe?${query}`, {
      method: "POST",
      headers: body
        ? { "content-type": "application/json" }
        : { "content-type": "application/x-www-form-urlencoded" },
      body: body ? JSON.stringify(body) : "List-Unsubscribe=One-Click",
    }),
  );
}

describeIntegration("one-click unsubscribe", () => {
  it("turns off one category for an account with no preferences row, leaving every other column at its schema default", async () => {
    const user = await createUser();
    const token = await tokenOf(user.id);
    expect(await prefsOf(user.id)).toBeNull();

    const res = await unsubscribe(`token=${token}&type=email_scan_complete`);
    expect(res.status).toBe(200);

    const prefs = await prefsOf(user.id);
    expect(prefs).not.toBeNull();
    for (const column of ALL_COLUMNS) {
      // Only the named column moved. Everything else is what the DDL says,
      // Tips & Guides included, which the code used to get wrong.
      const expected =
        column === "email_scan_complete" ? false : DEFAULT_PREFERENCES[column];
      expect(prefs![column], column).toBe(expected);
    }
  });

  it("keeps an earlier unsubscribe when a second category is turned off", async () => {
    const user = await createUser();
    const token = await tokenOf(user.id);

    await unsubscribe(`token=${token}&type=email_scan_complete`);
    await unsubscribe(`token=${token}&type=email_posture_digest`);

    const prefs = await prefsOf(user.id);
    expect(prefs!.email_scan_complete).toBe(false);
    expect(prefs!.email_posture_digest).toBe(false);
    // The warnings that exist to catch a takeover are untouched.
    expect(prefs!.email_new_login).toBe(true);
    expect(prefs!.email_password_change).toBe(true);
    expect(prefs!.email_2fa_change).toBe(true);
  });

  it("leaves a stored choice of the same user's other categories alone", async () => {
    const user = await createUser();
    await pool.query(
      `INSERT INTO notification_preferences (user_id, email_new_login, email_tips_guides)
       VALUES ($1, false, true)`,
      [user.id],
    );
    const token = await tokenOf(user.id);

    await unsubscribe(`token=${token}&type=email_product_updates`);

    const prefs = await prefsOf(user.id);
    expect(prefs!.email_product_updates).toBe(false);
    // Chosen earlier, in the other direction from their defaults, and kept.
    expect(prefs!.email_new_login).toBe(false);
    expect(prefs!.email_tips_guides).toBe(true);
  });

  it("refuses the always-on column and writes nothing", async () => {
    const user = await createUser();
    const token = await tokenOf(user.id);

    const res = await unsubscribe(`token=${token}&type=email_security`);

    expect(res.status).toBe(400);
    expect(await prefsOf(user.id)).toBeNull();
  });

  it("still lets the explicit page action switch everything off except the security alerts", async () => {
    const user = await createUser();
    const token = await tokenOf(user.id);

    const res = await unsubscribe(`token=${token}&action=unsubscribe_all`);
    expect(res.status).toBe(200);

    const prefs = await prefsOf(user.id);
    for (const column of ALL_COLUMNS) {
      expect(prefs![column], column).toBe(column === "email_security");
    }
  });

  it("applies a selective update from the preferences page", async () => {
    const user = await createUser();
    const token = await tokenOf(user.id);

    const res = await unsubscribe(`token=${token}`, {
      prefs: { email_tips_guides: true, email_schedules: false },
    });
    expect(res.status).toBe(200);

    const prefs = await prefsOf(user.id);
    expect(prefs!.email_tips_guides).toBe(true);
    expect(prefs!.email_schedules).toBe(false);
    expect(prefs!.email_scan_complete).toBe(true);
  });

  it("knows nothing about a token it never issued", async () => {
    const res = await unsubscribe(
      `token=00000000-0000-4000-8000-000000000000&type=email_scan_complete`,
    );
    expect(res.status).toBe(404);
  });
});

describeIntegration("a new account's preferences", () => {
  it("get the schema defaults from an INSERT that names only the user", async () => {
    const user = await createUser();

    // Exactly what signup and the OAuth callback run.
    await pool.query(
      "INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [user.id],
    );
    // And again, which must not disturb the row.
    await pool.query(
      "INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [user.id],
    );

    const prefs = await prefsOf(user.id);
    for (const column of ALL_COLUMNS) {
      expect(prefs![column], column).toBe(DEFAULT_PREFERENCES[column]);
    }
  });
});

describeIntegration("the broadcast audience filter", () => {
  /** The same join and condition deliverBroadcast puts in its page query. */
  async function audience(
    column: NotificationColumn,
    userIds: number[],
  ): Promise<number[]> {
    const { rows } = await pool.query<{ id: number }>(
      `SELECT u.id FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE u.id = ANY($1::int[]) AND ${optedInCondition(column)}
       ORDER BY u.id`,
      [userIds],
    );
    return rows.map((r) => r.id);
  }

  it("treats a user with no row as the column's default, not as opted in", async () => {
    const noRow = await createUser();
    const optedIn = await createUser();
    const optedOut = await createUser();
    await pool.query(
      "INSERT INTO notification_preferences (user_id, email_tips_guides, email_product_updates) VALUES ($1, true, true)",
      [optedIn.id],
    );
    await pool.query(
      "INSERT INTO notification_preferences (user_id, email_tips_guides, email_product_updates) VALUES ($1, false, false)",
      [optedOut.id],
    );
    const ids = [noRow.id, optedIn.id, optedOut.id];

    // Tips & Guides is opt-in: a missing row is a "no". It used to be a "yes".
    expect(await audience("email_tips_guides", ids)).toEqual([optedIn.id]);
    // Product updates is opt-out: a missing row is a "yes".
    expect(await audience("email_product_updates", ids)).toEqual(
      [noRow.id, optedIn.id].sort((a, b) => a - b),
    );
  });

  it("follows a stored choice in either direction", async () => {
    const wantsNothing = await createUser();
    await pool.query(
      `INSERT INTO notification_preferences (user_id, email_product_updates)
       VALUES ($1, false)`,
      [wantsNothing.id],
    );
    expect(await audience("email_product_updates", [wantsNothing.id])).toEqual(
      [],
    );
  });
});
