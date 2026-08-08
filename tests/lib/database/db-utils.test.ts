import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for lib/database/db-utils.ts: the generic CRUD/query helpers used
 * across API routes, plus the SQL-injection guards (assertIdentifier,
 * column/table allowlists, parseSafeWhere) they rely on.
 *
 * `pool` from @/lib/database/db is a thin construction wrapper around the
 * real `pg.Pool` -- db.ts adds no query-shaping logic of its own, so
 * mocking its `query` here mocks exactly at the wire boundary these
 * helpers call, matching this repo's "mock at the database boundary, not
 * below it" rule (same pattern as tests/lib/rate-limiting/rate-limit.test.ts
 * and tests/lib/auth/auth.test.ts).
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const {
  getAdminEmails,
  getUserById,
  getUserByEmail,
  updateUser,
  deleteExpiredSessions,
  getUserSessionCount,
  getDiscordConnection,
  deleteDiscordConnection,
  getUserApiKeys,
  revokeApiKey,
  batchDelete,
  batchUpdate,
} = await import("@/lib/database/db-utils");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("getAdminEmails", () => {
  it("returns the email column for every admin row", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: "a@x.com" }, { email: "b@x.com" }],
    });
    expect(await getAdminEmails()).toEqual(["a@x.com", "b@x.com"]);
    expect(mockQuery).toHaveBeenCalledWith(
      "SELECT email FROM users WHERE role = 'admin'",
    );
  });

  it("returns an empty array and does not throw when the query fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));
    expect(await getAdminEmails()).toEqual([]);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("getUserById", () => {
  it("selects the public column projection", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await getUserById(1, "public");
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("id, email, name, avatar_url, plan, role");
    expect(sql).not.toContain("password_hash");
    expect(mockQuery.mock.calls[0][1]).toEqual([1]);
  });

  it("selects the auth column projection, including password_hash", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await getUserById(1, "auth");
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("password_hash");
    expect(sql).toContain("totp_secret");
  });

  it("defaults to the full projection (SELECT *)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await getUserById(1);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("SELECT * FROM users");
  });

  it("falls back to the full projection for an unrecognized projection string", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    // Not one of "full" | "public" | "auth" -- must not be interpolated
    // directly into the column list.
    await getUserById(1, "role, password_hash");
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("SELECT * FROM users");
  });

  it("returns null and logs when the query fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("timeout"));
    expect(await getUserById(1)).toBeNull();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("returns null when no row matches", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getUserById(999)).toBeNull();
  });
});

describe("getUserByEmail", () => {
  it("lowercases and trims the email before querying", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, email: "u@x.com" }] });
    await getUserByEmail("  User@X.COM  ");
    expect(mockQuery.mock.calls[0][1]).toEqual(["user@x.com"]);
  });

  it("returns null and logs when the query fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("down"));
    expect(await getUserByEmail("u@x.com")).toBeNull();
    logged.mockRestore();
  });
});

describe("updateUser", () => {
  it("drops role, password_hash, and totp_secret even when passed by the caller", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, name: "New Name" }] });
    await updateUser(1, {
      role: "admin",
      password_hash: "smuggled-hash",
      totp_secret: "smuggled-secret",
      name: "New Name",
    });
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("name = $1");
    expect(sql).not.toContain("role");
    expect(sql).not.toContain("password_hash");
    expect(sql).not.toContain("totp_secret");
    expect(params).toEqual(["New Name", 1]);
  });

  it("falls back to a plain read when every supplied column is disallowed", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await updateUser(1, { role: "admin", password_hash: "x" });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("SELECT * FROM users WHERE id = $1");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("returns null and logs when the update fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("constraint violation"));
    expect(await updateUser(1, { name: "x" })).toBeNull();
    logged.mockRestore();
  });
});

describe("deleteExpiredSessions", () => {
  it("returns the deleted row count", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 4 });
    expect(await deleteExpiredSessions()).toBe(4);
    expect(mockQuery).toHaveBeenCalledWith(
      "DELETE FROM sessions WHERE expires_at < NOW()",
    );
  });

  it("returns 0 and does not throw on failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("down"));
    expect(await deleteExpiredSessions()).toBe(0);
    logged.mockRestore();
  });
});

describe("getUserSessionCount", () => {
  it("parses the count column to a number", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "3" }] });
    expect(await getUserSessionCount(1)).toBe(3);
  });

  it("returns 0 when the query fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("down"));
    expect(await getUserSessionCount(1)).toBe(0);
    logged.mockRestore();
  });
});

describe("Discord connection helpers", () => {
  it("getDiscordConnection returns the row for the user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 1 }] });
    expect(await getDiscordConnection(1)).toEqual({ user_id: 1 });
  });

  it("getDiscordConnection returns null on failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("down"));
    expect(await getDiscordConnection(1)).toBeNull();
    logged.mockRestore();
  });

  it("deleteDiscordConnection returns true when a row was deleted", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    expect(await deleteDiscordConnection(1)).toBe(true);
  });

  it("deleteDiscordConnection returns false when nothing matched", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    expect(await deleteDiscordConnection(1)).toBe(false);
  });

  it("deleteDiscordConnection returns false and does not throw on failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("down"));
    expect(await deleteDiscordConnection(1)).toBe(false);
    logged.mockRestore();
  });
});

