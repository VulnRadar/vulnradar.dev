import { it, expect, beforeAll, afterAll } from "vitest";
import pool from "@/lib/database/db";
import { performDatabaseCleanup } from "@/lib/database/cleanup";
import { describeIntegration, createUser, createTeam, unique } from "./_db";
import { setSettings, clearSettings } from "./_db";

/**
 * The nightly retention pass, checked against the rows it actually leaves
 * behind.
 *
 * performDatabaseCleanup is thirty DELETEs whose entire behaviour is in their
 * WHERE clauses: a retention window read from settings, a column name, and
 * occasionally a second condition (a team invite that was accepted must
 * survive its own expiry; browser_sessions falls back to created_at only when
 * expires_at is null). With pool.query mocked, every one of those returns
 * whatever rowCount the test scripted, so a prune pointed at the wrong column,
 * or one that lost half its WHERE and started deleting live data, reports the
 * same success. Each case below therefore seeds a pair: one row past the
 * window that must go, one inside it that must not.
 */
const RETENTION_DAYS = 30;
const OLD = "NOW() - INTERVAL '60 days'";
const FRESH = "NOW() - INTERVAL '1 day'";

describeIntegration("retention cleanup", () => {
  let userId: number;
  let scanId: number;
  let webhookId: number;
  let acceptedInvite: string;
  let expiredInvite: string;
  let liveSessionId: string;
  let deadSessionId: string;

  beforeAll(async () => {
    await setSettings({
      BILLING_ENABLED: true,
      BILLING_FREE_RETENTION: RETENTION_DAYS,
      AI_CHAT_HISTORY_DAYS: RETENTION_DAYS,
      SUBDOMAIN_CACHE_TTL_HOURS: 24,
      CLEANUP_API_USAGE_RETENTION_DAYS: RETENTION_DAYS,
      CLEANUP_REVOKED_API_KEYS_RETENTION_DAYS: RETENTION_DAYS,
      CLEANUP_DATA_REQUESTS_RETENTION_DAYS: RETENTION_DAYS,
      CLEANUP_ADMIN_AUDIT_LOG_RETENTION_DAYS: RETENTION_DAYS,
      CLEANUP_ADMIN_USER_NOTES_RETENTION_DAYS: RETENTION_DAYS,
      CLEANUP_SECURITY_ALERTS_RETENTION_DAYS: RETENTION_DAYS,
      CLEANUP_SYSTEM_ERROR_LOGS_RETENTION_DAYS: RETENTION_DAYS,
      CLEANUP_EMAIL_LOG_RETENTION_DAYS: RETENTION_DAYS,
      CLEANUP_SCAN_FINDING_FEEDBACK_RETENTION_DAYS: RETENTION_DAYS,
      CLEANUP_USER_NOTIFICATIONS_RETENTION_DAYS: RETENTION_DAYS,
      CLEANUP_GITHUB_REVIEW_USAGE_RETENTION_DAYS: RETENTION_DAYS,
      CLEANUP_KEV_CACHE_RETENTION_DAYS: RETENTION_DAYS,
    });

    const user = await createUser({ plan: "free" });
    userId = user.id;
    const teamId = await createTeam(userId);

    // Every pair below is (kept, pruned) in that order, marked by the `notes`
    // / name / key column so the assertions can name the row rather than
    // count it.
    const kept = await pool.query<{ id: number }>(
      `INSERT INTO scan_history (user_id, url, status, scanned_at)
       VALUES ($1, 'https://keep.example.test/', 'completed', ${FRESH}) RETURNING id`,
      [userId],
    );
    scanId = kept.rows[0].id;
    await pool.query(
      `INSERT INTO scan_history (user_id, url, status, scanned_at)
       VALUES ($1, 'https://prune.example.test/', 'completed', ${OLD})`,
      [userId],
    );
    // The reputation snapshot must outlive the scan that sourced it: it is
    // public-safety data about a host, not personal data, and cleanup.ts
    // documents at length that nothing here may delete it.
    await pool.query(
      `INSERT INTO host_reputation (host, danger_score, source_scan_id)
       VALUES ('prune.example.test', 42, (SELECT id FROM scan_history WHERE url = 'https://prune.example.test/'))`,
    );

    liveSessionId = unique("sess");
    deadSessionId = unique("sess");
    await pool.query(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES
         ($1, $3, NOW() + INTERVAL '1 day'),
         ($2, $3, NOW() - INTERVAL '1 hour')`,
      [liveSessionId, deadSessionId, userId],
    );

    const key = await pool.query<{ id: number }>(
      `INSERT INTO api_keys (user_id, key_hash, key_prefix) VALUES ($1, $2, 'vr_live_') RETURNING id`,
      [userId, unique("hash")],
    );
    await pool.query(
      `INSERT INTO api_usage (api_key_id, used_at) VALUES ($1, ${FRESH}), ($1, ${OLD})`,
      [key.rows[0].id],
    );
    await pool.query(
      `INSERT INTO api_keys (user_id, key_hash, key_prefix, revoked_at)
       VALUES ($1, $2, 'vr_live_', ${OLD})`,
      [userId, unique("hash")],
    );

    await pool.query(
      `INSERT INTO rate_limits (key, "count", window_start) VALUES
         ($1, 1, NOW()), ($2, 1, NOW() - INTERVAL '3 days')`,
      [unique("rl-keep"), unique("rl-prune")],
    );

    acceptedInvite = unique("invite");
    expiredInvite = unique("invite");
    await pool.query(
      `INSERT INTO team_invites (team_id, email, token, invited_by, expires_at, accepted_at) VALUES
         ($1, 'a@example.test', $2, $4, NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 days'),
         ($1, 'b@example.test', $3, $4, NOW() - INTERVAL '1 day', NULL)`,
      [teamId, acceptedInvite, expiredInvite, userId],
    );

    await pool.query(
      `INSERT INTO ai_conversations (session_id, user_id, last_message_at) VALUES
         (gen_random_uuid(), $1, ${FRESH}), (gen_random_uuid(), $1, ${OLD})`,
      [userId],
    );
    await pool.query(
      `INSERT INTO user_notifications (user_id, type, title, message, created_at) VALUES
         ($1, 'scan', 'keep', 'body', ${FRESH}), ($1, 'scan', 'prune', 'body', ${OLD})`,
      [userId],
    );
    await pool.query(
      `INSERT INTO system_error_logs (message, created_at) VALUES ($1, ${FRESH}), ($2, ${OLD})`,
      ["keep-error", "prune-error"],
    );
    await pool.query(
      `INSERT INTO email_logs (recipient, subject, status, created_at) VALUES
         ('keep@example.test', 's', 'sent', ${FRESH}),
         ('prune@example.test', 's', 'sent', ${OLD})`,
    );

    const webhook = await pool.query<{ id: number }>(
      `INSERT INTO webhooks (user_id, url) VALUES ($1, 'https://hook.example.test/') RETURNING id`,
      [userId],
    );
    webhookId = webhook.rows[0].id;
    await pool.query(
      `INSERT INTO webhook_deliveries (webhook_id, event_type, attempted_at) VALUES
         ($1, 'scan.completed', ${FRESH}), ($1, 'scan.completed', ${OLD})`,
      [webhookId],
    );

    await pool.query(
      `INSERT INTO subdomain_cache (domain, subdomains, cached_at) VALUES
         ($1, '[]'::jsonb, NOW()), ($2, '[]'::jsonb, NOW() - INTERVAL '48 hours')`,
      [unique("keep") + ".example.test", unique("prune") + ".example.test"],
    );

    await pool.query(
      `INSERT INTO admin_audit_log (admin_id, action, created_at) VALUES
         ($1, 'keep_action', ${FRESH}), ($1, 'prune_action', ${OLD})`,
      [userId],
    );

    // expires_at wins where it is set; created_at is only the fallback.
    await pool.query(
      `INSERT INTO browser_sessions (id, user_id, created_at, expires_at) VALUES
         ($1, $3, NOW(), NOW() + INTERVAL '5 minutes'),
         ($2, $3, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '5 minutes')`,
      [unique("bs-keep"), unique("bs-prune"), userId],
    );
  });

  afterAll(async () => {
    await clearSettings();
  });

  it("prunes past the retention window and leaves everything inside it", async () => {
    const stats = await performDatabaseCleanup();

    const count = async (sql: string, params: unknown[] = []) => {
      const { rows } = await pool.query<{ n: number }>(sql, params);
      return rows[0].n;
    };

    // Scans: the per-plan window applies to the free user's old scan only.
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM scan_history WHERE url = 'https://prune.example.test/'",
      ),
    ).toBe(0);
    expect(
      await count("SELECT COUNT(*)::int AS n FROM scan_history WHERE id = $1", [
        scanId,
      ]),
    ).toBe(1);
    expect(stats.oldScans).toBeGreaterThanOrEqual(1);

    // Sessions go by their own expires_at, not by age.
    expect(
      await count("SELECT COUNT(*)::int AS n FROM sessions WHERE id = $1", [
        deadSessionId,
      ]),
    ).toBe(0);
    expect(
      await count("SELECT COUNT(*)::int AS n FROM sessions WHERE id = $1", [
        liveSessionId,
      ]),
    ).toBe(1);

    expect(
      await count(
        `SELECT COUNT(*)::int AS n FROM api_usage WHERE used_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`,
      ),
    ).toBe(0);
    expect(
      await count("SELECT COUNT(*)::int AS n FROM api_usage"),
    ).toBeGreaterThanOrEqual(1);
    // Only REVOKED keys are pruned. A live key is never touched by age.
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM api_keys WHERE user_id = $1",
        [userId],
      ),
    ).toBe(1);

    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day'",
      ),
    ).toBe(0);

    // An invite that was accepted survives its own expiry: the row is the
    // record that the person joined, not a pending invitation.
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM team_invites WHERE token = $1",
        [acceptedInvite],
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM team_invites WHERE token = $1",
        [expiredInvite],
      ),
    ).toBe(0);

    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM user_notifications WHERE title = 'prune'",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM user_notifications WHERE title = 'keep'",
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM system_error_logs WHERE message = 'prune-error'",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM system_error_logs WHERE message = 'keep-error'",
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM email_logs WHERE recipient = 'prune@example.test'",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM email_logs WHERE recipient = 'keep@example.test'",
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM webhook_deliveries WHERE webhook_id = $1",
        [webhookId],
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT COUNT(*)::int AS n FROM subdomain_cache WHERE cached_at < NOW() - INTERVAL '24 hours'`,
      ),
    ).toBe(0);
    expect(
      await count("SELECT COUNT(*)::int AS n FROM subdomain_cache"),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await count(
        `SELECT COUNT(*)::int AS n FROM ai_conversations WHERE last_message_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`,
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM ai_conversations WHERE user_id = $1",
        [userId],
      ),
    ).toBe(1);

    // browser_sessions: expired by its own expires_at, not by created_at.
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM browser_sessions WHERE user_id = $1",
        [userId],
      ),
    ).toBe(1);
  });

  it("archives the audit log it is about to purge, in the same transaction", async () => {
    // The one genuinely coupled pair in the pass. Both statements see the
    // same NOW(), so there is no window in which a row is purged unarchived.
    const purged = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action = 'prune_action'",
    );
    expect(purged.rows[0].n).toBe(0);
    const stillThere = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action = 'keep_action'",
    );
    expect(stillThere.rows[0].n).toBe(1);

    const archive = await pool.query<{ row_count: number; rows: unknown[] }>(
      "SELECT row_count, rows FROM admin_audit_log_archive ORDER BY id DESC LIMIT 1",
    );
    expect(archive.rowCount).toBe(1);
    expect(archive.rows[0].row_count).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(archive.rows[0].rows).includes("prune_action")).toBe(
      true,
    );
  });

  it("never deletes the public host-reputation cache", async () => {
    // The scan that sourced it was pruned above. host_reputation has no
    // user_id at all and feeds the unauthenticated /host page and the browser
    // extension; the FK is ON DELETE SET NULL precisely so the cached row
    // outlives the scan. cleanup.ts carries a comment telling the next author
    // not to add a DELETE here, and this is that comment with teeth.
    const { rows } = await pool.query<{
      n: number;
      source_scan_id: number | null;
    }>(
      `SELECT COUNT(*)::int AS n, MAX(source_scan_id) AS source_scan_id
         FROM host_reputation WHERE host = 'prune.example.test'`,
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].source_scan_id).toBeNull();
  });
});
