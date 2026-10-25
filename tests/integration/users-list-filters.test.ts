import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import {
  fetchUsersPage,
  parseUserFilters,
  userOrderBy,
} from "@/lib/admin/users-query";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The admin user list's filters, run by Postgres.
 *
 * The list took one optional WHERE, so "which accounts are disabled", "who has
 * no second factor" and "find user 1042" could not be answered from the panel.
 * The predicates, the id-or-text search and the LIKE escaping are SQL.
 */
function users(query: string, limit = 50) {
  const filter = parseUserFilters(new URLSearchParams(query));
  if (!filter.ok) throw new Error(filter.error);
  return fetchUsersPage(filter, {
    limit,
    offset: 0,
    orderBy: userOrderBy(null, null),
  });
}

const emails = (rows: Record<string, unknown>[]) =>
  rows.map((r) => r.email as string).sort();

describeIntegration("user list filters", () => {
  it("finds disabled, unverified and no-2FA accounts, and only those", async () => {
    // A unique label in every email isolates this from other suites' users.
    const label = unique("flt").replace(/[^a-z0-9]/g, "");
    const mk = async (
      tag: string,
      extra: { disabled?: boolean; verified?: boolean; totp?: boolean },
    ) => {
      const email = `${label}-${tag}@example.test`;
      await pool.query(
        `INSERT INTO users (email, password_hash, disabled_at, email_verified_at, totp_enabled)
         VALUES ($1, 'x', $2, $3, $4)`,
        [
          email,
          extra.disabled ? new Date() : null,
          extra.verified === false ? null : new Date(),
          extra.totp === true,
        ],
      );
      return email;
    };
    const disabled = await mk("disabled", { disabled: true, totp: true });
    const unverified = await mk("unverified", { verified: false, totp: true });
    const noTwoFactor = await mk("no2fa", {});
    const healthy = await mk("healthy", { totp: true });

    const base = `search=${label}`;
    expect(emails((await users(`${base}&status=disabled`)).users)).toEqual([
      disabled,
    ]);
    expect(emails((await users(`${base}&status=unverified`)).users)).toEqual([
      unverified,
    ]);
    // Only the account with no second factor at all; the three that have one
    // on, healthy included, are left out.
    expect(emails((await users(`${base}&status=no2fa`)).users)).toEqual([
      noTwoFactor,
    ]);
    const everyone = await users(base);
    expect(everyone.total).toBe(4);
    expect(emails(everyone.users)).toContain(healthy);
  });

  it("filters by plan and by role, and 'staff' means every staff role", async () => {
    const label = unique("role").replace(/[^a-z0-9]/g, "");
    const mk = async (tag: string, role: string, plan: string) => {
      const email = `${label}-${tag}@example.test`;
      await pool.query(
        `INSERT INTO users (email, password_hash, role, plan) VALUES ($1, 'x', $2, $3)`,
        [email, role, plan],
      );
      return email;
    };
    const ops = await mk("ops", "ops", "pro_supporter");
    const billing = await mk("billing", "billing", "pro_supporter");
    const plain = await mk("plain", "user", "free");

    const base = `search=${label}`;
    // The specialist roles are what the old four-role literal missed.
    expect(emails((await users(`${base}&role=staff`)).users)).toEqual(
      [ops, billing].sort(),
    );
    expect(emails((await users(`${base}&role=ops`)).users)).toEqual([ops]);
    expect(emails((await users(`${base}&role=user`)).users)).toEqual([plain]);
    expect(emails((await users(`${base}&plan=free`)).users)).toEqual([plain]);
    expect(
      emails((await users(`${base}&plan=pro_supporter&role=billing`)).users),
    ).toEqual([billing]);
  });

  it("lets a number find the user with that id", async () => {
    const target = await createUser();
    const result = await users(`search=${target.id}`);
    // The id match plus any email that happens to contain those digits; the
    // account itself must be there.
    expect(result.users.map((u) => u.id)).toContain(target.id);
  });

  it("counts what the filter leaves, not the whole table, and pages it", async () => {
    const label = unique("page").replace(/[^a-z0-9]/g, "");
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO users (email, password_hash) VALUES ($1, 'x')`,
        [`${label}-${i}@example.test`],
      );
    }
    const first = await users(`search=${label}`, 2);
    expect(first.total).toBe(3);
    expect(first.users).toHaveLength(2);
  });

  it("treats LIKE metacharacters in the search as characters", async () => {
    const label = unique("meta").replace(/[^a-z0-9]/g, "");
    await pool.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', $2)`,
      [`${label}-a@example.test`, "100% sure"],
    );
    await pool.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', $2)`,
      [`${label}-b@example.test`, "100x sure"],
    );
    const result = await users(`search=${encodeURIComponent("100% sure")}`);
    // Unescaped, % would match "100x sure" as well.
    expect(result.users.map((u) => u.email)).toEqual([
      `${label}-a@example.test`,
    ]);
  });
});