describe("API key helpers", () => {
  it("getUserApiKeys returns the caller's keys", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });
    expect(await getUserApiKeys(1)).toHaveLength(2);
  });

  it("getUserApiKeys returns an empty array on failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("down"));
    expect(await getUserApiKeys(1)).toEqual([]);
    logged.mockRestore();
  });

  it("revokeApiKey returns true when a key was revoked", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    expect(await revokeApiKey(5)).toBe(true);
  });

  it("revokeApiKey returns false on failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("down"));
    expect(await revokeApiKey(5)).toBe(false);
    logged.mockRestore();
  });
});

describe("batchDelete", () => {
  it("rejects a table outside the allowlist without ever querying", async () => {
    await expect(batchDelete("users", "id = $1", [1])).rejects.toThrow(
      /not permitted/,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a table name that is not a valid SQL identifier", async () => {
    await expect(
      batchDelete("session; DROP TABLE users;--", "1=1", []),
    ).rejects.toThrow(/Invalid table/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an unsafe WHERE fragment (OR-based injection attempt) without querying", async () => {
    await expect(batchDelete("session", "1=1 OR 1=1", [])).rejects.toThrow(
      /Unsafe WHERE fragment/,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a WHERE fragment referencing an out-of-range placeholder", async () => {
    await expect(batchDelete("session", "user_id = $2", [1])).rejects.toThrow(
      /out of range/,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("allows an allowlisted table with no WHERE clause (deletes everything in that table)", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 3 });
    expect(await batchDelete("rate_limits", "", [])).toBe(3);
    expect(mockQuery).toHaveBeenCalledWith(
      "DELETE FROM rate_limits WHERE 1 = 1",
      [],
    );
  });

  it("returns 0 and logs when the delete itself fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("down"));
    expect(await batchDelete("session", "user_id = $1", [1])).toBe(0);
    logged.mockRestore();
  });

  // KNOWN BUG (not fixed here -- flagged in the test-session report):
  // parseSafeWhere() computes real placeholder positions but its return
  // statement hardcodes `values: []` (lib/database/db-utils.ts, the final
  // `return` in parseSafeWhere), discarding the values it just validated.
  // batchDelete then sends `parsed.values` -- always `[]` -- to pool.query
  // instead of the caller's own `params` argument, so any WHERE clause
  // that references a placeholder is sent to Postgres with no bound value
  // for it at all. This function is unused anywhere in the app today, but
  // if it were called with a parameterized WHERE clause it would send a
  // malformed query (fewer bind params than placeholders), which Postgres
  // would reject -- caught by the catch block and silently reported as
  // "0 rows deleted" rather than performing the intended delete.
  it("documents a real bug: the caller's WHERE param values never reach the query", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    await batchDelete("session", "user_id = $1", [42]);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe("DELETE FROM session WHERE user_id = $1");
    // BUG: should be [42] (the caller's own params), but is always [].
    expect(params).toEqual([]);
  });
});

describe("batchUpdate", () => {
  it("rejects a table outside the allowlist without ever querying", async () => {
    await expect(
      batchUpdate("users", { role: "admin" }, "", []),
    ).rejects.toThrow(/not permitted/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("drops columns outside BATCH_UPDATABLE_COLUMNS", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await batchUpdate(
      "session",
      { password_hash: "smuggled", status: "revoked" },
      "",
      [],
    );
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("status = $1");
    expect(sql).not.toContain("password_hash");
  });

  it("returns 0 without querying when every supplied column is disallowed", async () => {
    expect(await batchUpdate("session", { password_hash: "x" }, "", [])).toBe(
      0,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an unsafe WHERE fragment without querying", async () => {
    await expect(
      batchUpdate(
        "session",
        { status: "revoked" },
        "1=1; DROP TABLE session;",
        [],
      ),
    ).rejects.toThrow(/Unsafe WHERE fragment/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 0 and logs when the update itself fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("down"));
    expect(await batchUpdate("session", { status: "revoked" }, "", [])).toBe(0);
    logged.mockRestore();
  });

  // Same root cause as the batchDelete bug documented above: the SET
  // clause values are forwarded correctly, but any WHERE clause param is
  // silently dropped, so the query ends up referencing more placeholders
  // than it supplies values for.
  it("documents the same param-forwarding bug for the WHERE half of an UPDATE", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    await batchUpdate("session", { status: "revoked" }, "user_id = $1", [42]);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    // WHERE placeholder renumbered past the 1 SET param, to $2 --
    expect(sql).toBe("UPDATE session SET status = $1 WHERE user_id = $2");
    // -- but only the SET value ever makes it into the params array.
    // BUG: should be ["revoked", 42], but the second slot never arrives.
    expect(params).toEqual(["revoked"]);
  });
});
