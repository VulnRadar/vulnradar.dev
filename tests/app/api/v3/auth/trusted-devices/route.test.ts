import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../_test-harness";

/**
 * Route-level tests for GET /api/v3/auth/trusted-devices.
 *
 * Mocked at the network/database boundary only: getSession and
 * listTrustedDevices run for real against the mocked pool, per
 * tests/README.md.
 */

type Row = Record<string, unknown>;

let sessionRow: Row | null = null;
let deviceRows: Row[] = [];
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
  if (s.startsWith("SELECT id, device_fingerprint, device_name"))
    return { rows: deviceRows };
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
const { AUTH_SESSION_COOKIE_NAME, DEVICE_TRUST_COOKIE_NAME } =
  await import("@/lib/config/constants");
const { GET } = await import("@/app/api/v3/auth/trusted-devices/route");

beforeEach(() => {
  mockQuery.mockClear();
  queries.length = 0;
  cookieState.clear();
  sessionRow = null;
  deviceRows = [];
  invalidateSettingsCache();
});

describe("GET /api/v3/auth/trusted-devices", () => {
  it("requires a session", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("scopes the lookup to the caller's own user_id and never leaks device_fingerprint", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "raw-session-1");
    cookieState.set(DEVICE_TRUST_COOKIE_NAME, "fingerprint-current");
    sessionRow = defaultSessionRow({ user_id: 33 });
    deviceRows = [
      {
        id: 1,
        device_fingerprint: "fingerprint-current",
        device_name: "Work laptop",
        ip_address: "203.0.113.5",
        user_agent:
          "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36",
        last_used_at: "2026-01-05T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-06-01T00:00:00.000Z",
      },
      {
        id: 2,
        device_fingerprint: "fingerprint-other",
        device_name: null,
        ip_address: "198.51.100.9",
        user_agent: "curl/8.0",
        last_used_at: "2026-01-02T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-06-01T00:00:00.000Z",
      },
    ];

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.devices).toHaveLength(2);

    const listCall = queries.find((q) =>
      q.sql.startsWith("SELECT id, device_fingerprint, device_name"),
    );
    expect(listCall?.params).toEqual([33]);

    const current = json.devices.find(
      (d: { isCurrent: boolean }) => d.isCurrent,
    );
    const other = json.devices.find(
      (d: { isCurrent: boolean }) => !d.isCurrent,
    );
    expect(current.id).toBe(1);
    expect(current.deviceName).toBe("Work laptop");
    expect(current.device).toBe("Chrome on Windows");
    expect(other.id).toBe(2);

    // The fingerprint is the bearer credential that skips 2FA -- it must
    // never appear in the response.
    const body = JSON.stringify(json);
    expect(body).not.toContain("fingerprint-current");
    expect(body).not.toContain("fingerprint-other");
  });
});
