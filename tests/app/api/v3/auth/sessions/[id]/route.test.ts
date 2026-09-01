import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../../_test-harness";

/**
 * Route-level tests for DELETE /api/v3/auth/sessions/[id].
 *
 * Mocked at the network/database boundary only (the pg pool + next/headers),
 * per tests/README.md -- getSession, findUserSessionByHash, and
 * deleteSessionById all run for real against the mocked pool. This is
 * deliberate: the whole point of this route is an ownership boundary
 * (revoking session X must only ever be possible for the user who owns
 * session X), and that boundary lives in the real SQL those functions
 * issue, not in anything worth stubbing out.
 */

type Row = Record<string, unknown>;

let sessionRow: Row | null = null;
let userSessionsRows: Row[] = [];
let deleteRowCount = 0;
const queries: { sql: string; params: unknown[] }[] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  const s = sql.trim();
  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.includes("SELECT s.user_id"))
    return { rows: sessionRow ? [sessionRow] : [] };
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (s.startsWith("SELECT id, ip_address, ipv4_address, user_agent"))
    return { rows: userSessionsRows };
  if (s.startsWith("DELETE FROM sessions WHERE id = $1 AND user_id = $2"))
    return { rows: [], rowCount: deleteRowCount };
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
const { DELETE } = await import("@/app/api/v3/auth/sessions/[id]/route");

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function deleteRequest() {
  return new NextRequest("http://localhost/api/v3/auth/sessions/x", {
    method: "DELETE",
  });
}

beforeEach(() => {
  mockQuery.mockClear();
  queries.length = 0;
  cookieState.clear();
  sessionRow = null;
  userSessionsRows = [];
  deleteRowCount = 0;
  invalidateSettingsCache();
});

describe("DELETE /api/v3/auth/sessions/[id]", () => {
  it("requires a session", async () => {
    const res = await DELETE(
      deleteRequest(),
      params(hashSessionId("whatever")),
    );
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM sessions WHERE id"),
      expect.anything(),
    );
  });

  it("IDOR: a hash that doesn't belong to the caller's own sessions is rejected with 404, and no delete ever fires", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "raw-session-current");
    sessionRow = defaultSessionRow({ user_id: 33 });
    // These are user 33's own active sessions -- as guaranteed by
    // listUserSessions' WHERE user_id = $1, a row belonging to another
    // user never appears here in the first place.
    userSessionsRows = [
      {
        id: "raw-session-current",
        ip_address: null,
        user_agent: null,
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-02-01T00:00:00.000Z",
      },
    ];

    // Attacker (user 33) guesses/observes a hash for a session that
    // actually belongs to a different user (e.g. "victim-session-77")
    // and is not present in user 33's own session list above.
    const res = await DELETE(
      deleteRequest(),
      params(hashSessionId("victim-session-77")),
    );
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Session not found");

    // Proves the lookup that decides the 404 was scoped to the caller's
    // own user_id, not the target session's owner.
    const selectCall = queries.find((q) =>
      q.sql.startsWith("SELECT id, ip_address, ipv4_address, user_agent"),
    );
    expect(selectCall?.params).toEqual([33]);

    // And crucially: the DELETE statement never ran at all.
    expect(
      queries.some((q) => q.sql.startsWith("DELETE FROM sessions WHERE id")),
    ).toBe(false);
  });

  it("revokes the caller's own non-current session", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "raw-session-current");
    sessionRow = defaultSessionRow({ user_id: 33 });
    userSessionsRows = [
      {
        id: "raw-session-current",
        ip_address: null,
        user_agent: null,
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "raw-session-other",
        ip_address: "203.0.113.5",
        user_agent: "curl/8.0",
        created_at: "2026-01-02T00:00:00.000Z",
        expires_at: "2026-02-01T00:00:00.000Z",
      },
    ];
    deleteRowCount = 1;

    const res = await DELETE(
      deleteRequest(),
      params(hashSessionId("raw-session-other")),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    const deleteCall = queries.find((q) =>
      q.sql.startsWith("DELETE FROM sessions WHERE id = $1 AND user_id = $2"),
    );
    expect(deleteCall?.params).toEqual(["raw-session-other", 33]);
  });

  it("rejects revoking the CURRENT session through this endpoint", async () => {
    // The cookie holds the bearer token and sessions.id holds its digest
    // (AUDIT-012#auth-07), so "is this my current session" is a comparison
    // between the stored id and hashSessionId(cookie), and the public id the
    // client sends back is one hash further out again.
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "raw-token-current");
    const storedCurrentId = hashSessionId("raw-token-current");
    sessionRow = defaultSessionRow({ user_id: 33 });
    userSessionsRows = [
      {
        id: storedCurrentId,
        ip_address: null,
        user_agent: null,
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-02-01T00:00:00.000Z",
      },
    ];

    const res = await DELETE(
      deleteRequest(),
      params(hashSessionId(storedCurrentId)),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/sign out everywhere/i);
    expect(
      queries.some((q) => q.sql.startsWith("DELETE FROM sessions WHERE id")),
    ).toBe(false);
  });
});
