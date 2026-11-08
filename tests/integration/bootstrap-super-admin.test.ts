import { it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import pool from "@/lib/database/db";
import { bootstrapSuperAdmin } from "@/lib/database/boot/backfills";
import { describeIntegration, unique } from "./_db";

/**
 * The boot promotion against a real PostgreSQL: the eligibility WHERE and the
 * CTE that writes the role and the audit row together.
 *
 * Everything runs in one transaction that is rolled back. The rule depends on
 * the whole users table (no super_admin anywhere, lowest eligible id overall),
 * and other suites share this database, so the test takes the existing rows
 * out of the running inside the transaction instead of changing them for real.
 *
 * Only the plan sync is mocked: it writes on its own connection and would wait
 * forever on the row lock this transaction holds.
 */
const mockSyncPlan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/staff-plan", () => ({
  syncPlanForRoleChange: mockSyncPlan,
}));

describeIntegration("super_admin boot bootstrap", () => {
  let client: PoolClient;
  let scoped: Pool;

  beforeEach(async () => {
    mockSyncPlan.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    client = await pool.connect();
    scoped = { query: client.query.bind(client) } as unknown as Pool;
    await client.query("BEGIN");
    await client.query(
      "UPDATE users SET role = 'user' WHERE role = 'super_admin'",
    );
    await client.query(
      "UPDATE users SET disabled_at = NOW() WHERE disabled_at IS NULL",
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await client.query("ROLLBACK");
    client.release();
  });

  async function user(opts: {
    verified?: boolean;
    disabled?: boolean;
    role?: string;
  }): Promise<number> {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO users (email, password_hash, role, email_verified_at, disabled_at)
       VALUES ($1, 'not-a-real-hash', $2,
               CASE WHEN $3::boolean THEN NOW() END,
               CASE WHEN $4::boolean THEN NOW() END)
       RETURNING id`,
      [
        `${unique("boot")}@example.test`,
        opts.role ?? "user",
        opts.verified ?? true,
        opts.disabled ?? false,
      ],
    );
    return rows[0].id;
  }

  async function roleOf(id: number): Promise<string> {
    const { rows } = await client.query<{ role: string }>(
      "SELECT role FROM users WHERE id = $1",
      [id],
    );
    return rows[0].role;
  }

  async function auditRows(id: number) {
    const { rows } = await client.query<{
      admin_id: number;
      target_user_id: number;
      action: string;
      details: string;
    }>(
      `SELECT admin_id, target_user_id, action, details
         FROM admin_audit_log WHERE target_user_id = $1`,
      [id],
    );
    return rows;
  }

  it("skips disabled and unverified accounts and promotes the next one", async () => {
    const disabled = await user({ disabled: true });
    const unverified = await user({ verified: false });
    const chosen = await user({});
    const later = await user({});

    await bootstrapSuperAdmin(scoped, "App");

    expect(await roleOf(chosen)).toBe("super_admin");
    expect(await roleOf(disabled)).toBe("user");
    expect(await roleOf(unverified)).toBe("user");
    expect(await roleOf(later)).toBe("user");
    expect(mockSyncPlan).toHaveBeenCalledWith(chosen, "user", "super_admin");
  });

  it("writes one audit row naming the promoted account", async () => {
    const chosen = await user({});

    await bootstrapSuperAdmin(scoped, "App");

    const rows = await auditRows(chosen);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      admin_id: chosen,
      target_user_id: chosen,
      action: "set_role",
    });
    expect(rows[0].details).toContain("super_admin");
  });

  it("changes nothing while any account holds the role, disabled or not", async () => {
    await user({ role: "super_admin", disabled: true });
    const candidate = await user({});

    await bootstrapSuperAdmin(scoped, "App");

    expect(await roleOf(candidate)).toBe("user");
    expect(await auditRows(candidate)).toHaveLength(0);
    expect(mockSyncPlan).not.toHaveBeenCalled();
  });

  it("promotes nobody when no account qualifies", async () => {
    const unverified = await user({ verified: false });

    await bootstrapSuperAdmin(scoped, "App");

    expect(await roleOf(unverified)).toBe("user");
    expect(mockSyncPlan).not.toHaveBeenCalled();
  });

  it("re-promotes on a later boot when the role has gone again", async () => {
    const chosen = await user({});
    await bootstrapSuperAdmin(scoped, "App");
    await client.query("UPDATE users SET role = 'user' WHERE id = $1", [
      chosen,
    ]);

    await bootstrapSuperAdmin(scoped, "App");

    expect(await roleOf(chosen)).toBe("super_admin");
    expect(await auditRows(chosen)).toHaveLength(2);
  });
});
