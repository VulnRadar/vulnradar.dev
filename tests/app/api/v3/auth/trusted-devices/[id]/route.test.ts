import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../../_test-harness";

/**
 * Route-level tests for DELETE /api/v3/auth/trusted-devices/[id].
 *
 * Mocked at the network/database boundary only: getSession and
 * revokeTrustedDevice run for real against the mocked pool, so the IDOR
 * test below asserts the exact ownership-scoped SQL
 * (`WHERE id = $1 AND user_id = $2`) actually reaches the database, not
 * just a mocked stand-in for it.
 */

type Row = Record<string, unknown>;

let sessionRow: Row | null = null;
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
  if (s.startsWith("DELETE FROM device_trust WHERE id = $1 AND user_id = $2"))
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
const { DELETE } = await import("@/app/api/v3/auth/trusted-devices/[id]/route");

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function deleteRequest() {
  return new NextRequest("http://localhost/api/v3/auth/trusted-devices/x", {
    method: "DELETE",
  });
}

beforeEach(() => {
  mockQuery.mockClear();
  queries.length = 0;
  cookieState.clear();
  sessionRow = null;
  deleteRowCount = 0;
  invalidateSettingsCache();
});

describe("DELETE /api/v3/auth/trusted-devices/[id]", () => {
  it("requires a session", async () => {
    const res = await DELETE(deleteRequest(), params("5"));
    expect(res.status).toBe(401);
    expect(
      queries.some((q) => q.sql.startsWith("DELETE FROM device_trust")),
    ).toBe(false);
  });

  it("rejects a non-numeric id before touching the database", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "raw-session-1");
    sessionRow = defaultSessionRow({ user_id: 33 });

    const res = await DELETE(deleteRequest(), params("not-a-number"));
    expect(res.status).toBe(400);
    expect(
      queries.some((q) => q.sql.startsWith("DELETE FROM device_trust")),
    ).toBe(false);
  });

  it("IDOR: a device id owned by another user is rejected with 404, scoped by the caller's own user_id", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "raw-session-1");
    sessionRow = defaultSessionRow({ user_id: 33 });
    // Simulates device id 5 belonging to a different user: the DELETE's
    // WHERE id = $1 AND user_id = $2 matches zero rows for user 33.
    deleteRowCount = 0;

    const res = await DELETE(deleteRequest(), params("5"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Trusted device not found");

    const deleteCall = queries.find((q) =>
      q.sql.startsWith(
        "DELETE FROM device_trust WHERE id = $1 AND user_id = $2",
      ),
    );
    expect(deleteCall?.params).toEqual([5, 33]);
  });

  it("revokes the caller's own trusted device", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "raw-session-1");
    sessionRow = defaultSessionRow({ user_id: 33 });
    deleteRowCount = 1;

    const res = await DELETE(deleteRequest(), params("5"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    const deleteCall = queries.find((q) =>
      q.sql.startsWith(
        "DELETE FROM device_trust WHERE id = $1 AND user_id = $2",
      ),
    );
    expect(deleteCall?.params).toEqual([5, 33]);
  });
});
