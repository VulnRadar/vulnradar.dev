import type { PoolClient } from "pg";

/**
 * The single, exhaustive list of DELETEs that make up "permanently erase
 * this account's data" -- shared by app/api/v3/admin/route.ts's
 * delete_account handler (admin-initiated) and
 * app/api/v3/account/delete/route.ts (self-service), which used to each
 * maintain their own independent version of this list. They drifted: the
 * admin route did ~24 explicit itemized DELETEs while the self-service
 * route relied almost entirely on DB-level ON DELETE CASCADE, so a table
 * added to one path (or a CASCADE definition that didn't quite match)
 * could silently leave residual data behind depending on which route a
 * user's account went through. This function is now the only place either
 * path defines "what gets deleted," so admin-delete and self-delete are
 * identical by construction, not by two lists staying in sync by hand.
 *
 * Caller owns the transaction (BEGIN/COMMIT/ROLLBACK) and any
 * caller-specific steps before/after: capturing the user's email for a
 * notification, re-verifying a password, destroying the caller's own
 * session, writing an audit log entry, deleting on-disk avatar files
 * (not part of this SQL transaction -- filesystem writes don't roll
 * back). This function itself only ever runs SQL, ending with the
 * `users` row itself so every FK above it is already gone or nulled.
 *
 * Two known non-cascading FK columns (both nullable, no ON DELETE clause)
 * are nulled out here rather than relying on a schema-level ON DELETE
 * SET NULL, since nulling a handful of rows inline is simpler than a
 * migration for a column that's genuinely fine staying RESTRICT-by-default
 * in the general case -- it only needs handling here, at delete time.
 * broadcast_messages.created_by does NOT get the same treatment: that
 * column used to be NOT NULL with no ON DELETE clause at all (a real bug,
 * not a nullable-but-unhandled case -- it made deleting any staff account
 * that ever created a broadcast impossible, full stop, regardless of
 * which delete path was used). Fixed at the schema level instead (see
 * scripts/migrate/versions/2.0.0-to-3.0.0.mjs / instrumentation.ts): the
 * column is now nullable with ON DELETE SET NULL, so it no longer needs
 * any special handling here at all.
 */
export async function deleteUserAccountData(
  client: PoolClient,
  userId: number,
): Promise<void> {
  // Sessions & auth
  await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [
    userId,
  ]);
  await client.query(
    "DELETE FROM email_verification_tokens WHERE user_id = $1",
    [userId],
  );
  await client.query("DELETE FROM email_2fa_codes WHERE user_id = $1", [
    userId,
  ]);
  await client.query("DELETE FROM device_trust WHERE user_id = $1", [userId]);

  // API
  await client.query(
    "DELETE FROM api_usage WHERE api_key_id IN (SELECT id FROM api_keys WHERE user_id = $1)",
    [userId],
  );
  await client.query("DELETE FROM api_keys WHERE user_id = $1", [userId]);

  // Scans
  await client.query("DELETE FROM scan_tags WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM scheduled_scans WHERE user_id = $1", [
    userId,
  ]);
  // Purge the public reputation-cache snapshots this user's scans sourced
  // BEFORE deleting the scans -- host_reputation.source_scan_id is ON DELETE SET
  // NULL, so deleting the scans first orphans the findings copy, which keeps
  // serving on the unauthenticated /host + reputation endpoints. Account
  // deletion is a stronger erasure than a single-scan delete (which already
  // does this), so the same purge applies.
  await client.query(
    "DELETE FROM host_reputation WHERE source_scan_id IN (SELECT id FROM scan_history WHERE user_id = $1)",
    [userId],
  );
  await client.query("DELETE FROM scan_history WHERE user_id = $1", [userId]);

  // Integrations
  await client.query("DELETE FROM webhooks WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM discord_connections WHERE user_id = $1", [
    userId,
  ]);

  // Billing
  await client.query("DELETE FROM billing_history WHERE user_id = $1", [
    userId,
  ]);
  await client.query("DELETE FROM gifted_subscriptions WHERE user_id = $1", [
    userId,
  ]);

  // Teams
  await client.query("DELETE FROM team_members WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM team_invites WHERE invited_by = $1", [
    userId,
  ]);
  await client.query("DELETE FROM teams WHERE owner_id = $1", [userId]);

  // Notifications / prefs
  await client.query(
    "DELETE FROM notification_preferences WHERE user_id = $1",
    [userId],
  );

  // Security / monitoring
  await client.query("DELETE FROM security_alerts WHERE user_id = $1", [
    userId,
  ]);
  await client.query("DELETE FROM staff_activity WHERE user_id = $1", [userId]);

  // GDPR
  await client.query("DELETE FROM data_requests WHERE user_id = $1", [userId]);

  // Badges
  await client.query("DELETE FROM user_badges WHERE user_id = $1", [userId]);

  // Admin metadata
  await client.query("DELETE FROM admin_user_notes WHERE user_id = $1", [
    userId,
  ]);
  // De-identify rather than delete: admin_audit_log is the platform's
  // accountability record of what administrative action was taken and why
  // (privacy policy's Data Retention section documents this exact
  // behavior). Nulling target_user_id removes the row's only link back to
  // this account while keeping the entry itself -- the admin who took the
  // action, what they did, and when, all survive account deletion.
  await client.query(
    "UPDATE admin_audit_log SET target_user_id = NULL WHERE target_user_id = $1",
    [userId],
  );

  // Broadcast tracking
  await client.query("DELETE FROM broadcast_recipients WHERE user_id = $1", [
    userId,
  ]);

  // Non-cascading FK references (GDPR audit, 2026-08): these two columns
  // have no ON DELETE clause (default RESTRICT) and are nullable, so an
  // account that ever resolved a security alert or changed a system
  // setting would otherwise fail the DELETE below with a foreign-key
  // violation. Null them out first.
  await client.query(
    "UPDATE security_alerts SET resolved_by = NULL WHERE resolved_by = $1",
    [userId],
  );
  await client.query(
    "UPDATE system_settings SET updated_by = NULL WHERE updated_by = $1",
    [userId],
  );
  // broadcast_messages.sent_by tracks who last (re)sent a broadcast; unlike
  // its sibling created_by (migrated to ON DELETE SET NULL) it has a plain FK
  // with no ON DELETE, so a staff account that ever resent a broadcast would
  // otherwise FK-violate the DELETE below and could never be deleted.
  await client.query(
    "UPDATE broadcast_messages SET sent_by = NULL WHERE sent_by = $1",
    [userId],
  );
  // sessions.impersonated_by points at the admin on a *target's* session row
  // (not this user's own sessions, already deleted above), same plain-FK issue:
  // deleting an admin mid-impersonation would FK-violate without this.
  await client.query(
    "UPDATE sessions SET impersonated_by = NULL WHERE impersonated_by = $1",
    [userId],
  );

  // Finally, the user row itself. Every FK above either points at a row
  // already deleted, or has already been nulled/SET-NULL-on-delete.
  await client.query("DELETE FROM users WHERE id = $1", [userId]);
}
