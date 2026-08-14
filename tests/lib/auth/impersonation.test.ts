import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for lib/auth/impersonation.ts. Mocked at the database boundary
 * (pool.query) and next/headers (the cookie jar) -- everything else
 * (STAFF_ROLE_HIERARCHY lookups, the actual start/stop logic) runs for
 * real.
 */

type Row = Record<string, unknown>;

let usersById: Record<number, Row> = {};
let sessionsById: Record<string, Row> = {};
const queries: { sql: string; params: unknown[] }[] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  const s = sql.trim();

  if (s.startsWith("SELECT email, role, disabled_at FROM users")) {
    const row = usersById[params[0] as number];
    return { rows: row ? [row] : [] };
  }
  if (s.startsWith("SELECT impersonated_by FROM sessions")) {
    const row = sessionsById[params[0] as string];
    return {
      rows: row ? [{ impersonated_by: row.impersonated_by ?? null }] : [],
    };
  }
  if (s.startsWith("INSERT INTO sessions")) {
    const [id, userId, expiresAt, ip, userAgent, impersonatedBy] = params as [
      string,
      number,
      Date,
      string | null,
      string | null,
      number,
    ];
    sessionsById[id] = {
      id,
      user_id: userId,
      expires_at: expiresAt.toISOString(),
      ip_address: ip,
      user_agent: userAgent,
      impersonated_by: impersonatedBy,
    };
    return { rows: [] };
  }
  if (s.includes("SELECT s.expires_at, u.role FROM sessions")) {
    const row = sessionsById[params[0] as string];
    if (!row) return { rows: [] };
    const user = usersById[row.user_id as number];
    return {
      rows: [{ expires_at: row.expires_at, role: user?.role ?? "user" }],
    };
  }
  if (s.startsWith("DELETE FROM sessions WHERE id")) {
    delete sessionsById[params[0] as string];
    return { rows: [] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const cookieState = new Map<string, string>();
const cookieStore = {
  get: vi.fn((name: string) => {
    const value = cookieState.get(name);
    return value === undefined ? undefined : { name, value };
  }),
  set: vi.fn((name: string, value: string) => {
    cookieState.set(name, value);
  }),
  delete: vi.fn((name: string) => {
    cookieState.delete(name);
  }),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

const { startImpersonation, stopImpersonation } =
  await import("@/lib/auth/impersonation");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");

function seedAdminSession(sessionId: string) {
  sessionsById[sessionId] = {
    id: sessionId,
    user_id: 1,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    impersonated_by: null,
  };
  cookieState.set(AUTH_SESSION_COOKIE_NAME, sessionId);
}

beforeEach(() => {
  usersById = {
    1: { email: "admin@example.com", role: "admin", disabled_at: null },
    2: { email: "user@example.com", role: "user", disabled_at: null },
    3: {
      email: "disabled@example.com",
      role: "user",
      disabled_at: "2026-01-01",
    },
    4: { email: "support@example.com", role: "support", disabled_at: null },
  };
  sessionsById = {};
  queries.length = 0;
  cookieState.clear();
  mockQuery.mockClear();
});

describe("startImpersonation", () => {
  it("rejects self-impersonation", async () => {
    seedAdminSession("admin-sess");
    const result = await startImpersonation(1, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/own account/i);
  });

  it("rejects a nonexistent target user", async () => {
    seedAdminSession("admin-sess");
    const result = await startImpersonation(1, 999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/i);
  });

  it("rejects a disabled target account", async () => {
    seedAdminSession("admin-sess");
    const result = await startImpersonation(1, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/disabled/i);
  });

  it("rejects a staff/admin-tier target", async () => {
    seedAdminSession("admin-sess");
    const result = await startImpersonation(1, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/staff or admin/i);
  });

  it("rejects when there is no active admin session cookie", async () => {
    // no seedAdminSession call -- cookie jar is empty
    const result = await startImpersonation(1, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no active admin session/i);
  });

  it("rejects starting a nested impersonation session", async () => {
    seedAdminSession("admin-sess");
    sessionsById["admin-sess"].impersonated_by = 1;
    const result = await startImpersonation(1, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already impersonating/i);
  });

  it("creates a short-lived session row for the target, tagged with impersonated_by", async () => {
    seedAdminSession("admin-sess");
    const before = Date.now();
    const result = await startImpersonation(1, 2, "1.2.3.4", "test-agent");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetEmail).toBe("user@example.com");

    const newSessionId = cookieState.get(AUTH_SESSION_COOKIE_NAME);
    expect(newSessionId).toBeDefined();
    expect(newSessionId).not.toBe("admin-sess");

    const row = sessionsById[newSessionId!];
    expect(row.user_id).toBe(2);
    expect(row.impersonated_by).toBe(1);
    expect(row.ip_address).toBe("1.2.3.4");
    expect(row.user_agent).toBe("test-agent");

    const expiresAt = new Date(row.expires_at as string).getTime();
    // 1 hour, with generous slack for test execution time.
    expect(expiresAt - before).toBeGreaterThan(59 * 60 * 1000);
    expect(expiresAt - before).toBeLessThan(61 * 60 * 1000);
  });

  it("preserves the admin's original session id in a separate return cookie", async () => {
    seedAdminSession("admin-sess");
    await startImpersonation(1, 2);
    expect(cookieState.get("imp_return_session")).toBe("admin-sess");
    // The original admin session row itself is untouched (not deleted).
    expect(sessionsById["admin-sess"]).toBeDefined();
  });
});

describe("stopImpersonation", () => {
  it("rejects when not currently impersonating (no session cookies at all)", async () => {
    const result = await stopImpersonation();
    expect(result.ok).toBe(false);
  });

  it("rejects when the current session isn't actually an impersonation session", async () => {
    seedAdminSession("admin-sess");
    cookieState.set("imp_return_session", "admin-sess");
    const result = await stopImpersonation();
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/not currently impersonating/i);
  });

  it("restores the admin's session and deletes the impersonation session", async () => {
    seedAdminSession("admin-sess");
    await startImpersonation(1, 2);
    const impSessionId = cookieState.get(AUTH_SESSION_COOKIE_NAME)!;

    const result = await stopImpersonation();
    expect(result.ok).toBe(true);
    expect(cookieState.get(AUTH_SESSION_COOKIE_NAME)).toBe("admin-sess");
    expect(cookieState.has("imp_return_session")).toBe(false);
    expect(sessionsById[impSessionId]).toBeUndefined();
  });

  it("tears down the impersonation session even when the admin's return session expired", async () => {
    seedAdminSession("admin-sess");
    await startImpersonation(1, 2);
    const impSessionId = cookieState.get(AUTH_SESSION_COOKIE_NAME)!;
    // Simulate the admin's original session having expired mid-impersonation.
    sessionsById["admin-sess"].expires_at = new Date(
      Date.now() - 1000,
    ).toISOString();

    const result = await stopImpersonation();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/expired/i);
    expect(sessionsById[impSessionId]).toBeUndefined();
    expect(cookieState.has(AUTH_SESSION_COOKIE_NAME)).toBe(false);
    expect(cookieState.has("imp_return_session")).toBe(false);
  });

  it("treats a return session belonging to a non-staff role as invalid", async () => {
    seedAdminSession("admin-sess");
    await startImpersonation(1, 2);
    // Defense-in-depth case: the admin's own role somehow dropped below
    // staff tier while impersonating (e.g. demoted by another admin).
    usersById[1].role = "user";

    const result = await stopImpersonation();
    expect(result.ok).toBe(false);
    expect(cookieState.has(AUTH_SESSION_COOKIE_NAME)).toBe(false);
  });
});
