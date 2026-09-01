import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { deleteUserAccountData } from "@/lib/auth/account-deletion";
import { describeIntegration, createUser, createTeam, unique } from "./_db";

/**
 * Account erasure, which is a question about the foreign-key graph and cannot
 * be answered any other way.
 *
 * lib/auth/account-deletion.ts runs about thirty DELETEs in a deliberate
 * order and ends with `DELETE FROM users`. Whether that final statement
 * succeeds depends entirely on whether every remaining reference to the row
 * cascades, is nullable and already nulled, or is ON DELETE SET NULL. Against
 * a mocked pool each DELETE is a string that "succeeds" no matter what the
 * schema says, so a new table with a plain `REFERENCES users(id)` would pass
 * the unit suite and make the account undeletable in production. That has
 * already happened once here: broadcast_messages.created_by was NOT NULL with
 * no ON DELETE clause, and deleting any staff member who had ever sent a
 * broadcast was simply impossible.
 */
describeIntegration("account deletion", () => {
  it("leaves no foreign key to users(id) that would block a delete", async () => {
    // Derived from the live catalog rather than a list in this file, so a
    // table added tomorrow is covered without anyone remembering to add it.
    // 'a' is NO ACTION (the default when no ON DELETE is written) and 'r' is
    // RESTRICT; either one turns account deletion into a FK violation unless
    // account-deletion.ts happens to null that exact column by hand first.
    const { rows } = await pool.query<{
      relname: string;
      attname: string;
      confdeltype: string;
    }>(
      `SELECT c.relname, a.attname, con.confdeltype
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_class rt ON rt.oid = con.confrelid
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f' AND rt.relname = 'users'`,
    );
    expect(rows.length).toBeGreaterThan(40);
    const blocking = rows
      .filter((r) => r.confdeltype !== "c" && r.confdeltype !== "n")
      .map((r) => `${r.relname}.${r.attname} (ON DELETE ${r.confdeltype})`);
    expect(blocking.sort()).toEqual([]);
  });

  it("erases an account that has a row in every table the function names", async () => {
    const user = await createUser({ role: "admin" });
    const bystander = await createUser();

    // Rows this user OWNS, one per table deleteUserAccountData deletes.
    const teamId = await createTeam(user.id);
    const scan = await pool.query<{ id: number }>(
      `INSERT INTO scan_history (user_id, url, status, is_public)
       VALUES ($1, 'https://owned.example.test/', 'completed', true) RETURNING id`,
      [user.id],
    );
    const scanId = scan.rows[0].id;
    const apiKey = await pool.query<{ id: number }>(
      `INSERT INTO api_keys (user_id, key_hash, key_prefix)
       VALUES ($1, $2, 'vr_live_') RETURNING id`,
      [user.id, unique("hash")],
    );
    const badge = await pool.query<{ id: number }>(
      "SELECT id FROM badges LIMIT 1",
    );
    const broadcast = await pool.query<{ id: number }>(
      `INSERT INTO broadcast_messages (title, content, message_type, created_by, sent_by)
       VALUES ('Notice', 'Body', 'in_app', $1, $1) RETURNING id`,
      [user.id],
    );

    await pool.query(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`,
      [unique("sess"), user.id],
    );
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [user.id, unique("tok")],
    );
    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [user.id, unique("tok")],
    );
    await pool.query(
      `INSERT INTO email_2fa_codes (user_id, code_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
      [user.id, unique("code")],
    );
    await pool.query(
      `INSERT INTO device_trust (user_id, device_fingerprint, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, unique("fp")],
    );
    await pool.query("INSERT INTO api_usage (api_key_id) VALUES ($1)", [
      apiKey.rows[0].id,
    ]);
    await pool.query(
      "INSERT INTO scan_tags (user_id, scan_id, tag) VALUES ($1, $2, 'Owned')",
      [user.id, scanId],
    );
    await pool.query(
      "INSERT INTO scheduled_scans (user_id, url) VALUES ($1, 'https://owned.example.test/')",
      [user.id],
    );
    await pool.query(
      `INSERT INTO host_reputation (host, danger_score, source_scan_id)
       VALUES ('owned.example.test', 10, $1)`,
      [scanId],
    );
    await pool.query(
      "INSERT INTO webhooks (user_id, url) VALUES ($1, 'https://hook.example.test/')",
      [user.id],
    );
    await pool.query(
      `INSERT INTO discord_connections (user_id, discord_id, discord_username, access_token)
       VALUES ($1, $2, 'someone', 'token')`,
      [user.id, unique("did")],
    );
    await pool.query(
      "INSERT INTO billing_history (user_id, amount_cents, status) VALUES ($1, 500, 'paid')",
      [user.id],
    );
    await pool.query(
      `INSERT INTO gifted_subscriptions (user_id, gifted_by, plan, expires_at)
       VALUES ($1, $1, 'pro_supporter', NOW() + INTERVAL '30 days')`,
      [user.id],
    );
    await pool.query(
      "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')",
      [teamId, user.id],
    );
    await pool.query(
      `INSERT INTO team_invites (team_id, email, token, invited_by, expires_at)
       VALUES ($1, 'invitee@example.test', $2, $3, NOW() + INTERVAL '7 days')`,
      [teamId, unique("invite"), user.id],
    );
    await pool.query(
      "INSERT INTO notification_preferences (user_id) VALUES ($1)",
      [user.id],
    );
    await pool.query(
      `INSERT INTO security_alerts (user_id, alert_type, severity, description)
       VALUES ($1, 'brute_force', 'high', 'Too many attempts')`,
      [user.id],
    );
    await pool.query("INSERT INTO staff_activity (user_id) VALUES ($1)", [
      user.id,
    ]);
    await pool.query("INSERT INTO data_requests (user_id) VALUES ($1)", [
      user.id,
    ]);
    await pool.query(
      "INSERT INTO ai_conversations (session_id, user_id) VALUES (gen_random_uuid(), $1)",
      [user.id],
    );
    await pool.query(
      `INSERT INTO scan_finding_feedback (user_id, finding_id, finding_url, verdict)
       VALUES ($1, 'missing-hsts', 'https://owned.example.test/', 'false_positive')`,
      [user.id],
    );
    await pool.query(
      "INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2)",
      [user.id, badge.rows[0].id],
    );
    await pool.query(
      "INSERT INTO admin_user_notes (user_id, admin_id, note) VALUES ($1, $1, 'note')",
      [user.id],
    );
    await pool.query(
      "INSERT INTO broadcast_recipients (message_id, user_id) VALUES ($1, $2)",
      [broadcast.rows[0].id, user.id],
    );
    await pool.query(
      "INSERT INTO email_logs (recipient, subject, status) VALUES ($1, 'Welcome', 'sent')",
      [user.email],
    );

    // Rows OTHER records hold that point AT this user. These are the four
    // that account-deletion.ts nulls by hand plus the audit trail it
    // de-identifies, and they are the ones that actually fail the delete when
    // the schema is wrong.
    const auditLog = await pool.query<{ id: number }>(
      `INSERT INTO admin_audit_log (admin_id, action, target_user_id)
       VALUES ($1, 'set_role', $2) RETURNING id`,
      [bystander.id, user.id],
    );
    await pool.query(
      "UPDATE security_alerts SET resolved_by = $1 WHERE user_id = $1",
      [user.id],
    );
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_by) VALUES ($1, 'true', $2)`,
      ["BILLING_ENABLED", user.id],
    );
    // The bystander's session, impersonated by the account being deleted.
    const impersonated = unique("sess");
    await pool.query(
      `INSERT INTO sessions (id, user_id, expires_at, impersonated_by)
       VALUES ($1, $2, NOW() + INTERVAL '1 day', $3)`,
      [impersonated, bystander.id, user.id],
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await deleteUserAccountData(client, user.id);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // The account is gone.
    const gone = await pool.query("SELECT 1 FROM users WHERE id = $1", [
      user.id,
    ]);
    expect(gone.rowCount).toBe(0);

    // No residue in any table keyed by user_id. Derived from the catalog
    // again: every table with a user_id column is checked, so a table nobody
    // remembered to delete from shows up by name.
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'user_id'`,
    );
    const residue: string[] = [];
    for (const { table_name } of tables.rows) {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "${table_name}" WHERE user_id = $1`,
        [user.id],
      );
      if (rows[0].n > 0) residue.push(`${table_name} (${rows[0].n})`);
    }
    expect(residue.sort()).toEqual([]);

    // The two documented non-cascade cases, checked by name because their
    // correct outcome is not "row deleted".
    const audit = await pool.query<{ target_user_id: number | null }>(
      "SELECT target_user_id FROM admin_audit_log WHERE id = $1",
      [auditLog.rows[0].id],
    );
    // De-identified, not deleted: the accountability record survives.
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].target_user_id).toBeNull();

    const emailLogs = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM email_logs WHERE recipient = $1",
      [user.email],
    );
    // No user_id and no FK, so only the explicit purge-by-recipient reaches it.
    expect(emailLogs.rows[0].n).toBe(0);

    // The public reputation snapshot this user's scan sourced. The FK is ON
    // DELETE SET NULL, so deleting the scan alone would leave the cached
    // findings serving on the unauthenticated /host page forever.
    const reputation = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM host_reputation WHERE host = 'owned.example.test'",
    );
    expect(reputation.rows[0].n).toBe(0);

    // The bystander is untouched apart from the impersonation pointer.
    const other = await pool.query<{ impersonated_by: number | null }>(
      "SELECT impersonated_by FROM sessions WHERE id = $1",
      [impersonated],
    );
    expect(other.rowCount).toBe(1);
    expect(other.rows[0].impersonated_by).toBeNull();
    const bystanderRow = await pool.query("SELECT 1 FROM users WHERE id = $1", [
      bystander.id,
    ]);
    expect(bystanderRow.rowCount).toBe(1);

    await pool.query("DELETE FROM system_settings");
  });
});
