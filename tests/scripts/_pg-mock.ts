import { vi, type Mock } from "vitest";

/**
 * Test-only helper for scripts/maintenance/db-diagnose-2fa.mjs and
 * scripts/maintenance/db-repair-2fa.mjs. Both take a pg-Pool-shaped object as their
 * first argument (dependency injection), so tests mock at that exact
 * boundary -- a fake pool/client, not the 'pg' module itself -- per this
 * repo's "mock at the database boundary, not below it" rule
 * (tests/README.md).
 */

export const V5_5_SCHEMA_ROWS = [
  { table_name: "users", column_name: "id" },
  { table_name: "users", column_name: "totp_enabled" },
  { table_name: "users", column_name: "totp_secret" },
  { table_name: "users", column_name: "backup_codes" },
  { table_name: "users", column_name: "two_factor_method" },
  { table_name: "users", column_name: "updated_at" },
  { table_name: "email_2fa_codes", column_name: "id" },
  { table_name: "email_2fa_codes", column_name: "user_id" },
  { table_name: "email_2fa_codes", column_name: "code_hash" },
  { table_name: "email_2fa_codes", column_name: "code_salt" },
  { table_name: "email_2fa_codes", column_name: "expires_at" },
];

/** Same shape, but email_2fa_codes predates the code_salt column. */
export const V2_SCHEMA_ROWS_NO_CODE_SALT = V5_5_SCHEMA_ROWS.filter(
  (r) => !(r.table_name === "email_2fa_codes" && r.column_name === "code_salt"),
);

interface MockPoolOptions {
  schemaRows?: Array<{ table_name: string; column_name: string }>;
  totalUsers?: number;
  enabledUsers?: unknown[];
  emailCodeRows?: unknown[];
  adminRows?: Array<{ id: number; email: string; role: string }>;
}

/**
 * Builds a fake pool whose `.query` branches on recognizable substrings
 * of the SQL text, matching the exact queries
 * scripts/maintenance/db-diagnose-2fa.mjs / scripts/maintenance/db-repair-2fa.mjs issue.
 *
 * `connect` defaults to a mock that throws -- scripts/maintenance/db-repair-2fa.mjs's
 * dry-run path must never call `pool.connect()` at all, so a test that
 * doesn't override `connect` gets an assertion failure for free the
 * moment it's called unexpectedly. Tests that need a real connect
 * behavior pass their own mock (typed as ReturnType<typeof vi.fn>, so no
 * `any` cast is needed at the call site).
 */
export function buildMockPool({
  schemaRows = V5_5_SCHEMA_ROWS,
  totalUsers = 0,
  enabledUsers = [],
  emailCodeRows = [],
  adminRows = [],
}: MockPoolOptions = {}) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("information_schema.columns")) {
      return { rows: schemaRows };
    }
    if (sql.includes("SELECT COUNT(*)::int AS n FROM users")) {
      return { rows: [{ n: totalUsers }] };
    }
    if (sql.includes("FROM users WHERE totp_enabled = true")) {
      return { rows: enabledUsers };
    }
    if (sql.includes("SELECT id, email, role FROM users WHERE id = $1")) {
      const id = params?.[0];
      return { rows: adminRows.filter((r) => r.id === id) };
    }
    if (sql.includes("FROM email_2fa_codes")) {
      return { rows: emailCodeRows };
    }
    throw new Error(`Unexpected query in test mock: ${sql}`);
  });

  const connect: Mock<(...args: unknown[]) => Promise<unknown>> = vi.fn(
    async () => {
      throw new Error(
        "pool.connect() was not expected to be called in this test -- pass connect: ... via buildMockPool() or assign pool.connect to override.",
      );
    },
  );

  return { query, connect };
}

/**
 * A fake pg.PoolClient: query() + release(), used by pool.connect().
 *
 * `query` always returns a genuine Promise (wrapping queryImpl in an
 * async function), matching the real pg client's contract -- callers in
 * scripts/maintenance/db-repair-2fa.mjs chain `.catch()` directly off `client.query(...)`,
 * which would throw a TypeError against a mock that returns a plain
 * object instead of a Promise. Wrapping in `async` also means a
 * synchronous throw from queryImpl becomes a rejected Promise, exactly
 * like a real query failure.
 */
export function buildMockClient(
  queryImpl: (sql: string, params?: unknown[]) => unknown,
) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) =>
      queryImpl(sql, params),
    ),
    release: vi.fn(),
  };
}
