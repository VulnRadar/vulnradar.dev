import { describe } from "vitest";
import pool from "@/lib/database/db";
import { invalidateSettingsCache } from "@/lib/config/runtime-config";
import type { SettingKey } from "@/lib/config/registry";

/**
 * Shared fixtures for the integration tier. Everything here talks to the real
 * database that tests/integration/_global-setup.ts built.
 */

/**
 * Whether this run has a database at all. Suites gate on it so a contributor
 * without one gets a clean, named skip instead of a wall of connection errors.
 *
 * `describe.skipIf` rather than `describe.skip`: tests/README.md's "nothing is
 * silently disabled" rule bans the unconditional form, and rightly so. This is
 * the conditional form, the condition is one environment variable, and the
 * bootstrap prints exactly what to set when it is missing.
 */
export const hasIntegrationDatabase = Boolean(
  process.env.INTEGRATION_DATABASE_URL,
);

export const describeIntegration = describe.skipIf(!hasIntegrationDatabase);

let counter = 0;

/** A value unique within this run, for columns with a UNIQUE constraint. */
export function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now().toString(36)}-${counter}`;
}

export interface TestUser {
  id: number;
  email: string;
}

/**
 * Insert a user. Only the two NOT NULL columns without a default are
 * required; everything else is left to the schema's own defaults so a column
 * gaining a default (or losing one) shows up here rather than being masked by
 * a fixture that spells out every field.
 */
export async function createUser(
  overrides: {
    plan?: string;
    role?: string;
    aiCreditBalance?: number;
    browserbaseCreditSeconds?: number;
  } = {},
): Promise<TestUser> {
  const email = `${unique("user")}@example.test`;
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, plan, role, ai_credit_balance, browserbase_credit_seconds_balance)
     VALUES ($1, 'not-a-real-hash', $2, $3, $4, $5)
     RETURNING id`,
    [
      email,
      overrides.plan ?? "free",
      overrides.role ?? "user",
      overrides.aiCreditBalance ?? 0,
      overrides.browserbaseCreditSeconds ?? 0,
    ],
  );
  return { id: rows[0].id, email };
}

export async function createTeam(ownerId: number): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO teams (name, slug, owner_id) VALUES ($1, $2, $3) RETURNING id`,
    ["Integration Team", unique("team"), ownerId],
  );
  return rows[0].id;
}

/**
 * Write settings rows and drop the resolver's 30-second snapshot so the next
 * read sees them. Uses the real system_settings table rather than mocking
 * lib/config/runtime-config, so the settings path is exercised too.
 */
export async function setSettings(
  values: Partial<Record<SettingKey, string | number | boolean>>,
): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await pool.query(
      `INSERT INTO system_settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, String(value)],
    );
  }
  invalidateSettingsCache();
}

/** Remove every settings row, so one suite's overrides never leak into another. */
export async function clearSettings(): Promise<void> {
  await pool.query("DELETE FROM system_settings");
  invalidateSettingsCache();
}
