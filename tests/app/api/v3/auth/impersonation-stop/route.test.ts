import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeCookieStore } from "../_test-harness";

/**
 * Route-level tests for POST /api/v3/auth/impersonation-stop.
 *
 * Mocked at the network/database boundary only: the pg pool and
 * getClientIp. getSession (from lib/auth) and stopImpersonation (from
 * lib/auth/impersonation) both run for real against the mocked pool and
 * a fake next/headers cookie jar -- this route is deliberately NOT
 * gated by requireAdmin (see its own header comment for why), so the
 * "not currently impersonating" 400 has to come from stopImpersonation's
 * own real check, not a mocked stand-in for it.
 */

type Row = Record<string, unknown>;

let usersById: Record<number, Row> = {};
let sessionsById: Record<string, Row> = {};
const auditInserts: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  if (s.startsWith("SELECT s.user_id")) {
    const sessionId = (params[0] as string) ?? undefined;
    const row = sessionId ? sessionsById[sessionId] : undefined;
    if (!row) return { rows: [] };
    const user = usersById[row.user_id as number];
    return {
      rows: [
        {
          user_id: row.user_id,
          expires_at: row.expires_at,
          ip_address: row.ip_address ?? null,
          impersonated_by: row.impersonated_by ?? null,
          email: user?.email,
          name: user?.name ?? null,
          tos_accepted_at: null,
          disabled_at: user?.disabled_at ?? null,
          role: user?.role ?? "user",
        },
      ],
    };
  }
  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: [] };
  }
  if (s.startsWith("SELECT impersonated_by FROM sessions")) {
    const row = sessionsById[params[0] as string];
    return {
      rows: row ? [{ impersonated_by: row.impersonated_by ?? null }] : [],
    };
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
  if (s.startsWith("INSERT INTO admin_audit_log")) {
    auditInserts.push(params);
    return { rows: [] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const { store: cookieStore, state: cookieState } = makeCookieStore();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "203.0.113.5"),
}));

const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { hashSessionId } = await import("@/lib/auth/auth");
const { POST } = await import("@/app/api/v3/auth/impersonation-stop/route");

// Cookies hold the raw bearer token; sessions.id holds its digest
// (AUDIT-012#auth-07), so the fixture keys rows by the digest while the
// cookie jar keeps the token.
function seedImpersonationSession() {
  sessionsById[hashSessionId("admin-sess")] = {
    id: hashSessionId("admin-sess"),
    user_id: 1,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    impersonated_by: null,
  };
  sessionsById[hashSessionId("imp-sess")] = {
    id: hashSessionId("imp-sess"),
    user_id: 2,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    impersonated_by: 1,
  };
  cookieState.set(AUTH_SESSION_COOKIE_NAME, "imp-sess");
  cookieState.set("imp_return_session", "admin-sess");
}

beforeEach(() => {
  usersById = {
    1: { email: "admin@example.com", role: "admin", disabled_at: null },
    2: { email: "user@example.com", role: "user", disabled_at: null },
  };
  sessionsById = {};
  auditInserts.length = 0;
  cookieState.clear();
  mockQuery.mockClear();
});

describe("POST /api/v3/auth/impersonation-stop", () => {
  it("requires authentication", async () => {
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("400s when the current session is not an impersonation session", async () => {
    sessionsById[hashSessionId("plain-sess")] = {
      id: hashSessionId("plain-sess"),
      user_id: 2,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      impersonated_by: null,
    };
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "plain-sess");

    const res = await POST();
    expect(res.status).toBe(400);
  });

  it("restores the admin session, deletes the impersonation session, and audit-logs it", async () => {
    seedImpersonationSession();

    const res = await POST();
    expect(res.status).toBe(200);
    expect(cookieState.get(AUTH_SESSION_COOKIE_NAME)).toBe("admin-sess");
    expect(sessionsById[hashSessionId("imp-sess")]).toBeUndefined();

    expect(auditInserts).toHaveLength(1);
    const [adminId, targetUserId, action, details] = auditInserts[0];
    expect(adminId).toBe(1);
    expect(targetUserId).toBe(2);
    expect(action).toBe("stop_impersonate");
    // logAuditAction redacts embedded emails before persisting -- the raw
    // address never reaches admin_audit_log.
    expect(String(details)).toContain("Stopped impersonating");
    expect(String(details)).not.toContain("user@example.com");
  });
});
