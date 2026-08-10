import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../_test-harness";

/**
 * Route-level tests for GET and DELETE /api/v3/auth/sessions.
 *
 * Mocked at the network/database boundary only: the pg pool. getSession,
 * listUserSessions, and deleteAllSessions run for real against the mocked
 * pool. The route also clears the session cookie directly via
 * next/headers cookies() (not through destroySession()), so the fake
 * cookie jar has to reflect that.
 */

let sessionRow: Record<string, unknown> | null = null;
let sessionsDeleteCalls: unknown[][] = [];
let userSessionsRows: Record<string, unknown>[] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.includes("SELECT s.user_id"))
    return { rows: sessionRow ? [sessionRow] : [] };
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (s.startsWith("SELECT id, ip_address, user_agent, created_at, expires_at"))
    return { rows: userSessionsRows };
  if (s.startsWith("DELETE FROM sessions WHERE user_id = $1")) {
    sessionsDeleteCalls.push(params);
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
const { store: headerStore } = makeHeaderStore();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => headerStore),
}));

const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { hashSessionId } = await import("@/lib/auth/auth");
const { GET, DELETE } = await import("@/app/api/v3/auth/sessions/route");

beforeEach(() => {
  mockQuery.mockClear();
  cookieState.clear();
  sessionRow = null;
  sessionsDeleteCalls = [];
  userSessionsRows = [];
  invalidateSettingsCache();
});

describe("GET /api/v3/auth/sessions", () => {
  it("requires a session", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the caller's own sessions, hashing the id and flagging the current one", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "raw-session-1");
    sessionRow = defaultSessionRow({ user_id: 33 });
    userSessionsRows = [
      {
        id: "raw-session-1",
        ip_address: "203.0.113.5",
        user_agent:
          "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36",
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "raw-session-2",
        ip_address: "198.51.100.9",
        user_agent: "curl/8.0",
        created_at: "2026-01-02T00:00:00.000Z",
        expires_at: "2026-02-01T00:00:00.000Z",
      },
    ];

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sessions).toHaveLength(2);

    const current = json.sessions.find(
      (s: { isCurrent: boolean }) => s.isCurrent,
    );
    const other = json.sessions.find(
      (s: { isCurrent: boolean }) => !s.isCurrent,
    );

    expect(current.id).toBe(hashSessionId("raw-session-1"));
    expect(current.device).toBe("Chrome on Windows");
    expect(current.ipAddress).toBe("203.0.113.5");

    expect(other.id).toBe(hashSessionId("raw-session-2"));
    expect(other.device).toBe("curl");

    // The raw bearer token must never appear anywhere in the response --
    // that's exactly what httpOnly on the cookie is meant to prevent an
    // XSS payload from reading, so the JSON API can't hand it back either.
    const body = JSON.stringify(json);
    expect(body).not.toContain("raw-session-1");
    expect(body).not.toContain("raw-session-2");
  });
});

describe("DELETE /api/v3/auth/sessions", () => {
  it("requires a session", async () => {
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(sessionsDeleteCalls).toHaveLength(0);
  });

  it("revokes every session for the user and clears the cookie", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
    sessionRow = defaultSessionRow({ user_id: 33 });

    const res = await DELETE();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(sessionsDeleteCalls).toEqual([[33]]);
    // Cleared with an empty value (maxAge: 0), not merely left as-is.
    expect(cookieState.get(AUTH_SESSION_COOKIE_NAME)).toBe("");
  });
});
