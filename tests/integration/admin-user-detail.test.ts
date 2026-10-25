import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { fetchUserDetailBundle } from "@/lib/admin/user-detail";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The admin user panel's one statement, against real rows.
 *
 * Eleven queries became one SELECT with json sub-selects. Whether that
 * statement is valid, correlates every sub-select to the right user, orders
 * and limits its lists, and leaves out what a role may not see are all
 * Postgres's answers, and a mocked pool returns whatever it was told to.
 */
const ALL = {
  scans: true,
  apiKeys: true,
  webhooks: true,
  sessions: true,
  credits: true,
};

describeIntegration("the admin user detail statement", () => {
  it("returns every lookup for the right user and none for another", async () => {
    const user = await createUser({ aiCreditBalance: 1500 });
    const other = await createUser();
    const admin = await createUser({ role: "admin" });

    // Scans: twelve for the user (the panel shows ten), one for someone else.
    for (let i = 0; i < 12; i++) {
      await pool.query(
        `INSERT INTO scan_history (user_id, url, status, scanned_at)
         VALUES ($1, $2, $3, NOW() - make_interval(mins => $4::int))`,
        [
          user.id,
          `https://${unique("d")}.example.test/`,
          i === 0 ? "failed" : "completed",
          i,
        ],
      );
    }
    await pool.query(
      `INSERT INTO scan_history (user_id, url, status) VALUES ($1, 'https://other.example.test/', 'completed')`,
      [other.id],
    );

    // A note, an API key, a webhook, a schedule and a session.
    await pool.query(
      `INSERT INTO admin_user_notes (user_id, admin_id, note) VALUES ($1, $2, 'called about billing')`,
      [user.id, admin.id],
    );
    await pool.query(
      `INSERT INTO api_keys (user_id, key_hash, key_prefix) VALUES ($1, $2, 'vr_test')`,
      [user.id, unique("hash")],
    );
    await pool.query(
      `INSERT INTO webhooks (user_id, name, url, type) VALUES ($1, 'ops', 'https://hooks.example.test/services/SECRET/TOKEN', 'slack')`,
      [user.id],
    );

    const bundle = await fetchUserDetailBundle(user.id, ALL);
    expect(bundle).not.toBeNull();
    expect(bundle!.user).toMatchObject({ id: user.id, email: user.email });
    // The sub-selects did not leak into the account record.
    expect(bundle!.user).not.toHaveProperty("recent_scans");

    // Newest first, capped at ten, and only this user's.
    expect(bundle!.recentScans).toHaveLength(10);
    const scans = bundle!.recentScans as { status: string; url: string }[];
    expect(scans[0].status).toBe("failed");
    expect(scans.every((s) => !s.url.includes("other.example"))).toBe(true);

    expect(bundle!.notes).toHaveLength(1);
    expect((bundle!.notes as { admin_email: string }[])[0].admin_email).toBe(
      admin.email,
    );
    expect(bundle!.apiKeys).toHaveLength(1);

    // The host, not the path: the path is the bearer token.
    const webhooks = bundle!.webhooks as { url_host: string }[];
    expect(webhooks).toHaveLength(1);
    expect(webhooks[0].url_host).toBe("hooks.example.test");
    expect(JSON.stringify(bundle)).not.toContain("SECRET");

    expect(bundle!.credits?.aiCreditBalance).toBe(1500);
    // No discord or github connection was created.
    expect(bundle!.discordConnection).toBeNull();
    expect(bundle!.githubRepoConnection).toBeNull();
  });

  it("reads empty lists, not nulls, for a user with nothing", async () => {
    const user = await createUser();
    const bundle = await fetchUserDetailBundle(user.id, ALL);
    expect(bundle).toMatchObject({
      recentScans: [],
      apiKeys: [],
      webhooks: [],
      schedules: [],
      activeSessions: [],
      badges: [],
      notes: [],
    });
  });

  it("does not read what the caller's flags leave out", async () => {
    const user = await createUser({ aiCreditBalance: 99 });
    await pool.query(
      `INSERT INTO scan_history (user_id, url, status) VALUES ($1, 'https://x.example.test/', 'completed')`,
      [user.id],
    );
    const bundle = await fetchUserDetailBundle(user.id, {
      scans: false,
      apiKeys: false,
      webhooks: false,
      sessions: false,
      credits: false,
    });
    expect(bundle!.recentScans).toEqual([]);
    expect(bundle!.credits).toBeNull();
    // The aggregate counter is part of the account row, not the scans card.
    expect(bundle!.user.scan_count).toBe(1);
    expect(bundle!.user.public_host_report_count).toBeNull();
  });

  it("counts the public host reports built from the user's scans", async () => {
    const user = await createUser();
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO scan_history (user_id, url, status) VALUES ($1, 'https://rep.example.test/', 'completed') RETURNING id`,
      [user.id],
    );
    const host = `${unique("hostrep")}.example.test`;
    await pool.query(
      `INSERT INTO host_reputation (host, danger_score, source_scan_id) VALUES ($1, 10, $2)`,
      [host, rows[0].id],
    );
    const bundle = await fetchUserDetailBundle(user.id, ALL);
    expect(bundle!.user.public_host_report_count).toBe(1);
  });

  it("returns null for a user that does not exist", async () => {
    expect(await fetchUserDetailBundle(2_147_000_000, ALL)).toBeNull();
  });
});
