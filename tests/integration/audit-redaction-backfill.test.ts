import { it, expect, beforeEach, afterEach, vi } from "vitest";
import pool from "@/lib/database/db";
import { redactSecretSettingAuditRows } from "@/lib/database/boot/backfills";
import { describeIntegration, createUser } from "./_db";

/**
 * The boot backfill that takes old values of the secret settings out of
 * admin_audit_log, run against a real PostgreSQL. A faked pool answers the
 * prefix match and the suffix regex exactly as it answers wrong ones, and both
 * decide whether a credential stays in a table moderators can page through.
 */
const KEY = "ADMIN_ALERT_WEBHOOK_URL";
const URL_A = "https://hooks.slack.test/services/T000/B000/oldtoken111";
const URL_B = "https://hooks.slack.test/services/T000/B000/newtoken222";

describeIntegration("secret setting audit redaction backfill", () => {
  let adminId: number;

  beforeEach(async () => {
    adminId = (await createUser({ role: "admin" })).id;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool.query("DELETE FROM admin_audit_log WHERE admin_id = $1", [
      adminId,
    ]);
  });

  async function insert(action: string, details: string): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO admin_audit_log (admin_id, action, details)
       VALUES ($1, $2, $3) RETURNING id`,
      [adminId, action, details],
    );
    return rows[0].id;
  }

  async function details(id: number): Promise<string> {
    const { rows } = await pool.query<{ details: string }>(
      "SELECT details FROM admin_audit_log WHERE id = $1",
      [id],
    );
    return rows[0].details;
  }

  it("rewrites a change row, whichever value it quoted", async () => {
    const changed = await insert(
      "system_setting_changed",
      `Changed "${KEY}" from "${URL_A}" to "${URL_B}"`,
    );
    const firstSet = await insert(
      "system_setting_changed",
      `Changed "${KEY}" from "(not set)" to "${URL_B}"`,
    );

    await redactSecretSettingAuditRows(pool);

    const redacted = `Changed "${KEY}" (value redacted)`;
    expect(await details(changed)).toBe(redacted);
    expect(await details(firstSet)).toBe(redacted);
  });

  it("rewrites a reset row, which quoted the old value too", async () => {
    const reset = await insert(
      "system_setting_reset",
      `Reset "${KEY}" to its default (was "${URL_A}")`,
    );

    await redactSecretSettingAuditRows(pool);

    expect(await details(reset)).toBe(
      `Reset "${KEY}" to its default (value redacted)`,
    );
  });

  it.each(["ADMIN_ALERT_WEBHOOK_SECRET", "STAFF_OIDC_CLIENT_SECRET"])(
    "rewrites %s the same way",
    async (key) => {
      const changed = await insert(
        "system_setting_changed",
        `Changed "${key}" from "old-secret" to "new-secret"`,
      );

      await redactSecretSettingAuditRows(pool);

      expect(await details(changed)).toBe(`Changed "${key}" (value redacted)`);
    },
  );

  it("keeps the impersonation note, which is the part of the row worth keeping", async () => {
    const id = await insert(
      "system_setting_changed",
      `Changed "${KEY}" from "${URL_A}" to "${URL_B}" [while impersonating user #42]`,
    );

    await redactSecretSettingAuditRows(pool);

    expect(await details(id)).toBe(
      `Changed "${KEY}" (value redacted) [while impersonating user #42]`,
    );
  });

  it("is idempotent", async () => {
    const id = await insert(
      "system_setting_changed",
      `Changed "${KEY}" from "${URL_A}" to "${URL_B}"`,
    );

    await redactSecretSettingAuditRows(pool);
    const once = await details(id);
    await redactSecretSettingAuditRows(pool);

    expect(await details(id)).toBe(once);
  });

  it("leaves every row that is not one of those two sentences alone", async () => {
    const rows: Array<[string, string]> = [
      // What the route writes now that the key is secret.
      [
        "system_setting_changed",
        `Changed "${KEY}" (set; secret values are not logged)`,
      ],
      [
        "system_setting_reset",
        `Reset "${KEY}" to its default (secret values are not logged)`,
      ],
      // Another setting's history is still useful and holds no credential.
      ["system_setting_changed", 'Changed "SITE_NAME" from "a" to "b"'],
      // The underscores in the key must not act as LIKE wildcards.
      [
        "system_setting_changed",
        'Changed "ADMIN-ALERT-WEBHOOK-URL" from "a" to "b"',
      ],
      // The right words under an action that never carried the value.
      ["system_setting_refused", `Changed "${KEY}" from "a" to "b"`],
    ];
    const ids = await Promise.all(rows.map(([a, d]) => insert(a, d)));

    await redactSecretSettingAuditRows(pool);

    for (const [i, id] of ids.entries()) {
      expect(await details(id)).toBe(rows[i][1]);
    }
  });
});
